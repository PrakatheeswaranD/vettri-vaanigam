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

const basketSchema = z.array(z.object({ productId: z.string().uuid(), variantId: z.string().uuid(), quantity: z.number().int().positive(), unitPriceMinor: z.number().int().nonnegative() })).length(1);
const idSchema = z.object({ id: z.string().uuid() });
const agentId = "customer-buyer-agent";

async function ownedProposal(id: string, buyerContext: string) {
  const row = await prisma.decisionRecord.findFirst({ where: { id, externalAgentId: agentId, protocolActorRef: buyerContext } });
  if (!row) throw AppError.notFound("Purchase proposal not found.");
  return row;
}

export function registerBuyerPurchaseRoutes(app: FastifyInstance, prefix: string): void {
  app.get(`${prefix}/buyer/purchase-proposals`, async (request) => {
    const buyerContext = getAuthenticatedMerchantId(request);
    const rows = await prisma.decisionRecord.findMany({ where: { externalAgentId: agentId, protocolActorRef: buyerContext }, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, explanation: true, outcome: true, settlementStatus: true, computedTotalMinor: true, currency: true, internalOrderId: true, internalPaymentId: true, createdAt: true, authorizationExpiresAt: true, merchant: { select: { name: true } } } });
    return { items: rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString(), authorizationExpiresAt: row.authorizationExpiresAt?.toISOString() ?? null })) };
  });
  app.post(`${prefix}/buyer/purchase-proposals`, async (request) => {
    const buyerContext = getAuthenticatedMerchantId(request);
    const body = z.object({ variantId: z.string().uuid(), quantity: z.number().int().min(1).max(10), budgetMinor: z.number().int().nonnegative().optional() }).parse(request.body);
    const variant = await prisma.productVariant.findFirst({ where: { id: body.variantId, active: true, product: { status: "ACTIVE", merchant: { status: "ACTIVE" } } }, include: { product: true, inventory: true } });
    if (!variant) throw AppError.notFound("Active product variant not found.");
    const policy = await prisma.buyerSpendingPolicy.upsert({ where: { merchantId: buyerContext }, update: {}, create: { merchantId: buyerContext, allowedCategories: ["Electronics/Laptop", "Books", "Accessories"] } });
    const amountMinor = variant.priceMinor * body.quantity;
    const categories = z.array(z.string()).parse(policy.allowedCategories);
    const reasons: string[] = [];
    if (variant.currency !== policy.currency) reasons.push("POLICY_CURRENCY_MISMATCH");
    if (!categories.includes(variant.product.category)) reasons.push("CATEGORY_NOT_ALLOWED");
    if ((variant.inventory?.availableQuantity ?? 0) < body.quantity) reasons.push("INSUFFICIENT_INVENTORY");
    if (amountMinor > policy.dailyLimitMinor) reasons.push("DAILY_LIMIT_EXCEEDED");
    if (body.budgetMinor !== undefined && amountMinor > body.budgetMinor) reasons.push("BUYER_BUDGET_EXCEEDED");
    const requiresApproval = amountMinor > policy.autonomousPurchaseLimitMinor;
    if (requiresApproval && !policy.approvalRequiredAboveLimit) reasons.push("AUTONOMOUS_LIMIT_EXCEEDED");
    const outcome = reasons.length ? "DECLINE" : requiresApproval ? "STEP_UP" : "AUTO_APPROVE";
    const explanation = reasons.length ? reasons.join(", ") : requiresApproval ? "Explicit buyer approval is required above the autonomous limit." : "Within the saved buyer policy; ready for authorization.";
    const row = await withLedgerConcurrencyRetry(prisma, async (tx) => {
      const proposal = await tx.decisionRecord.create({ data: {
        merchantId: variant.product.merchantId, externalAgentId: agentId, protocolActorRef: buyerContext,
        outcome, reasonCode: reasons[0] ?? (requiresApproval ? "BUYER_APPROVAL_REQUIRED" : "BUYER_POLICY_PASSED"), explanation,
        computedTotalMinor: amountMinor, currency: variant.currency, appliedCeilingMinor: policy.autonomousPurchaseLimitMinor,
        permissionType: "NONE", authorizationExpiresAt: new Date(Date.now() + 15 * 60_000),
        normalizedBasket: [{ productId: variant.productId, variantId: variant.id, quantity: body.quantity, unitPriceMinor: variant.priceMinor }],
        workflowId: randomUUID(), settlementStatus: "PROPOSED", decisionLatencyMs: 0,
      } });
      await appendLedgerEvent(tx, { merchantId: proposal.merchantId, workflowId: proposal.workflowId!, actorType: "COMMERCE", actionType: "BUYER_PURCHASE_PROPOSED", status: "EXECUTED", conciseReason: explanation, relatedEntityType: "DecisionRecord", relatedEntityId: proposal.id });
      return proposal;
    });
    return { id: row.id, amountMinor, currency: row.currency, outcome, explanation, requiresApproval, expiresAt: row.authorizationExpiresAt!.toISOString() };
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
      if (!z.array(z.string()).parse(policy.allowedCategories).includes(variant.product.category) || policy.currency !== current.currency || ((current.computedTotalMinor ?? 0) > policy.autonomousPurchaseLimitMinor && !policy.approvalRequiredAboveLimit)) throw new AppError("POLICY_CHANGED", "The current buyer policy no longer permits this purchase.");
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
      await prisma.decisionRecord.update({ where: { id }, data: { settlementStatus: error instanceof ExternalPurchaseExecutionError ? error.executionStatus : "UNKNOWN", ...(error instanceof ExternalPurchaseExecutionError ? { internalOrderId: error.refs.orderId, internalPaymentId: error.refs.paymentId, providerOrderId: error.refs.providerOrderId } : {}) } });
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
