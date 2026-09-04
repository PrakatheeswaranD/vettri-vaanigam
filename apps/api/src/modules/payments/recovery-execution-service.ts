/**
 * PaymentRecoveryExecutionService (PART 08 §27, §112-§113, §189).
 *
 * The ONLY place a recovery `ExecutionAuthorization` becomes a real new
 * payment attempt. Reuses PART 05's authorization/proposal machinery for
 * validation and consumption, and PART 06's order-fingerprint/ledger
 * conventions — never a second authorization system, never a second
 * commerce-execution system. Zero LLM dependency. Produces a NEW
 * `CheckoutSession` against the SAME (immutable) `Order`/`Cart` the
 * failed attempt already used (PART 08 §29, §189) — the client then
 * calls the EXISTING `POST /payments/initiate` with that checkout id,
 * which itself computes the new attempt's `attemptNumber`/
 * `recoveredFromAttemptId` generically (never a fork of PART 07's
 * payment-initiation logic, PART 08 §28).
 */
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { CHECKOUT_VALIDITY_MINUTES, systemClock } from "@razorgrowth/domain";
import { AppError } from "../../http/errors.js";
import { logger } from "../../observability/logger.js";
import { appendLedgerEvent, withLedgerConcurrencyRetry } from "../audit/ledger.js";
import {
  consumeExecutionAuthorization,
  countPriorRecoveryAttempts,
  findExecutionAuthorizationById,
  findProposalForGovernance,
  getMerchantPolicy,
} from "../policy/repository.js";
import { fingerprintFromProposal } from "../policy/service.js";
import { createCheckoutSession, findCheckoutById, updateCheckoutStatus } from "../commerce/checkout-repository.js";
import { setOrderStatus } from "../commerce/order-repository.js";
import { computeOrderFingerprint } from "../commerce/order-fingerprint.js";
import { createIdempotencyRecord, findIdempotencyRecord, isIdempotencyUniqueConflict } from "../commerce/idempotency.js";

const RECOVERY_EXECUTION_OPERATION = "payments.recovery.execute";

class AuthorizationConsumedRaceError extends Error {}

export interface RecoveryExecutionResult {
  checkoutId: string;
}

