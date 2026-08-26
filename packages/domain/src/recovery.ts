/**
 * Failure-first payment recovery (PART 08 §11-§18). Deterministic,
 * zero-AI-dependency core: given verified payment/order facts, decide
 * whether a recovery attempt may even be considered at all, before the
 * Merchant Agent is asked to propose HOW to recover (a separate,
 * later concern — `@razorgrowth/domain` never imports an AI provider).
 *
 * This is intentionally NOT the same decision as the Policy Engine's
 * `RECOVERY_LIMIT_EXCEEDED` check (`policy-engine.ts`) — that engine
 * still runs afterward, unmodified, against the recovery proposal this
 * eligibility decision permits to be created. Recovery attempt COUNTING
 * is shared (the Policy Engine is the single place `maxRecoveryAttempts`
 * is enforced against a running count, PART 08 §22), but this engine
 * additionally captures the payment/order-specific preconditions that
 * make a recovery proposal meaningful to even attempt in the first place
 * (is the payment state actually FAILED, is the order actually unpaid,
 * is the failure category actually retryable) — concerns the Policy
 * Engine, which knows nothing about payments, has no business deciding.
 */
import type { PaymentFailureCategory } from "./payment-failure.js";
import type { PaymentState } from "./payment-state.js";
import type { OrderStatus } from "./commerce-status.js";

/** PART 08 §18 — deliberately small: only `RETRY_SAME_CHECKOUT` is
 * actually implemented (the core demo requirement). `NO_RECOVERY` is the
 * closed "nothing safe to propose" answer, never a silently-dropped
 * proposal. */
export const RECOVERY_ACTIONS = ["RETRY_SAME_CHECKOUT", "NO_RECOVERY"] as const;
export type RecoveryAction = (typeof RECOVERY_ACTIONS)[number];

export function isKnownRecoveryAction(value: string): value is RecoveryAction {
  return (RECOVERY_ACTIONS as readonly string[]).includes(value);
}

export const RECOVERY_ELIGIBILITY_OUTCOMES = ["ELIGIBLE", "NOT_ELIGIBLE", "RECONCILIATION_REQUIRED"] as const;
export type RecoveryEligibilityOutcome = (typeof RECOVERY_ELIGIBILITY_OUTCOMES)[number];

/** PART 08 §16 — closed vocabulary; never an AI-generated reason code. */
export const RECOVERY_REASON_CODES = [
  "RECOVERY_ALLOWED",
  "RECOVERY_LIMIT_REACHED",
  "FAILURE_NOT_RETRYABLE",
  "PAYMENT_STATE_UNKNOWN",
  "PAYMENT_ALREADY_CAPTURED",
  "ORDER_ALREADY_PAID",
  "ORDER_CANCELLED",
  "RECONCILIATION_REQUIRED",
  "INTEGRITY_FAILURE",
] as const;
export type RecoveryReasonCode = (typeof RECOVERY_REASON_CODES)[number];

/** PART 08 §12 — a failure category drives whether recovery is even
 * considered. Conservative by default: only categories a bounded retry
 * can plausibly resolve are retryable; `TIMEOUT_UNKNOWN` and
 * `UNKNOWN_FAILURE` are not (§12: "conservative behavior"). */
const RETRYABLE_FAILURE_CATEGORIES: ReadonlySet<PaymentFailureCategory> = new Set([
  "PAYMENT_DECLINED",
  "INSUFFICIENT_FUNDS",
  "AUTHENTICATION_FAILED",
  "NETWORK_ERROR",
  "CUSTOMER_CANCELLED",
  "PROVIDER_ERROR",
]);

export interface RecoveryEligibilityInput {
  paymentState: PaymentState;
  failureCategory: PaymentFailureCategory | null;
  orderStatus: OrderStatus;
  /** Prior RECOVERY proposals already made against this same order (PART
   * 08 §10) — the SAME count the Policy Engine's `maxRecoveryAttempts`
   * check will independently re-apply; surfaced here too so a request
   * that is obviously over the limit never even reaches the Merchant
   * Agent or Policy Engine. */
  recoveryAttemptCount: number;
  maxRecoveryAttempts: number;
}

export interface RecoveryEligibilityDecision {
  outcome: RecoveryEligibilityOutcome;
  reasonCodes: RecoveryReasonCode[];
  explanation: string;
}

/**
 * Pure function — the ONLY place recovery eligibility is decided (PART 08
 * §11, §202). Order of checks matters (most severe / most certain first,
 * same discipline as `evaluatePolicy`): an already-paid or cancelled
 * order is checked before anything about the failed payment itself,
 * since those make recovery meaningless regardless of failure category.
 */
