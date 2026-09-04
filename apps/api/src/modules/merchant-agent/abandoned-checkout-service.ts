/**
 * PART 18 — the merchant agent can finally act on an abandoned checkout.
 *
 * `ABANDONED_CHECKOUT_RECOVERY` has been detected since the opportunity
 * engine was written, complete with a value, an evidence trail and the
 * action label "Re-issue a checkout link for the abandoned baskets". No
 * tool consumed it, so the finding appeared on the merchant's screen every
 * cycle and nothing could ever be done about it — the agent's only
 * recovery path is `evaluateRecoveryEligibility`, which refuses a payment
 * in CREATED with `FAILURE_NOT_RETRYABLE` because nothing has definitively
 * failed yet. That refusal is correct. This is the separate, smaller
 * action it was refusing to be.
 *
 * WHAT EXECUTION ACTUALLY DOES
 *
 * Extends the EXISTING checkout session's expiry and returns it to
 * READY_FOR_PAYMENT. It creates no order, no payment, no new session, and
 * changes no amount. `executeRecovery` by contrast creates a whole new
 * checkout for a new attempt — right for a failed payment, wrong here,
 * where the original attempt may still be live.
 *
 * The safety rules live in `@razorgrowth/domain`'s `checkout-reissue.ts`
 * as a pure function, and are re-checked here immediately before the write
 * rather than trusted from proposal time: an authorization can sit for ten
 * minutes, and a buyer can complete their payment inside that window.
 */
import type { PrismaClient } from "@prisma/client";
import {
  CHECKOUT_REISSUE_VALIDITY_HOURS,
  evaluateCheckoutReissueEligibility,
  systemClock,
  type CheckoutReissueDecision,
} from "@razorgrowth/domain";
import { AppError } from "../../http/errors.js";
import { logger } from "../../observability/logger.js";
import { appendLedgerEvent, withLedgerConcurrencyRetry } from "../audit/ledger.js";
import { consumeExecutionAuthorization, findExecutionAuthorizationById, findProposalForGovernance } from "../policy/repository.js";
import { fingerprintFromProposal } from "../policy/service.js";
import { createIdempotencyRecord, findIdempotencyRecord, isIdempotencyUniqueConflict } from "../commerce/idempotency.js";
import { createProposal } from "./repository.js";

/**
 * Distinct from `RECOVERY_ACTIONS` in the domain, deliberately. That
 * vocabulary belongs to failed-payment recovery, and `executeRecovery` now
 * requires `RETRY_SAME_CHECKOUT` explicitly so a proposal of this kind can
 * never be routed into it — the two share the `RECOVERY` action type and
 * the `source*` columns, and only this string separates them.
 */
export const CHECKOUT_REISSUE_ACTION = "REISSUE_CHECKOUT";

const REISSUE_OPERATION = "checkout_reissue_execution";

export interface CheckoutReissueExecutionResult {
  checkoutId: string;
  expiresAt: string;
  status: string;
}

/**
 * Everything the pure rules need, read in one place.
 *
 * `inventoryStillReserved` is derived rather than stored: stock goes back
 * on two paths — `maintenance-service.ts` cancels the order when it expires
 * a checkout, and `payment-transition.ts` releases an AGENT_GATEWAY
 * reservation on verified terminal failure, stamping `inventoryReleasedAt`
 * on the authorizing `DecisionRecord`. An order still PENDING or
 * PAYMENT_PENDING whose decision record carries no release stamp is still
 * holding its stock.
 */