export async function executeRecovery(
  prisma: PrismaClient,
  merchantId: string,
  authorizationId: string,
  idempotencyKey: string,
): Promise<RecoveryExecutionResult> {
  const existing = await findIdempotencyRecord(prisma, merchantId, RECOVERY_EXECUTION_OPERATION, idempotencyKey);
  if (existing) {
    if (existing.requestFingerprint !== authorizationId) {
      throw new AppError("IDEMPOTENCY_CONFLICT", "This idempotency key was already used for a different recovery execution request.");
    }
    return existing.responseSnapshot as unknown as RecoveryExecutionResult;
  }

  const now = systemClock.now();
  const authorization = await findExecutionAuthorizationById(prisma, merchantId, authorizationId);
  if (!authorization) throw AppError.notFound(`Execution authorization not found: ${authorizationId}`);
  if (authorization.status === "CONSUMED") {
    throw new AppError("AUTHORIZATION_ALREADY_CONSUMED", "This recovery authorization has already been consumed.");
  }
  if (authorization.status !== "ACTIVE") {
    throw new AppError("AUTHORIZATION_NOT_ALLOWED", `Recovery authorization is not active (status: ${authorization.status}).`);
  }
  if (authorization.expiresAt.getTime() <= now.getTime()) {
    throw new AppError("AUTHORIZATION_EXPIRED", "Recovery authorization has expired.");
  }

  const proposal = await findProposalForGovernance(prisma, merchantId, authorization.proposalId);
  if (!proposal || proposal.actionType !== "RECOVERY" || !proposal.sourceOrderId || !proposal.sourcePaymentId || !proposal.sourceCheckoutId) {
    throw new AppError("AUTHORIZATION_NOT_ALLOWED", "This authorization does not correspond to a payment-failure recovery proposal.");
  }
  // PART 18 — an abandoned-checkout re-issue is also `actionType: RECOVERY`
  // with the same three `source*` columns, and it must never be executed
  // here: this function CREATES A NEW CHECKOUT, which is right for a
  // payment that verifiably failed and wrong for one that may still be
  // live. The order/payment state checks below would refuse it anyway, but
  // they refuse it for the wrong reason and only by luck. The recovery
  // action is what actually distinguishes the two, so it is checked.
  if (proposal.recoveryAction !== "RETRY_SAME_CHECKOUT") {
    throw new AppError(
      "AUTHORIZATION_NOT_ALLOWED",
      `This authorization is for a ${proposal.recoveryAction ?? "unspecified"} action, not a payment-failure retry.`,
    );
  }
  if (fingerprintFromProposal(proposal) !== authorization.proposalFingerprint) {
    throw new AppError("PROPOSAL_CHANGED", "The recovery proposal has changed since authorization was issued.");
  }

  const order = await prisma.order.findFirst({ where: { id: proposal.sourceOrderId, merchantId }, include: { items: true } });
  if (!order) throw AppError.notFound(`Order not found: ${proposal.sourceOrderId}`);

  // PART 08 §34 — re-verify the order's own financial fingerprint
  // (self-consistency / tamper detection) immediately before creating a
  // new attempt against it. The order is immutable by design, so this
  // should always match; a mismatch is a genuine integrity failure.
  // The fingerprint is the integrity anchor; `authorizationId` is
  // provenance, not integrity. Requiring both here rejected every
  // DIRECT-buyer order — which carries no agent authorization and never
  // will — while reporting it as a missing fingerprint, so the most
  // common recoverable payment failed with a message about a field that
  // was actually present. Tamper detection is unaffected: any change to
  // the amount or line items still breaks the hash below.
  if (!order.orderFingerprint) {
    throw new AppError("FINANCIAL_INTEGRITY_ERROR", "The order underlying this recovery has no recorded financial fingerprint.");
  }
  const recomputedFingerprint = computeOrderFingerprint({
    orderId: order.id,
    merchantId: order.merchantId,
    currency: order.currency,
    totalAmountMinor: order.totalAmountMinor,
    // Empty string is the canonical "no agent authorization" value, and
    // is what the fingerprint was computed with at order creation.
    authorizationId: order.authorizationId ?? "",
    lines: order.items,
  });
  if (recomputedFingerprint !== order.orderFingerprint) {
    throw new AppError("FINANCIAL_INTEGRITY_ERROR", "The order's financial fingerprint no longer matches its persisted line items.");
  }

  // PART 08 §145, §196 — an order that is no longer FAILED (already paid,
  // or cancelled) can never be recovered into, regardless of what the
  // authorization says.
  if (order.status !== "FAILED") {
    throw new AppError("COMMERCE_STATE_CHANGED", `Order is not in a recoverable state (status: ${order.status}).`);
  }
  const sourcePayment = await prisma.payment.findFirst({ where: { id: proposal.sourcePaymentId, merchantId } });
  if (!sourcePayment || sourcePayment.state !== "FAILED") {
    throw new AppError("COMMERCE_STATE_CHANGED", "The prior payment attempt is no longer in a verified FAILED state.");
  }

  // PART 08 §32 — recheck the attempt limit again immediately before
  // execution, not only at proposal time; another concurrent recovery
  // could have consumed the last allowed attempt in the meantime.
  const policy = await getMerchantPolicy(prisma, merchantId);
  const recoveryAttemptCount = await countPriorRecoveryAttempts(prisma, merchantId, { recommendationId: null, sourceOrderId: order.id }, proposal.id);
  if (recoveryAttemptCount >= policy.maxRecoveryAttempts) {
    throw new AppError("AUTHORIZATION_NOT_ALLOWED", "The maximum number of recovery attempts for this order has been reached.");
  }

  const sourceCheckout = await findCheckoutById(prisma, merchantId, proposal.sourceCheckoutId);
  if (!sourceCheckout) throw AppError.notFound(`Checkout not found: ${proposal.sourceCheckoutId}`);
  const workflowId = sourceCheckout.workflowId;

  try {
    const response = await withLedgerConcurrencyRetry(prisma, async (tx) => {
      const consumed = await consumeExecutionAuthorization(tx, authorization.id);
      if (!consumed) throw new AuthorizationConsumedRaceError("Recovery authorization was consumed by a concurrent request.");
      await appendLedgerEvent(tx, {
        workflowId,
        merchantId,
        actorType: "SYSTEM",
        actionType: "RECOVERY_AUTHORIZATION_CONSUMED",
        status: "EXECUTED",
        conciseReason: "Recovery authorization consumed for a new payment attempt.",
        relatedEntityType: "ExecutionAuthorization",
        relatedEntityId: authorization.id,
        executedAt: now,
      });

      const newCheckoutId = randomUUID();
      const expiresAt = new Date(now.getTime() + CHECKOUT_VALIDITY_MINUTES * 60_000);
      const newCheckout = await createCheckoutSession(tx, {
        id: newCheckoutId,
        merchantId,
        customerId: sourceCheckout.customerId,
        cartId: sourceCheckout.cartId,
        orderId: order.id,
        authorizationId: authorization.id,
        amountMinor: order.totalAmountMinor,
        currency: order.currency,
        orderFingerprint: order.orderFingerprint!,
        fingerprintVersion: order.fingerprintVersion ?? "1",
        workflowId,
        expiresAt,
      });
      await updateCheckoutStatus(tx, newCheckout.id, "READY_FOR_PAYMENT");
      await setOrderStatus(tx, order.id, "PAYMENT_PENDING");
      await appendLedgerEvent(tx, {
        workflowId,
        merchantId,
        actorType: "COMMERCE",
        actionType: "RECOVERY_ATTEMPT_CREATED",
        status: "EXECUTED",
        conciseReason: `Recovery checkout created for order ${order.id} (attempt ${recoveryAttemptCount + 2}).`,
        relatedEntityType: "CheckoutSession",
        relatedEntityId: newCheckout.id,
        metadata: { sourcePaymentId: proposal.sourcePaymentId, orderId: order.id },
        executedAt: now,
      });

      const responseBody: RecoveryExecutionResult = { checkoutId: newCheckout.id };
      await createIdempotencyRecord(tx, {
        merchantId,
        operation: RECOVERY_EXECUTION_OPERATION,
        idempotencyKey,
        requestFingerprint: authorizationId,
        responseSnapshot: responseBody as never,
      });
      return responseBody;
    });

    logger.info({ event: "recovery.attempt_created", merchantId, checkoutId: response.checkoutId, orderId: order.id }, "Recovery checkout created");
    return response;
  } catch (err) {
    if (isIdempotencyUniqueConflict(err)) {
      const winner = await findIdempotencyRecord(prisma, merchantId, RECOVERY_EXECUTION_OPERATION, idempotencyKey);
      if (winner) return winner.responseSnapshot as unknown as RecoveryExecutionResult;
    }
    if (err instanceof AuthorizationConsumedRaceError) {
      logger.info({ event: "recovery.authorization_consumed_race", merchantId, authorizationId }, err.message);
      throw new AppError("AUTHORIZATION_ALREADY_CONSUMED", "This recovery authorization was already consumed by a concurrent request.");
    }
    throw err;
  }
}