export function evaluateRecoveryEligibility(input: RecoveryEligibilityInput): RecoveryEligibilityDecision {
  if (input.orderStatus === "PAID") {
    return { outcome: "NOT_ELIGIBLE", reasonCodes: ["ORDER_ALREADY_PAID"], explanation: "This order has already been paid; no recovery is needed." };
  }
  if (input.orderStatus === "CANCELLED") {
    return { outcome: "NOT_ELIGIBLE", reasonCodes: ["ORDER_CANCELLED"], explanation: "This order was cancelled and cannot be recovered." };
  }
  if (input.paymentState === "CAPTURED") {
    // Should never legitimately happen alongside orderStatus !== PAID —
    // surfaced as an integrity concern rather than silently treated as
    // "not eligible for the ordinary reason" (PART 08 §195-196).
    return { outcome: "NOT_ELIGIBLE", reasonCodes: ["PAYMENT_ALREADY_CAPTURED", "INTEGRITY_FAILURE"], explanation: "The prior payment attempt is already captured; recovery would risk double payment." };
  }
  if (input.paymentState === "UNKNOWN") {
    return {
      outcome: "RECONCILIATION_REQUIRED",
      reasonCodes: ["PAYMENT_STATE_UNKNOWN", "RECONCILIATION_REQUIRED"],
      explanation: "The prior payment attempt's final state is unverified; it must be reconciled with the provider before any recovery attempt.",
    };
  }
  if (input.paymentState !== "FAILED") {
    // AUTHORIZED / CREATED / CANCELLED — nothing has definitively failed
    // yet; there is nothing to recover from.
    return { outcome: "NOT_ELIGIBLE", reasonCodes: ["FAILURE_NOT_RETRYABLE"], explanation: "The prior payment attempt has not reached a verified FAILED state." };
  }
  if (input.recoveryAttemptCount >= input.maxRecoveryAttempts) {
    return { outcome: "NOT_ELIGIBLE", reasonCodes: ["RECOVERY_LIMIT_REACHED"], explanation: `The maximum of ${input.maxRecoveryAttempts} recovery attempt(s) for this order has already been reached.` };
  }
  if (input.failureCategory && !RETRYABLE_FAILURE_CATEGORIES.has(input.failureCategory)) {
    return { outcome: "NOT_ELIGIBLE", reasonCodes: ["FAILURE_NOT_RETRYABLE"], explanation: `The failure category (${input.failureCategory}) is not considered retryable.` };
  }
  return { outcome: "ELIGIBLE", reasonCodes: ["RECOVERY_ALLOWED"], explanation: "The prior payment attempt failed for a retryable reason and a recovery attempt remains available." };
}

export interface RecoveryValidationContext {
  /** The closed set of actions eligibility has already determined are
   * safe (PART 08 §21, §133) — a proposal for anything outside this set
   * is rejected regardless of what proposed it. */
  allowedActions: readonly RecoveryAction[];
  recoveryActionEnabled: boolean;
}

export type RecoveryValidationResult = { ok: true; action: RecoveryAction } | { ok: false; reason: string };

/**
 * PART 08 §20-§21 — the single deterministic gate every recovery
 * proposal (AI-generated or deterministic-fallback) passes through
 * before it may be persisted, mirroring `validateGrowthProposal`'s role
 * for ordinary growth proposals. On any failure the proposal is rejected
 * outright, never silently coerced to the nearest legal action.
 */
export function validateRecoveryProposal(raw: { action: string }, context: RecoveryValidationContext): RecoveryValidationResult {
  if (!context.recoveryActionEnabled) {
    return { ok: false, reason: "Recovery actions are disabled by merchant configuration." };
  }
  if (!isKnownRecoveryAction(raw.action)) {
    return { ok: false, reason: `Unknown recovery action: ${raw.action}` };
  }
  if (!context.allowedActions.includes(raw.action)) {
    return { ok: false, reason: `Recovery action ${raw.action} is not currently eligible.` };
  }
  return { ok: true, action: raw.action };
}

/** PART 08 §135 — the safe, deterministic answer whenever eligibility is
 * `ELIGIBLE`: since `RETRY_SAME_CHECKOUT` is the only implemented
 * recovery action, it is also always the correct one to fall back to
 * when the Merchant Agent is unavailable or returns an invalid action —
 * never a guess, because there is only one safe answer to guess. */
export function deterministicRecoveryAction(eligibility: RecoveryEligibilityOutcome): RecoveryAction {
  return eligibility === "ELIGIBLE" ? "RETRY_SAME_CHECKOUT" : "NO_RECOVERY";
}
