import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { paymentClientVerificationRequestSchema } from "@razorgrowth/contracts";
import { prisma } from "../../db/client.js";
import { AppError } from "../../http/errors.js";
import { getAuthenticatedMerchantId } from "../authorization/demo-context.js";
import { requireApprovalRole } from "../auth/middleware.js";
import { appendLedgerEvent, withLedgerConcurrencyRetry } from "../audit/ledger.js";
import { executeExternalAgentPurchase, ExternalPurchaseExecutionError } from "../gateway/execution-service.js";
import { getPayment, verifyClientCompletion } from "../payments/payment-service.js";
import { getPaymentGateway } from "../payments/gateway-factory.js";
import { negotiateProposal, loadCustomerHistory, loadNegotiationPolicy } from "./negotiation-service.js";
import { resolveBuyerPolicy } from "./resolve-policy.js";
import { computeCustomerStanding } from "@razorgrowth/domain";

/**
 * The stored basket, as execution will re-price it.
 *
 * `lineDiscountMinor` is part of the shape because a negotiated discount
 * is recorded ON the line (see `applyLineDiscounts`). Zod strips unknown
 * keys, so omitting it here silently dropped the discount between the
 * proposal and execution, and every negotiated purchase was refused as
 * FINANCIAL_INTEGRITY_ERROR. This is read from the server's own
 * DecisionRecord, never from a request body.
 */
const basketSchema = z.array(z.object({ productId: z.string().uuid(), variantId: z.string().uuid(), quantity: z.number().int().positive(), unitPriceMinor: z.number().int().nonnegative(), lineDiscountMinor: z.number().int().nonnegative().optional() })).length(1);
const idSchema = z.object({ id: z.string().uuid() });
const agentId = "customer-buyer-agent";

/**
 * The single category gate, used by BOTH the proposal decision and the
 * re-check at authorization time. Two copies of an authorization rule is
 * how one of them ends up stale, and this one decides whether an agent
 * may spend money.
 */
function categoryPermitted(
  policy: { allowAllCategories: boolean },
  category: string,
  allowedCategories: string[],
): boolean {
  if (policy.allowAllCategories) return true;
  return allowedCategories.includes(category);
}

async function ownedProposal(id: string, buyerContext: string) {
  const row = await prisma.decisionRecord.findFirst({ where: { id, externalAgentId: agentId, protocolActorRef: buyerContext } });
  if (!row) throw AppError.notFound("Purchase proposal not found.");
  return row;
}

