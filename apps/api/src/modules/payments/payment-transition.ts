/**
 * The single place a verified provider fact becomes an internal
 * `Payment`/`Order`/`CheckoutSession` state change (PART 07 §20-§22,
 * §52-§57). Called from three places — the webhook processor, the client-
 * completion verification route, and manual reconciliation — so all three
 * evidence sources go through the exact same deterministic transition
 * logic, never three separately-maintained copies (PART 07 §41's evidence
 * hierarchy is enforced structurally: whichever caller has the freshest
 * verified fact calls this function, and illegal/stale transitions are
 * rejected here regardless of which caller triggered them).
 *
 * No AI dependency, no frontend trust: every input here is either already
 * persisted (`Payment`, `Order`) or came from a signature-verified /
 * directly-fetched provider response (PART 07 §20).
 */
import type { Order, Payment, PaymentState, Prisma } from "@prisma/client";
import { canTransitionPaymentState } from "@razorgrowth/domain";
import { normalizeRazorpayFailure } from "./failure-mapper.js";
import { applyPaymentTransition } from "./payment-repository.js";
import { setOrderStatus } from "../commerce/order-repository.js";
import { updateCheckoutStatus } from "../commerce/checkout-repository.js";
import { appendLedgerEvent } from "../audit/ledger.js";
import { tryAutoConvertCampaignOnPaymentCapture } from "../campaigns/auto-attribution.js";
import type { ProviderPaymentInfo } from "./gateway.js";

export type PaymentEvidenceSource = "WEBHOOK" | "CLIENT_VERIFICATION" | "RECONCILE" | "FACILITATOR";

export interface ResolvePaymentEventResult {
  applied: boolean;
  fromState: PaymentState;
  toState: PaymentState;
  integrityError: boolean;
  reason: string;
}

function mapProviderStatus(providerStatus: string): PaymentState | null {
  switch (providerStatus) {
    case "created":
      return "CREATED";
    case "authorized":
      return "AUTHORIZED";
    case "captured":
      return "CAPTURED";
    case "failed":
      return "FAILED";
    default:
      // "refunded" and any other provider status PART 07 does not model
      // (refunds are explicitly out of scope, §186) resolve to UNKNOWN
      // rather than guessing.
      return null;
  }
}

/**
 * Applies one piece of verified provider evidence to a `Payment` row,
 * inside an already-open transaction, and cascades to `Order`/
 * `CheckoutSession` only on the transitions that legitimately require it
 * (§52-§53). Every branch appends its own ledger event on the checkout's
 * `workflowId` so the full proposal → ... → payment story stays one
 * continuous, hash-verifiable timeline (PART 07 §77-§78).
 */
