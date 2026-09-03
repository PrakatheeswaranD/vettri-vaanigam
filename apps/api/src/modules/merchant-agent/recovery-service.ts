/**
 * Failure-first payment recovery orchestration (PART 08 §11-§18, §112-
 * §113). Loads verified failure evidence, evaluates deterministic
 * eligibility, and — only when eligible — asks the Merchant Agent to
 * propose a bounded recovery action. This function never itself
 * authorizes or executes anything; it produces a `GrowthActionProposal`
 * that flows through the EXACT SAME `/policy/evaluate` → approval →
 * `/execution-authorizations/*` pipeline every other proposal uses
 * (PART 08 §22: reuse the Policy Engine, never a second one).
 */
import type { PrismaClient } from "@prisma/client";
import type { GrowthActionProposalDTO, GrowthEvidenceDTO } from "@razorgrowth/contracts";
import {
  deterministicRecoveryAction,
  evaluateRecoveryEligibility,
  renderGrowthExplanation,
  validateRecoveryProposal,
  type GrowthReasonCode,
  type PaymentFailureCategory,
  type RecoveryAction,
} from "@razorgrowth/domain";
import { AppError } from "../../http/errors.js";
import { logger } from "../../observability/logger.js";
import { appendLedgerEvent } from "../audit/ledger.js";
import type { AIProvider } from "../agents/ai-provider.js";
import { getAIProvider } from "../agents/provider-factory.js";
import { findPaymentById } from "../payments/payment-repository.js";
import { reconcilePayment } from "../payments/payment-service.js";
import { findCheckoutById } from "../commerce/checkout-repository.js";
import { getMerchantPolicy, countPriorRecoveryAttempts } from "../policy/repository.js";
import { getGrowthConfig } from "./repository.js";
import { allowedActionTypes } from "./service.js";
import { createProposal } from "./repository.js";
import { toGrowthActionProposalDTO } from "./mapper.js";

const MAX_RECOVERY_AI_RETRIES = 1;