export function registerBuyerPurchaseRoutes(app: FastifyInstance, prefix: string): void {
  /**
   * A shopper's own purchase history.
   *
   * Returns WHAT was bought, not just how much it cost. The row used to
   * carry only merchant name, amount and a raw status, so the history
   * screen could not name a single product — every purchase read as an
   * anonymous amount against a merchant. The basket is already stored on
   * the decision; this resolves it to the product and variant names that
   * were bought, plus the negotiation outcome, so the screen can describe
   * a purchase the way the person who made it would.
   *
   * Names are read from the catalogue at read time and are display-only.
   * Every authoritative amount still comes from the decision record.
   */
  app.get(`${prefix}/buyer/purchase-proposals`, async (request) => {
    const buyerContext = getAuthenticatedMerchantId(request);
    const rows = await prisma.decisionRecord.findMany({ where: { externalAgentId: agentId, protocolActorRef: buyerContext }, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, explanation: true, outcome: true, reasonCode: true, settlementStatus: true, computedTotalMinor: true, preNegotiationTotalMinor: true, negotiationStatus: true, negotiatedDiscountBps: true, currency: true, internalOrderId: true, internalPaymentId: true, normalizedBasket: true, createdAt: true, authorizationExpiresAt: true, merchant: { select: { name: true } } } });

    const lineSchema = z.array(z.object({ variantId: z.string().uuid(), quantity: z.number().int().positive(), unitPriceMinor: z.number().int().nonnegative(), lineDiscountMinor: z.number().int().nonnegative().optional() }));
    const basketByRow = new Map(rows.map((row) => [row.id, lineSchema.safeParse(row.normalizedBasket).data ?? []]));
    const variantIds = [...new Set([...basketByRow.values()].flat().map((line) => line.variantId))];
    const variants = variantIds.length
      ? await prisma.productVariant.findMany({ where: { id: { in: variantIds } }, select: { id: true, title: true, product: { select: { name: true, category: true } } } })
      : [];
    const variantById = new Map(variants.map((variant) => [variant.id, variant]));

    return { items: rows.map(({ normalizedBasket: _basket, ...row }) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
      authorizationExpiresAt: row.authorizationExpiresAt?.toISOString() ?? null,
      items: (basketByRow.get(row.id) ?? []).map((line) => {
        const variant = variantById.get(line.variantId);
        return {
          variantId: line.variantId,
          quantity: line.quantity,
          unitPriceMinor: line.unitPriceMinor,
          lineDiscountMinor: line.lineDiscountMinor ?? 0,
          // Null rather than a placeholder name: a product removed from
          // the catalogue since the purchase is a real state, and inventing
          // a label for it would hide that.
          productName: variant?.product.name ?? null,
          variantTitle: variant?.title ?? null,
          category: variant?.product.category ?? null,
        };
      }),
    })) };
  });
  app.post(`${prefix}/buyer/purchase-proposals`, async (request) => {
    // Measured, not assumed. This was hardcoded to 0, so the merchant
    // console reported "0ms median decision" for every buyer purchase —
    // a fabricated number in a console whose whole value is honest
    // reporting. Timed the same way the agent gateway times its own
    // decisions: from intake to the moment the outcome is known, and
    // deliberately NOT including the ledger write or checkout execution
    // that follow, so the figure measures the gate rather than the work
    // done after it.
    const decisionStartedAt = performance.now();
    const buyerContext = getAuthenticatedMerchantId(request);
    const body = z.object({ variantId: z.string().uuid(), quantity: z.number().int().min(1).max(10), budgetMinor: z.number().int().nonnegative().optional() }).parse(request.body);
    const variant = await prisma.productVariant.findFirst({ where: { id: body.variantId, active: true, product: { status: "ACTIVE", merchant: { status: "ACTIVE" } } }, include: { product: true, inventory: true } });
    if (!variant) throw AppError.notFound("Active product variant not found.");
    const policy = await resolveBuyerPolicy(buyerContext);
    const amountMinor = variant.priceMinor * body.quantity;
    const categories = z.array(z.string()).parse(policy.allowedCategories);
    const reasons: string[] = [];
    if (variant.currency !== policy.currency) reasons.push("POLICY_CURRENCY_MISMATCH");
    // `allowAllCategories` is a real column the shopper set deliberately —
    // never a magic word matched out of `allowedCategories`. A wildcard
    // hidden in user-supplied text is what an injection would aim for, and
    // it makes a deliberate choice indistinguishable from a typo.
    if (!categoryPermitted(policy, variant.product.category, categories)) reasons.push("CATEGORY_NOT_ALLOWED");
    if ((variant.inventory?.availableQuantity ?? 0) < body.quantity) reasons.push("INSUFFICIENT_INVENTORY");
    if (amountMinor > policy.dailyLimitMinor) reasons.push("DAILY_LIMIT_EXCEEDED");
    if (body.budgetMinor !== undefined && amountMinor > body.budgetMinor) reasons.push("BUYER_BUDGET_EXCEEDED");
    const requiresApproval = amountMinor > policy.autonomousPurchaseLimitMinor;
    if (requiresApproval && !policy.approvalRequiredAboveLimit) reasons.push("AUTONOMOUS_LIMIT_EXCEEDED");
    const outcome = reasons.length ? "DECLINE" : requiresApproval ? "STEP_UP" : "AUTO_APPROVE";
    const explanation = reasons.length ? reasons.join(", ") : requiresApproval ? "Explicit buyer approval is required above the autonomous limit." : "Within the saved buyer policy; ready for authorization.";
    const decisionLatencyMs = Math.max(0, Math.round(performance.now() - decisionStartedAt));
    const row = await withLedgerConcurrencyRetry(prisma, async (tx) => {
      const proposal = await tx.decisionRecord.create({ data: {
        merchantId: variant.product.merchantId, externalAgentId: agentId, protocolActorRef: buyerContext,
        outcome, reasonCode: reasons[0] ?? (requiresApproval ? "BUYER_APPROVAL_REQUIRED" : "BUYER_POLICY_PASSED"), explanation,
        computedTotalMinor: amountMinor, currency: variant.currency, appliedCeilingMinor: policy.autonomousPurchaseLimitMinor,
        permissionType: "NONE", authorizationExpiresAt: new Date(Date.now() + 15 * 60_000),
        normalizedBasket: [{ productId: variant.productId, variantId: variant.id, quantity: body.quantity, unitPriceMinor: variant.priceMinor }],
        workflowId: randomUUID(), settlementStatus: "PROPOSED", decisionLatencyMs,
      } });
      await appendLedgerEvent(tx, { merchantId: proposal.merchantId, workflowId: proposal.workflowId!, actorType: "COMMERCE", actionType: "BUYER_PURCHASE_PROPOSED", status: "EXECUTED", conciseReason: explanation, relatedEntityType: "DecisionRecord", relatedEntityId: proposal.id });
      return proposal;
    });
    return { id: row.id, amountMinor, currency: row.currency, outcome, explanation, requiresApproval, expiresAt: row.authorizationExpiresAt!.toISOString() };
  });

  /**
   * What this shopper has earned, before they ask for anything.
   *
   * Exposed so the buyer UI can say "you have 4% available" rather than
   * making someone request a discount to discover whether one exists. The
   * tier is DERIVED here from settled orders — the client cannot state it,
   * and there is no field in which to try.
   */
  app.get(`${prefix}/buyer/standing`, async (request) => {
    const buyerContext = getAuthenticatedMerchantId(request);
    const merchantId = z.object({ merchantId: z.string().uuid().optional() }).parse(request.query).merchantId ?? buyerContext;

    const [history, policy] = await Promise.all([
      loadCustomerHistory(prisma, buyerContext, merchantId),
      loadNegotiationPolicy(prisma, merchantId),
    ]);
    const standing = computeCustomerStanding(history);

    return {
      tier: standing.tier,
      earnedDiscountBps: standing.earnedDiscountBps,
      effectiveOrders: standing.effectiveOrders,
      ordersToNextTier: standing.ordersToNextTier,
      explanation: standing.explanation,
      settledOrders: history.settledOrders,
      lifetimeSpendMinor: history.lifetimeSpendMinor,
      disputedOrders: history.disputedOrders,
      // The merchant's envelope, so the UI can show the line rather than
      // discovering it by being refused.
      autoApplyCeilingBps: policy.autoApplyCeilingBps,
      maxNegotiableDiscountBps: policy.maxNegotiableDiscountBps,
      maxAutoApplyDiscountMinor: policy.maxAutoApplyDiscountMinor,
      automationEnabled: policy.automationEnabled,
      currency: policy.currency,
    };
  });

  /**
   * Ask for a better price.
   *
   * `discountBps` is optional: omitting it means "give me what I have
   * earned", which is the common case and the one that needs no number
   * from a shopper who does not think in basis points.
   *
   * Whatever is sent is a REQUEST. The server prices the basket, reads the
   * customer's own settled history, and decides. A request past the
   * merchant's maximum is refused with a counter-offer rather than
   * quietly clamped, because silently granting something different from
   * what was asked for is how a negotiation loses a customer's trust.
   */
  app.post(`${prefix}/buyer/purchase-proposals/:id/negotiate`, async (request) => {
    const buyerContext = getAuthenticatedMerchantId(request);
    const { id } = idSchema.parse(request.params);
    const body = z
      .object({
        // 100% is accepted at the door and refused by policy, on purpose:
        // the refusal is a policy decision a merchant can see and tune,
        // not a validation error that never reaches the ledger.
        discountBps: z.number().int().min(0).max(10_000).nullable().optional(),
      })
      .parse(request.body ?? {});

    return negotiateProposal(prisma, {
      proposalId: id,
      buyerContext,
      requestedDiscountBps: body.discountBps ?? null,
    });
  });

  app.post(`${prefix}/buyer/purchase-proposals/:id/authorize`, async (request) => {
    if (request.merchantUserRole !== "CUSTOMER") requireApprovalRole(request);
    const buyerContext = getAuthenticatedMerchantId(request);
    const { id } = idSchema.parse(request.params);
    const row = await ownedProposal(id, buyerContext);
    if (row.internalPaymentId) return getPayment(prisma, row.merchantId, row.internalPaymentId);
    const lines = basketSchema.parse(row.normalizedBasket);
    await withLedgerConcurrencyRetry(prisma, async (tx) => {
      // This row update serializes all purchases for one buyer context before
      // reserving daily allowance, including simultaneous cross-merchant buys.
      const policy = await tx.buyerSpendingPolicy.update({ where: { merchantId: buyerContext }, data: { updatedAt: new Date() } });
      const current = await tx.decisionRecord.findUniqueOrThrow({ where: { id } });
      if (current.settlementStatus !== "PROPOSED") throw AppError.conflict("This proposal was already attempted. Check payment status; do not retry.");
      if (current.outcome === "DECLINE") throw new AppError("POLICY_DENIED", current.explanation);
      if (!current.authorizationExpiresAt || current.authorizationExpiresAt <= new Date()) throw new AppError("AUTHORIZATION_EXPIRED", "Create a fresh proposal; this authorization has expired.");
      const variant = await tx.productVariant.findUniqueOrThrow({ where: { id: lines[0]!.variantId }, include: { product: true } });
      if (!categoryPermitted(policy, variant.product.category, z.array(z.string()).parse(policy.allowedCategories)) || policy.currency !== current.currency || ((current.computedTotalMinor ?? 0) > policy.autonomousPurchaseLimitMinor && !policy.approvalRequiredAboveLimit)) throw new AppError("POLICY_CHANGED", "The current buyer policy no longer permits this purchase.");
      const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
      const reserved = await tx.decisionRecord.aggregate({ where: { externalAgentId: agentId, protocolActorRef: buyerContext, stepUpDecidedAt: { gte: dayStart }, settlementStatus: { notIn: ["PROPOSED", "FAILED"] } }, _sum: { computedTotalMinor: true } });
      if ((reserved._sum.computedTotalMinor ?? 0) + (current.computedTotalMinor ?? 0) > policy.dailyLimitMinor) throw new AppError("POLICY_DENIED", "Daily spending allowance is exhausted, including pending purchases.");
      await tx.decisionRecord.update({ where: { id }, data: { settlementStatus: "EXECUTING", permissionType: "EXPLICIT_BUYER_APPROVAL", stepUpDecidedAt: new Date(), authorizationMaxAmountMinor: current.computedTotalMinor, authorizationCurrency: current.currency, authorizationMerchantScope: current.merchantId } });
      await appendLedgerEvent(tx, { merchantId: row.merchantId, workflowId: row.workflowId!, actorType: "COMMERCE", actionType: "BUYER_PURCHASE_AUTHORIZED", status: "EXECUTED", conciseReason: "Buyer explicitly authorized the server-priced basket; daily allowance reserved.", relatedEntityType: "DecisionRecord", relatedEntityId: id });
    });
    try {
      const result = await executeExternalAgentPurchase(prisma, { merchantId: row.merchantId, decisionId: id, workflowId: row.workflowId!, currency: row.currency!, amountMinor: row.computedTotalMinor!, lines });
      await prisma.decisionRecord.update({ where: { id }, data: { internalOrderId: result.orderId, internalPaymentId: result.paymentId, providerOrderId: result.providerOrderId, settlementStatus: "PAYMENT_PENDING" } });
      return getPayment(prisma, row.merchantId, result.paymentId);
    } catch (error) {
      // Ambiguous execution consumes the proposal: never re-submit a charge.
      //
      // But only genuinely ambiguous execution. `executeExternalAgentPurchase`
      // raises a plain `AppError` only from inside its opening transaction —
      // repricing, eligibility, stock — which ROLLS BACK, so no cart, order,
      // checkout, payment or reservation exists and no provider was ever
      // called. Filing that as UNKNOWN was wrong twice over: it claims a
      // charge might exist when the rollback proves none does, and because
      // reserved daily allowance counts every status except PROPOSED and
      // FAILED, it permanently consumed the shopper's daily limit for a
      // purchase that never happened. Anything past that transaction arrives
      // as ExternalPurchaseExecutionError carrying the status the payment
      // evidence actually supports; anything else stays UNKNOWN, because an
      // unrecognised failure after a provider call is exactly the case where
      // guessing is unsafe.
      const settlementStatus = error instanceof ExternalPurchaseExecutionError
        ? error.executionStatus
        : error instanceof AppError
          ? "FAILED"
          : "UNKNOWN";
      await prisma.decisionRecord.update({ where: { id }, data: { settlementStatus, ...(error instanceof ExternalPurchaseExecutionError ? { internalOrderId: error.refs.orderId, internalPaymentId: error.refs.paymentId, providerOrderId: error.refs.providerOrderId } : {}) } });
      throw error;
    }
  });

  app.get(`${prefix}/buyer/purchase-proposals/:id/payment`, async (request) => {
    const row = await ownedProposal(idSchema.parse(request.params).id, getAuthenticatedMerchantId(request));
    if (!row.internalPaymentId) throw AppError.conflict("No payment evidence is available yet. Do not retry an in-flight purchase.");
    return getPayment(prisma, row.merchantId, row.internalPaymentId);
  });
  app.get(`${prefix}/buyer/purchase-proposals/:id/payment/checkout`, async (request) => {
    const row = await ownedProposal(idSchema.parse(request.params).id, getAuthenticatedMerchantId(request));
    if (!row.internalPaymentId) throw AppError.conflict("No payment order has been created.");
    const payment = await getPayment(prisma, row.merchantId, row.internalPaymentId);
    const gateway = getPaymentGateway();
    const config = gateway?.getPublicConfig();
    if (payment.provider !== "RAZORPAY" || gateway?.provider !== "RAZORPAY" || !config?.testMode) throw new AppError("PAYMENT_NOT_CONFIGURED", "Razorpay Test Mode checkout is not available for this payment. Mock payments are not real Razorpay transactions.");
    if (payment.state !== "CREATED" || payment.automaticRetryBlocked || !payment.providerOrderId) throw AppError.conflict("Payment is not eligible for checkout. Refresh its evidence before any further action.");
    return { paymentId: payment.id, providerOrderId: payment.providerOrderId, amountMinor: payment.amountMinor, currency: payment.currency, keyId: config.keyId };
  });
  app.post(`${prefix}/buyer/purchase-proposals/:id/payment/verify`, async (request) => {
    const row = await ownedProposal(idSchema.parse(request.params).id, getAuthenticatedMerchantId(request));
    const body = paymentClientVerificationRequestSchema.parse(request.body);
    if (body.paymentId !== row.internalPaymentId) throw AppError.forbidden("Payment does not belong to this proposal.");
    return verifyClientCompletion(prisma, row.merchantId, body);
  });
}
