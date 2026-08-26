/**
 * Deterministic payment state machine (PART 00 §12, §55.5; PART 01 §16).
 *
 * Payment state is derived ONLY from verified provider events and this
 * transition table — never from AI output, never from frontend claims.
 * This module has no knowledge of Razorpay-specific event payloads; that
 * translation belongs to a later payment-integration part. This is the
 * pure, provider-agnostic financial-truth core.
 */

export const PAYMENT_STATES = [
  "CREATED",
  "AUTHORIZED",
  "CAPTURED",
  "FAILED",
  "CANCELLED",
  "UNKNOWN",
] as const;

export type PaymentState = (typeof PAYMENT_STATES)[number];

export class PaymentStateError extends Error {
  constructor(
    public readonly from: PaymentState,
    public readonly to: PaymentState,
  ) {
    super(`Illegal payment state transition: ${from} -> ${to}`);
    this.name = "PaymentStateError";
  }
}

/**
 * Terminal states never transition further. A "failed then recovered"
 * payment is modeled as a NEW Payment record tied to a recovery action
 * (PART 00 §40), not by resurrecting a terminal record — financial history
 * must never be rewritten in place.
 */
const TERMINAL_STATES: ReadonlySet<PaymentState> = new Set(["CAPTURED", "FAILED", "CANCELLED"]);

const ALLOWED_TRANSITIONS: Record<PaymentState, ReadonlySet<PaymentState>> = {
  // PART 07 §54 note: with auto-capture enabled at provider-order creation
  // time (the normal Razorpay Test Mode configuration this build uses),
  // a successful payment can legitimately go straight from CREATED to
  // CAPTURED — the provider may not always deliver a separate discrete
  // "authorized" event first, or it may arrive out of order relative to
  // "captured" (§24). CREATED -> CAPTURED is therefore a real, expected
  // transition, not a shortcut around AUTHORIZED.
  CREATED: new Set(["AUTHORIZED", "CAPTURED", "FAILED", "CANCELLED", "UNKNOWN"]),
  AUTHORIZED: new Set(["CAPTURED", "FAILED", "UNKNOWN"]),
  CAPTURED: new Set([]),
  FAILED: new Set([]),
  CANCELLED: new Set([]),
  // UNKNOWN represents "we created a local record but have not yet received
  // a verified provider event" (e.g. webhook delayed past a frontend
  // timeout). It can resolve to any concrete state once a verified event
  // arrives.
  UNKNOWN: new Set(["CREATED", "AUTHORIZED", "CAPTURED", "FAILED", "CANCELLED"]),
};

export function isTerminalPaymentState(state: PaymentState): boolean {
  return TERMINAL_STATES.has(state);
}

/**
 * A duplicate delivery of the same event (e.g. a webhook retried by the
 * provider) must be idempotent, not an error — PART 00 §15. Transitioning
 * a state to itself is therefore always allowed and is a no-op.
 */
export function canTransitionPaymentState(from: PaymentState, to: PaymentState): boolean {
  if (from === to) return true;
  return ALLOWED_TRANSITIONS[from].has(to);
}

/**
 * Validate and perform a transition. Throws `PaymentStateError` on any
 * illegal transition (including any transition attempted out of a
 * terminal state to a *different* state) — callers must not silently
 * swallow this and must not write payment state without going through
 * this function.
 */
export function transitionPaymentState(current: PaymentState, next: PaymentState): PaymentState {
  if (!canTransitionPaymentState(current, next)) {
    throw new PaymentStateError(current, next);
  }
  return next;
}