export async function evaluateAndProposeRecovery(
  prisma: PrismaClient,
  merchantId: string,
  paymentId: string,
  providerOverride?: AIProvider,
): Promise<GrowthActionProposalDTO> {
  const provider = providerOverride ?? getAIProvider();
  const payment = await findPaymentById(prisma, merchantId, paymentId);
  if (!payment) throw AppError.notFound(`Payment not found: ${paymentId}`);

  const order = await prisma.order.findFirst({ where: { id: payment.orderId, merchantId } });
  if (!order) throw AppError.notFound(`Order not found for payment: ${paymentId}`);
  const checkout = payment.checkoutId ? await findCheckoutById(prisma, merchantId, payment.checkoutId) : null;
  if (!checkout) throw AppError.conflict("No checkout session exists for this payment.");

  const workflowId = checkout.workflowId;
  const now = new Date();

  // PART 08 §13-§14 — an UNKNOWN payment state must be reconciled with
  // the provider BEFORE eligibility is even evaluated; recovering "on
  // top of" an uncertain prior attempt risks a duplicate charge.
  let currentPayment = payment;
  if (currentPayment.state === "UNKNOWN") {
    logger.info({ event: "recovery.reconciliation_started", merchantId, paymentId }, "Payment state UNKNOWN; reconciling before recovery eligibility");
    try {
      await reconcilePayment(prisma, merchantId, paymentId);
    } catch (err) {
      logger.warn({ event: "recovery.reconciliation_failed", merchantId, paymentId, err: (err as Error).message }, "Reconciliation attempt failed");
    }
    const reloaded = await findPaymentById(prisma, merchantId, paymentId);
    if (reloaded) currentPayment = reloaded;
  }

  const policy = await getMerchantPolicy(prisma, merchantId);
  const growthConfig = await getGrowthConfig(prisma, merchantId);
  const recoveryAttemptCount = await countPriorRecoveryAttempts(prisma, merchantId, { recommendationId: null, sourceOrderId: order.id }, "");

  const eligibility = evaluateRecoveryEligibility({
    paymentState: currentPayment.state,
    failureCategory: currentPayment.failureCategory as PaymentFailureCategory | null,
    orderStatus: order.status,
    recoveryAttemptCount,
    maxRecoveryAttempts: policy.maxRecoveryAttempts,
  });

  await appendLedgerEvent(prisma, {
    workflowId,
    merchantId,
    actorType: "SYSTEM",
    actionType: "RECOVERY_ELIGIBILITY_EVALUATED",
    status: "EXECUTED",
    conciseReason: `Recovery eligibility: ${eligibility.outcome} (${eligibility.reasonCodes.join(", ")}).`,
    relatedEntityType: "Payment",
    relatedEntityId: paymentId,
    metadata: { outcome: eligibility.outcome, reasonCodes: eligibility.reasonCodes, recoveryAttemptCount, maxRecoveryAttempts: policy.maxRecoveryAttempts },
    executedAt: now,
  });
  logger.info({ event: "recovery.eligibility_evaluated", merchantId, paymentId, outcome: eligibility.outcome }, "Recovery eligibility evaluated");

  const recoveryActionEnabled = allowedActionTypes(growthConfig).includes("RECOVERY");
  const allowedActions: RecoveryAction[] = eligibility.outcome === "ELIGIBLE" && recoveryActionEnabled ? ["RETRY_SAME_CHECKOUT"] : [];

  // `primaryProductId` continuity (PART 08 §19): the recovery proposal
  // must reference the SAME product the failed order was actually for.
  //
  // This used to be read from the order's originating growth proposal,
  // guarded by the assumption that "every order this codebase creates
  // goes through CommerceExecutionService, which always sets
  // growthProposalId". That assumption only ever held for AGENT-ORIGINATED
  // orders. A direct buyer whose card is declined has no growth proposal
  // and never will — and that is the single most valuable payment a
  // merchant wants recovered. The guard turned it into a hard 409, so
  // recovery was unreachable for exactly the case it exists to serve.
  //
  // The order's own items are a better source anyway: they state, without
  // indirection, what was actually being bought. The proposal is still
  // preferred when one exists, so agent-originated recoveries keep their
  // existing provenance.
  const originalProposal = order.growthProposalId
    ? await prisma.growthActionProposal.findFirst({ where: { id: order.growthProposalId, merchantId } })
    : null;

  const firstItem = await prisma.orderItem.findFirst({
    where: { orderId: order.id },
    orderBy: { id: "asc" },
    select: { variant: { select: { productId: true } } },
  });

  const primaryProductId = originalProposal?.primaryProductId ?? firstItem?.variant.productId ?? null;
  if (!primaryProductId) {
    // An order with no items at all is genuinely unrecoverable — there is
    // nothing to retry a purchase OF. Still a conflict, but now it means
    // what it says.
    throw AppError.conflict("This order has no line items, so there is no product to recover a purchase for.");
  }

  if (allowedActions.length === 0) {
    return persistRecoveryProposal(prisma, {
      merchantId,
      workflowId,
      primaryProductId,
      sourceOrderId: order.id,
      sourcePaymentId: paymentId,
      sourceCheckoutId: checkout.id,
      mode: "NO_OPPORTUNITY",
      action: null,
      reasonCodes: [],
      rejectionReason: eligibility.explanation,
      orderAmountMinor: order.totalAmountMinor,
      currency: order.currency,
    });
  }

  let mode: "AI_PROPOSED" | "DETERMINISTIC_FALLBACK" = "DETERMINISTIC_FALLBACK";
  let chosenAction: RecoveryAction = deterministicRecoveryAction(eligibility.outcome);
  let reasonCodes: GrowthReasonCode[] = ["RETRYABLE_PAYMENT_FAILURE", "RECOVERY_ATTEMPT_AVAILABLE"];

  if (provider.mode === "LIVE_ANTHROPIC") {
    for (let attempt = 0; attempt <= MAX_RECOVERY_AI_RETRIES; attempt++) {
      try {
        const raw = await provider.proposeRecoveryAction({
          failureCategory: currentPayment.failureCategory ?? "UNKNOWN_FAILURE",
          currentAttemptNumber: recoveryAttemptCount + 1,
          maxRecoveryAttempts: policy.maxRecoveryAttempts,
          orderAmountMinor: order.totalAmountMinor,
          currency: order.currency,
          allowedActions,
        });
        const validation = validateRecoveryProposal(raw, { allowedActions, recoveryActionEnabled });
        if (validation.ok) {
          chosenAction = validation.action;
          reasonCodes = (raw.reasonCodes.filter((c) => c) as GrowthReasonCode[]).length > 0 ? (raw.reasonCodes as GrowthReasonCode[]) : reasonCodes;
          mode = "AI_PROPOSED";
        } else {
          logger.warn({ event: "recovery.proposal_grounding_failed", merchantId, paymentId, reason: validation.reason }, "AI recovery proposal failed grounding; using deterministic fallback");
        }
        break;
      } catch (err) {
        logger.warn({ event: "recovery.ai_call_failed", merchantId, paymentId, attempt, error: (err as Error).message }, "Merchant Agent recovery proposal attempt failed");
      }
    }
  }

  return persistRecoveryProposal(prisma, {
    merchantId,
    workflowId,
    primaryProductId,
    sourceOrderId: order.id,
    sourcePaymentId: paymentId,
    sourceCheckoutId: checkout.id,
    mode,
    action: chosenAction,
    reasonCodes,
    rejectionReason: null,
    orderAmountMinor: order.totalAmountMinor,
    currency: order.currency,
  });
}