async function readReissueFacts(prisma: PrismaClient, merchantId: string, orderId: string) {
  // Addressed by ORDER, not by checkout session.
  //
  // That is what the opportunity engine emits — `subjectIds` for an
  // abandoned checkout are order ids, because `operations-service.ts`
  // attaches the finding to the Orders table a merchant actually reads.
  // The first version of this took a checkout id, and the autonomous
  // cycle handed it an order id every time: the tool refused with "not
  // found" before it could even propose, which the cycle correctly
  // recorded as a refusal and which was really a wiring mistake.
  //
  // An order can own several sessions — failed-payment recovery creates a
  // new one per attempt — so the newest is the one that represents the
  // basket as it stands.
  const checkout = await prisma.checkoutSession.findFirst({
    where: { orderId, merchantId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      createdAt: true,
      expiresAt: true,
      workflowId: true,
      order: {
        select: {
          id: true,
          status: true,
          source: true,
          authorizationId: true,
          totalAmountMinor: true,
          currency: true,
          items: { select: { variant: { select: { productId: true } } }, take: 1 },
          payments: { orderBy: { createdAt: "desc" }, select: { id: true, state: true } },
        },
      },
    },
  });
  if (!checkout) throw AppError.notFound(`No checkout session found for order: ${orderId}`);

  let released = false;
  if (checkout.order.status === "CANCELLED" || checkout.order.status === "FAILED") {
    released = true;
  } else if (checkout.order.source === "AGENT_GATEWAY" && checkout.order.authorizationId) {
    const record = await prisma.decisionRecord.findFirst({
      where: { id: checkout.order.authorizationId, merchantId },
      select: { inventoryReleasedAt: true },
    });
    released = record?.inventoryReleasedAt != null;
  }

  const now = systemClock.now();
  const ageHours = (now.getTime() - checkout.createdAt.getTime()) / 3_600_000;
  return {
    checkout,
    ageHours,
    inventoryStillReserved: !released,
    windowStillOpen: checkout.expiresAt.getTime() > now.getTime(),
  };
}

export interface CheckoutReissueProposalResult {
  id: string;
  status: string;
  rejectionReason: string | null;
  decision: CheckoutReissueDecision;
}

/**
 * Decides, then records the decision either way.
 *
 * A refusal is persisted as `REJECTED_VALIDATION` rather than thrown away,
 * for the same reason failed-payment recovery does it: "the agent looked at
 * this and declined" is a governance fact a merchant is entitled to read
 * back, and an agent that only leaves a trail when it acts is not
 * auditable.
 */
export async function evaluateAndProposeCheckoutReissue(
  prisma: PrismaClient,
  merchantId: string,
  orderId: string,
): Promise<CheckoutReissueProposalResult> {
  const { checkout, ageHours, inventoryStillReserved, windowStillOpen } = await readReissueFacts(prisma, merchantId, orderId);

  const decision = evaluateCheckoutReissueEligibility({
    checkoutStatus: checkout.status,
    orderStatus: checkout.order.status,
    paymentStates: checkout.order.payments.map((payment) => payment.state),
    ageHours,
    inventoryStillReserved,
    windowStillOpen,
  });

  const eligible = decision.outcome === "ELIGIBLE";
  const status = eligible ? "PROPOSED" : "REJECTED_VALIDATION";

  // `primaryProductId` is required by the proposal shape. The first line's
  // product identifies the basket; nothing downstream prices from it,
  // because this action never carries an offer.
  const primaryProductId = checkout.order.items[0]?.variant.productId;
  if (!primaryProductId) throw new AppError("COMMERCE_STATE_CHANGED", "This checkout's order has no line items to re-issue.");

  const row = await createProposal(prisma, {
    merchantId,
    conversationId: null,
    recommendationId: null,
    primaryProductId,
    actionType: eligible ? "RECOVERY" : null,
    relatedProductIds: [],
    // No offer, ever. Whether the buyer should also be given a discount to
    // return is a different action with its own governance; folding it in
    // here would let "remind them" quietly become "discount it".
    offerKind: null,
    offerPercentageBps: null,
    offerAmountMinor: null,
    offerCurrency: null,
    offerCalculation: null,
    // The amount does not change, so current === potential and the policy
    // engine's discount tiers see a zero delta. Its ORDER-amount tiers
    // still apply, which is what makes a large basket need approval.
    opportunity: {
      currentBasketMinor: checkout.order.totalAmountMinor,
      potentialBasketMinor: checkout.order.totalAmountMinor,
      opportunityDeltaMinor: 0,
      currency: checkout.order.currency,
    } as never,
    evidence: [
      { type: "PRICE_DELTA", detail: `Basket held in this checkout: ${checkout.order.totalAmountMinor} minor units` },
      { type: "PRICE_DELTA", detail: `Idle for ${Math.floor(ageHours)} hours with no payment taken` },
    ] as never,
    reasonCodes: decision.reasonCodes,
    explanation: decision.explanation,
    mode: "DETERMINISTIC_RELATIONSHIP",
    status,
    rejectionReason: eligible ? null : decision.explanation,
    blockedOpportunities: [] as never,
    traceId: checkout.workflowId,
    recoveryAction: CHECKOUT_REISSUE_ACTION,
    sourceOrderId: checkout.order.id,
    sourcePaymentId: checkout.order.payments[0]?.id ?? null,
    sourceCheckoutId: checkout.id,
  });

  await appendLedgerEvent(prisma, {
    workflowId: checkout.workflowId,
    merchantId,
    actorType: "MERCHANT_AGENT",
    actionType: eligible ? "CHECKOUT_REISSUE_PROPOSED" : "CHECKOUT_REISSUE_BLOCKED",
    status: "EXECUTED",
    conciseReason: decision.explanation,
    relatedEntityType: "GrowthActionProposal",
    relatedEntityId: row.id,
    metadata: { checkoutId: checkout.id, outcome: decision.outcome, reasonCodes: decision.reasonCodes },
  });

  logger.info(
    { event: "checkout_reissue.proposed", merchantId, orderId, checkoutId: checkout.id, outcome: decision.outcome, status },
    "Abandoned checkout re-issue evaluated",
  );

  return { id: row.id, status: row.status, rejectionReason: row.rejectionReason, decision };
}