export async function resolvePaymentEvent(
  tx: Prisma.TransactionClient,
  params: {
    workflowId: string;
    merchantId: string;
    payment: Payment;
    order: Order;
    checkoutId: string;
    providerInfo: ProviderPaymentInfo;
    source: PaymentEvidenceSource;
    now: Date;
  },
): Promise<ResolvePaymentEventResult> {
  const { payment, order, providerInfo, now } = params;

  // PART 07 §55-§57 — financial integrity checks BEFORE any state
  // mutation. A mismatch here means the provider's evidence does not
  // describe the payment we actually authorized; the safe response is to
  // refuse the transition, not to silently trust the provider's number.
  if (providerInfo.amountMinor !== payment.amountMinor || providerInfo.currency.toUpperCase() !== payment.currency) {
    // A TERMINAL payment is never dragged back to UNKNOWN.
    //
    // This forced UNKNOWN before consulting the state machine, so a late,
    // inconsistent event could regress a CAPTURED payment while its Order
    // stayed PAID — leaving the two disagreeing about whether money moved,
    // which is precisely the confusion the state machine exists to
    // prevent. The integrity error is still recorded loudly; what changes
    // is that a settled fact stays settled.
    const isTerminal = payment.state === "CAPTURED" || payment.state === "FAILED" || payment.state === "CANCELLED";
    if (!isTerminal) {
      await applyPaymentTransition(tx, payment.id, { state: "UNKNOWN" });
    }
    await appendLedgerEvent(tx, {
      workflowId: params.workflowId,
      merchantId: params.merchantId,
      actorType: "PAYMENT_SYSTEM",
      actionType: "PAYMENT_FINANCIAL_INTEGRITY_ERROR",
      status: "FAILED",
      conciseReason: `Provider-reported amount/currency (${providerInfo.amountMinor} ${providerInfo.currency}) does not match the authorized payment (${payment.amountMinor} ${payment.currency}).${isTerminal ? ` The payment is already ${payment.state} and was NOT regressed; this event is recorded for investigation.` : ""}`,
      relatedEntityType: "Payment",
      relatedEntityId: payment.id,
      executedAt: now,
    });
    return {
      applied: false,
      fromState: payment.state,
      toState: isTerminal ? payment.state : "UNKNOWN",
      integrityError: true,
      reason: "AMOUNT_OR_CURRENCY_MISMATCH",
    };
  }
  if (payment.providerOrderId && providerInfo.providerOrderId && providerInfo.providerOrderId !== payment.providerOrderId) {
    await appendLedgerEvent(tx, {
      workflowId: params.workflowId,
      merchantId: params.merchantId,
      actorType: "PAYMENT_SYSTEM",
      actionType: "PAYMENT_FINANCIAL_INTEGRITY_ERROR",
      status: "FAILED",
      conciseReason: `Provider payment references an unexpected provider order (${providerInfo.providerOrderId}); refusing to link it to this payment.`,
      relatedEntityType: "Payment",
      relatedEntityId: payment.id,
      executedAt: now,
    });
    return { applied: false, fromState: payment.state, toState: payment.state, integrityError: true, reason: "PROVIDER_ORDER_MISMATCH" };
  }

  const candidate = mapProviderStatus(providerInfo.providerStatus);
  if (!candidate) {
    return { applied: false, fromState: payment.state, toState: payment.state, integrityError: false, reason: `UNMODELED_PROVIDER_STATUS:${providerInfo.providerStatus}` };
  }
  if ((candidate === "AUTHORIZED" || candidate === "CAPTURED") && !providerInfo.providerPaymentId) {
    await appendLedgerEvent(tx, {
      workflowId: params.workflowId,
      merchantId: params.merchantId,
      actorType: "PAYMENT_SYSTEM",
      actionType: "PAYMENT_FINANCIAL_INTEGRITY_ERROR",
      status: "FAILED",
      conciseReason: `Provider evidence claimed ${candidate} without a transaction identifier; the transition was refused.`,
      relatedEntityType: "Payment",
      relatedEntityId: payment.id,
      executedAt: now,
    });
    return { applied: false, fromState: payment.state, toState: payment.state, integrityError: true, reason: "MISSING_PROVIDER_PAYMENT_ID" };
  }

  // PART 07 §21-§24 — the domain state machine is the single authority on
  // transition legality; a stale/out-of-order event that would regress a
  // terminal state is rejected here, not specially detected per caller.
  if (!canTransitionPaymentState(payment.state, candidate)) {
    await appendLedgerEvent(tx, {
      workflowId: params.workflowId,
      merchantId: params.merchantId,
      actorType: "PAYMENT_SYSTEM",
      actionType: "PAYMENT_STATE_TRANSITION_REJECTED",
      status: "REJECTED",
      conciseReason: `Rejected illegal/stale transition ${payment.state} -> ${candidate} (source: ${params.source}).`,
      relatedEntityType: "Payment",
      relatedEntityId: payment.id,
      metadata: { fromState: payment.state, attemptedState: candidate, source: params.source },
      executedAt: now,
    });
    return { applied: false, fromState: payment.state, toState: payment.state, integrityError: false, reason: "ILLEGAL_OR_STALE_TRANSITION" };
  }

  if (candidate === payment.state) {
    // Same-state event (idempotent no-op per the domain state machine) —
    // nothing new to apply or record; the provider re-confirmed what we
    // already know.
    return { applied: true, fromState: payment.state, toState: candidate, integrityError: false, reason: "ALREADY_IN_STATE" };
  }

  if (candidate === "AUTHORIZED") {
    await applyPaymentTransition(tx, payment.id, { state: "AUTHORIZED", providerPaymentId: providerInfo.providerPaymentId, authorizedAt: now });
    await appendLedgerEvent(tx, {
      workflowId: params.workflowId,
      merchantId: params.merchantId,
      actorType: "PAYMENT_SYSTEM",
      actionType: "PAYMENT_AUTHORIZED",
      status: "EXECUTED",
      conciseReason: `Payment authorized (source: ${params.source}).`,
      relatedEntityType: "Payment",
      relatedEntityId: payment.id,
      executedAt: now,
    });
    return { applied: true, fromState: payment.state, toState: "AUTHORIZED", integrityError: false, reason: "OK" };
  }

  if (candidate === "CAPTURED") {
    await applyPaymentTransition(tx, payment.id, {
      state: "CAPTURED",
      customerDebitStatus: "DEBITED",
      merchantCreditStatus: "CREDITED",
      automaticRetryBlocked: false,
      providerPaymentId: providerInfo.providerPaymentId!,
      capturedAt: providerInfo.capturedAt ?? now,
      providerMetadata: { method: providerInfo.method } as Prisma.InputJsonValue,
    });
    await setOrderStatus(tx, order.id, "PAID");
    await updateCheckoutStatus(tx, params.checkoutId, "COMPLETED");
    // THE ORDER BECOMING REAL IS ITS OWN FACT.
    //
    // `PAYMENT_CAPTURED` below says money arrived. It does not say the
    // order is now a confirmed order, and nothing else did either: the
    // status went PAYMENT_PENDING -> PAID with no ledger entry, so the
    // last link of the chain — the one the buyer actually cares about —
    // was the only one that left no trace. Written before the payment
    // event so the timeline reads payment-then-order in the order the
    // states actually settled.
    await appendLedgerEvent(tx, {
      workflowId: params.workflowId,
      merchantId: params.merchantId,
      actorType: "COMMERCE",
      actionType: "ORDER_CONFIRMED",
      status: "EXECUTED",
      conciseReason: `Order confirmed against a verified capture of ${payment.amountMinor} ${payment.currency} minor units.`,
      relatedEntityType: "Order",
      relatedEntityId: order.id,
      metadata: { paymentId: payment.id, source: params.source },
      executedAt: now,
    });
    if (order.source === "AGENT_GATEWAY" && order.authorizationId) {
      const decision = await tx.decisionRecord.findUnique({ where: { id: order.authorizationId } });
      if (decision && decision.merchantId === params.merchantId) {
        const settled = await tx.decisionRecord.updateMany({
          where: {
            id: decision.id,
            OR: [{ settlementStatus: null }, { settlementStatus: { not: "CAPTURED" } }],
          },
          data: {
            providerPaymentId: providerInfo.providerPaymentId!,
            settlementStatus: "CAPTURED",
            settledAt: providerInfo.capturedAt ?? now,
          },
        });
        // Trust is earned only by the first verified capture transition,
        // never by provider-order creation or a browser callback alone.
        if (settled.count === 1 && decision.agentIdentityId) {
          await tx.agentIdentity.update({
            where: { id: decision.agentIdentityId },
            data: { settledOrderCount: { increment: 1 } },
          });
        }
        await tx.acpCheckoutSession.updateMany({
          where: { decisionRecordId: decision.id },
          data: { status: "completed" },
        });
      }
    }

    // Automatically record campaign conversion if this order is attributed to an active campaign
    await tryAutoConvertCampaignOnPaymentCapture(tx, payment.id).catch(() => undefined);

    // PART 07 §98-§103 — this is the first point an order's value may
    // legitimately become OBSERVED (paid) revenue; attribution fields are
    // read straight off the already-persisted Order, never recomputed.
    await appendLedgerEvent(tx, {
      workflowId: params.workflowId,
      merchantId: params.merchantId,
      actorType: "PAYMENT_SYSTEM",
      actionType: "PAYMENT_CAPTURED",
      status: "EXECUTED",
      conciseReason: `Payment captured: ${payment.amountMinor} ${payment.currency} minor units (source: ${params.source}).`,
      relatedEntityType: "Payment",
      relatedEntityId: payment.id,
      metadata: {
        orderId: order.id,
        amountMinor: payment.amountMinor,
        currency: payment.currency,
        source: order.source,
        growthProposalId: order.growthProposalId,
        authorizationId: order.authorizationId,
        gatewayDecisionId: order.source === "AGENT_GATEWAY" ? order.authorizationId : null,
      },
      executedAt: now,
    });
    return { applied: true, fromState: payment.state, toState: "CAPTURED", integrityError: false, reason: "OK" };
  }

  if (candidate === "FAILED") {
    const failureCategory = normalizeRazorpayFailure(providerInfo.errorCode, providerInfo.errorDescription);
    await applyPaymentTransition(tx, payment.id, {
      state: "FAILED",
      customerDebitStatus: "UNKNOWN",
      merchantCreditStatus: "NOT_CREDITED",
      automaticRetryBlocked: true,
      providerPaymentId: providerInfo.providerPaymentId,
      failureCode: providerInfo.errorCode,
      failureCategory,
      failedAt: now,
    });
    await setOrderStatus(tx, order.id, "FAILED");
    await updateCheckoutStatus(tx, params.checkoutId, "FAILED");
    if (order.source === "AGENT_GATEWAY" && order.authorizationId) {
      const releaseClaim = await tx.decisionRecord.updateMany({
        where: { id: order.authorizationId, merchantId: params.merchantId, inventoryReleasedAt: null },
        data: { inventoryReleasedAt: now, settlementStatus: "FAILED" },
      });
      if (releaseClaim.count === 1) {
        const lines = await tx.orderItem.findMany({ where: { orderId: order.id }, select: { variantId: true, quantity: true } });
        for (const line of lines) {
          await tx.inventory.update({
            where: { variantId: line.variantId },
            data: { availableQuantity: { increment: line.quantity } },
          });
        }
        await appendLedgerEvent(tx, {
          workflowId: params.workflowId,
          merchantId: params.merchantId,
          actorType: "COMMERCE",
          actionType: "AGENT_INVENTORY_RESERVATION_RELEASED",
          status: "EXECUTED",
          conciseReason: "Verified terminal payment failure released the external agent order's inventory reservation exactly once.",
          relatedEntityType: "Order",
          relatedEntityId: order.id,
          executedAt: now,
        });
      }
      await tx.acpCheckoutSession.updateMany({
        where: { decisionRecordId: order.authorizationId },
        data: { status: "payment_failed" },
      });
    }
    await appendLedgerEvent(tx, {
      workflowId: params.workflowId,
      merchantId: params.merchantId,
      actorType: "PAYMENT_SYSTEM",
      actionType: "PAYMENT_FAILED",
      status: "FAILED",
      conciseReason: `Payment failed: ${failureCategory} (source: ${params.source}).`,
      relatedEntityType: "Payment",
      relatedEntityId: payment.id,
      metadata: { failureCode: providerInfo.errorCode, failureCategory, recoveryStatus: "NOT_EVALUATED" },
      executedAt: now,
    });
    return { applied: true, fromState: payment.state, toState: "FAILED", integrityError: false, reason: "OK" };
  }

  return { applied: false, fromState: payment.state, toState: payment.state, integrityError: false, reason: "UNHANDLED_CANDIDATE_STATE" };
}
