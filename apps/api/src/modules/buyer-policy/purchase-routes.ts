import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { paymentClientVerificationRequestSchema } from "@razorgrowth/contracts";
import { prisma } from "../../db/client.js";
import { AppError } from "../../http/errors.js";
import { getBuyerContextId } from "../authorization/demo-context.js";
import { authorizePurchaseProposal, createPurchaseProposal } from "./purchase-proposal-service.js";
import { requireApprovalRole } from "../auth/middleware.js";
import { getPayment, verifyClientCompletion } from "../payments/payment-service.js";
import { getPaymentGateway } from "../payments/gateway-factory.js";
import { negotiateProposal, loadCustomerHistory, loadNegotiationPolicy } from "./negotiation-service.js";
import { computeCustomerStanding } from "@razorgrowth/domain";

const idSchema = z.object({ id: z.string().uuid() });
const agentId = "customer-buyer-agent";


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
    const buyerContext = getBuyerContextId(request);
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
    // reporting. Timed from intake to the moment the outcome is known,
    // and deliberately NOT including the ledger write or checkout
    // execution that follow, so the figure measures the gate rather than
    // the work done after it.
    const decisionStartedAt = performance.now();
    const buyerContext = getBuyerContextId(request);
    const body = z
      .object({
        variantId: z.string().uuid(),
        quantity: z.number().int().min(1).max(10),
        budgetMinor: z.number().int().nonnegative().optional(),
      })
      .parse(request.body);

    // The whole decision lives in `createPurchaseProposal` now. The Buyer
    // Agent conversation calls the SAME function when a shopper says "buy
    // the second one" — a conversation that built its own proposal would
    // be a second implementation of spending policy, and the one nobody
    // tests is the one that quietly diverges.
    const result = await createPurchaseProposal(prisma, {
      buyerContext,
      variantId: body.variantId,
      quantity: body.quantity,
      budgetMinor: body.budgetMinor,
      agentId,
      decisionLatencyMs: Math.max(0, Math.round(performance.now() - decisionStartedAt)),
    });

    return {
      id: result.id,
      amountMinor: result.amountMinor,
      currency: result.currency,
      outcome: result.outcome,
      explanation: result.explanation,
      requiresApproval: result.requiresApproval,
      expiresAt: result.expiresAt,
    };
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
    const buyerContext = getBuyerContextId(request);
    // Standing is always standing WITH A SELLER — it is derived from
    // settled orders placed at that merchant, against that merchant's
    // negotiation envelope. This used to fall back to the buyer's own
    // context id, which is a merchant row that sells nothing: the query
    // then matched no orders and every shopper read as NEW no matter how
    // much they had bought. A missing seller is a malformed request, not
    // a shopper with no history.
    const { merchantId } = z.object({ merchantId: z.string().uuid() }).parse(request.query);

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
    const buyerContext = getBuyerContextId(request);
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
    const { id } = idSchema.parse(request.params);
    // The whole decision — allowance reservation, re-checked policy,
    // execution, and the ambiguous-failure handling — lives in
    // `authorizePurchaseProposal`. The Buyer Agent conversation calls the
    // SAME function when a shopper says "yes, authorize it", because a
    // second implementation of money-moving authorization is the one that
    // eventually double-charges.
    return authorizePurchaseProposal(prisma, {
      buyerContext: getBuyerContextId(request),
      proposalId: id,
      agentId,
    });
  });

  app.get(`${prefix}/buyer/purchase-proposals/:id/payment`, async (request) => {
    const row = await ownedProposal(idSchema.parse(request.params).id, getBuyerContextId(request));
    if (!row.internalPaymentId) throw AppError.conflict("No payment evidence is available yet. Do not retry an in-flight purchase.");
    return getPayment(prisma, row.merchantId, row.internalPaymentId);
  });
  app.get(`${prefix}/buyer/purchase-proposals/:id/payment/checkout`, async (request) => {
    const row = await ownedProposal(idSchema.parse(request.params).id, getBuyerContextId(request));
    if (!row.internalPaymentId) throw AppError.conflict("No payment order has been created.");
    const payment = await getPayment(prisma, row.merchantId, row.internalPaymentId);
    const gateway = getPaymentGateway();
    const config = gateway?.getPublicConfig();
    if (payment.provider !== "RAZORPAY" || gateway?.provider !== "RAZORPAY" || !config?.testMode) throw new AppError("PAYMENT_NOT_CONFIGURED", "Razorpay Test Mode checkout is not available for this payment. Mock payments are not real Razorpay transactions.");
    if (payment.state !== "CREATED" || payment.automaticRetryBlocked || !payment.providerOrderId) throw AppError.conflict("Payment is not eligible for checkout. Refresh its evidence before any further action.");
    return { paymentId: payment.id, providerOrderId: payment.providerOrderId, amountMinor: payment.amountMinor, currency: payment.currency, keyId: config.keyId };
  });
  app.post(`${prefix}/buyer/purchase-proposals/:id/payment/verify`, async (request) => {
    const row = await ownedProposal(idSchema.parse(request.params).id, getBuyerContextId(request));
    const body = paymentClientVerificationRequestSchema.parse(request.body);
    if (body.paymentId !== row.internalPaymentId) throw AppError.forbidden("Payment does not belong to this proposal.");
    return verifyClientCompletion(prisma, row.merchantId, body);
  });
}