/**
 * Hands the basket back.
 *
 * Every guard `evaluateAndProposeCheckoutReissue` applied is applied again
 * here against freshly-read rows. An authorization is valid for about ten
 * minutes, and a buyer can finish paying inside ten minutes — re-opening a
 * checkout on the strength of a decision made before that would be exactly
 * the double charge this whole path exists to avoid.
 */
export async function executeCheckoutReissue(
  prisma: PrismaClient,
  merchantId: string,
  authorizationId: string,
  idempotencyKey: string,
): Promise<CheckoutReissueExecutionResult> {
  const existing = await findIdempotencyRecord(prisma, merchantId, REISSUE_OPERATION, idempotencyKey);
  if (existing) {
    if (existing.requestFingerprint !== authorizationId) {
      throw new AppError("IDEMPOTENCY_CONFLICT", "This idempotency key was already used for a different checkout re-issue.");
    }
    return existing.responseSnapshot as unknown as CheckoutReissueExecutionResult;
  }

  const now = systemClock.now();
  const authorization = await findExecutionAuthorizationById(prisma, merchantId, authorizationId);
  if (!authorization) throw AppError.notFound(`Execution authorization not found: ${authorizationId}`);
  if (authorization.status === "CONSUMED") {
    throw new AppError("AUTHORIZATION_ALREADY_CONSUMED", "This re-issue authorization has already been consumed.");
  }
  if (authorization.status !== "ACTIVE") {
    throw new AppError("AUTHORIZATION_NOT_ALLOWED", `Re-issue authorization is not active (status: ${authorization.status}).`);
  }
  if (authorization.expiresAt.getTime() <= now.getTime()) {
    throw new AppError("AUTHORIZATION_EXPIRED", "Re-issue authorization has expired.");
  }

  const proposal = await findProposalForGovernance(prisma, merchantId, authorization.proposalId);
  if (!proposal || proposal.recoveryAction !== CHECKOUT_REISSUE_ACTION || !proposal.sourceOrderId) {
    throw new AppError("AUTHORIZATION_NOT_ALLOWED", "This authorization does not correspond to a checkout re-issue proposal.");
  }
  if (fingerprintFromProposal(proposal) !== authorization.proposalFingerprint) {
    throw new AppError("PROPOSAL_CHANGED", "The re-issue proposal has changed since authorization was issued.");
  }

  const { checkout, ageHours, inventoryStillReserved, windowStillOpen } = await readReissueFacts(prisma, merchantId, proposal.sourceOrderId);
  const recheck = evaluateCheckoutReissueEligibility({
    checkoutStatus: checkout.status,
    orderStatus: checkout.order.status,
    paymentStates: checkout.order.payments.map((payment) => payment.state),
    ageHours,
    inventoryStillReserved,
    windowStillOpen,
  });
  if (recheck.outcome !== "ELIGIBLE") {
    // Not a failure of this execution — the world moved, most likely
    // because the buyer paid. Reported as a state change so the caller
    // records a refusal rather than an error.
    throw new AppError("COMMERCE_STATE_CHANGED", `This checkout can no longer be re-issued: ${recheck.explanation}`);
  }

  const expiresAt = new Date(now.getTime() + CHECKOUT_REISSUE_VALIDITY_HOURS * 3_600_000);

  try {
    const response = await withLedgerConcurrencyRetry(prisma, async (tx) => {
      const consumed = await consumeExecutionAuthorization(tx, authorization.id);
      if (!consumed) throw new AppError("AUTHORIZATION_ALREADY_CONSUMED", "This re-issue authorization was consumed by a concurrent request.");

      // The one write. Filtering on a still-re-issuable status is the last
      // line of defence: if a concurrent payment moved the session to
      // COMPLETED between the recheck above and this statement, this
      // matches zero rows and the whole transaction refuses.
      const updated = await tx.checkoutSession.updateMany({
        where: { id: checkout.id, merchantId, status: { in: ["CREATED", "READY_FOR_PAYMENT", "PAYMENT_IN_PROGRESS"] } },
        data: { status: "READY_FOR_PAYMENT", expiresAt },
      });
      if (updated.count !== 1) {
        throw new AppError("COMMERCE_STATE_CHANGED", "The checkout changed state while it was being re-issued.");
      }

      await appendLedgerEvent(tx, {
        workflowId: checkout.workflowId,
        merchantId,
        actorType: "SYSTEM",
        actionType: "CHECKOUT_REISSUE_AUTHORIZATION_CONSUMED",
        status: "EXECUTED",
        conciseReason: "Re-issue authorization consumed to re-open one abandoned checkout.",
        relatedEntityType: "ExecutionAuthorization",
        relatedEntityId: authorization.id,
        executedAt: now,
      });
      await appendLedgerEvent(tx, {
        workflowId: checkout.workflowId,
        merchantId,
        actorType: "COMMERCE",
        actionType: "CHECKOUT_REISSUED",
        status: "EXECUTED",
        // Deliberately not "recovered X". Nothing has been recovered — the
        // buyer has been given back the chance to decide.
        conciseReason: `Abandoned checkout re-opened until ${expiresAt.toISOString()}. The same basket at the same price; no payment was taken.`,
        relatedEntityType: "CheckoutSession",
        relatedEntityId: checkout.id,
        metadata: { orderId: checkout.order.id, amountMinor: checkout.order.totalAmountMinor, idleHours: Math.floor(ageHours) },
        executedAt: now,
      });

      const responseBody: CheckoutReissueExecutionResult = {
        checkoutId: checkout.id,
        expiresAt: expiresAt.toISOString(),
        status: "READY_FOR_PAYMENT",
      };
      await createIdempotencyRecord(tx, {
        merchantId,
        operation: REISSUE_OPERATION,
        idempotencyKey,
        requestFingerprint: authorizationId,
        responseSnapshot: responseBody as never,
      });
      return responseBody;
    });

    logger.info({ event: "checkout_reissue.executed", merchantId, checkoutId: response.checkoutId }, "Abandoned checkout re-issued");
    return response;
  } catch (err) {
    if (isIdempotencyUniqueConflict(err)) {
      const winner = await findIdempotencyRecord(prisma, merchantId, REISSUE_OPERATION, idempotencyKey);
      if (winner) return winner.responseSnapshot as unknown as CheckoutReissueExecutionResult;
    }
    throw err;
  }
}