async function persistRecoveryProposal(
  prisma: PrismaClient,
  params: {
    merchantId: string;
    workflowId: string;
    primaryProductId: string;
    sourceOrderId: string;
    sourcePaymentId: string;
    sourceCheckoutId: string;
    mode: "AI_PROPOSED" | "DETERMINISTIC_FALLBACK" | "NO_OPPORTUNITY";
    action: RecoveryAction | null;
    reasonCodes: GrowthReasonCode[];
    rejectionReason: string | null;
    orderAmountMinor: number;
    currency: string;
  },
): Promise<GrowthActionProposalDTO> {
  const status = params.action === "RETRY_SAME_CHECKOUT" ? "PROPOSED" : "REJECTED_VALIDATION";
  const explanation =
    status === "PROPOSED"
      ? renderGrowthExplanation(params.reasonCodes)
      : `Recovery not proposed: ${params.rejectionReason ?? "no safe recovery action is available."}`;
  const evidence: GrowthEvidenceDTO[] = [{ type: "PRICE_DELTA", detail: `Order amount: ${params.orderAmountMinor} minor units` }];

  const row = await createProposal(prisma, {
    merchantId: params.merchantId,
    conversationId: null,
    recommendationId: null,
    primaryProductId: params.primaryProductId,
    actionType: status === "PROPOSED" ? "RECOVERY" : null,
    relatedProductIds: [],
    offerKind: null,
    offerPercentageBps: null,
    offerAmountMinor: null,
    offerCurrency: null,
    offerCalculation: null,
    // Reused unchanged by the EXISTING Policy Engine's order-amount tiers
    // (`proposalOpportunity().potentialBasketMinor`) — RETRY_SAME_CHECKOUT
    // never changes the amount, so current === potential (PART 08 §33-34).
    opportunity: { currentBasketMinor: params.orderAmountMinor, potentialBasketMinor: params.orderAmountMinor, opportunityDeltaMinor: 0, currency: params.currency } as never,
    evidence: evidence as never,
    reasonCodes: params.reasonCodes,
    explanation,
    mode: params.mode,
    status,
    rejectionReason: status === "REJECTED_VALIDATION" ? explanation : null,
    blockedOpportunities: [] as never,
    traceId: params.workflowId,
    recoveryAction: params.action,
    sourceOrderId: params.sourceOrderId,
    sourcePaymentId: params.sourcePaymentId,
    sourceCheckoutId: params.sourceCheckoutId,
  });

  await appendLedgerEvent(prisma, {
    workflowId: params.workflowId,
    merchantId: params.merchantId,
    actorType: "MERCHANT_AGENT",
    actionType: status === "PROPOSED" ? "RECOVERY_PROPOSAL_CREATED" : "RECOVERY_BLOCKED",
    status: "EXECUTED",
    conciseReason: explanation,
    relatedEntityType: "GrowthActionProposal",
    relatedEntityId: row.id,
    metadata: { recoveryAction: params.action, mode: params.mode },
  });

  logger.info({ event: "recovery.proposal_generated", merchantId: params.merchantId, workflowId: params.workflowId, status, action: params.action, mode: params.mode }, "Recovery proposal generated");

  return toGrowthActionProposalDTO(row);
}
