/**
 * PART 18 — re-opening a checkout the buyer walked away from.
 *
 * WHAT THIS IS, AND WHAT IT IS NOT
 *
 * The opportunity engine has always detected `ABANDONED_CHECKOUT_RECOVERY`:
 * a checkout that reached a created payment and then simply stopped.
 * Nothing was declined — the buyer stopped. It carried a real action label
 * ("Re-issue a checkout link for the abandoned baskets") and no tool could
 * act on it, because the merchant agent's only recovery path is
 * `evaluateRecoveryEligibility`, which correctly REFUSES a payment in
 * CREATED with `FAILURE_NOT_RETRYABLE`: nothing has definitively failed
 * yet, and retrying an attempt that has not failed is how a double charge
 * happens.
 *
 * That refusal is right, and it is why this is a separate decision rather
 * than a loosened version of it. Failure recovery asks "may we try to take
 * this money again?". This asks the much smaller question "may we give the
 * buyer their basket back?" — no new order, no new charge, no change of
 * amount. The existing session's expiry is extended and its status
 * returned to READY_FOR_PAYMENT.
 *
 * WHY EACH REFUSAL BELOW IS A REFUSAL
 *
 * Every one of them is a way this could take money that was already taken,
 * or sell stock that is no longer held:
 *
 *   COMPLETED / order PAID   Already bought. Re-opening it invites a
 *                            second payment for one basket.
 *   CAPTURED / AUTHORIZED    Money has moved or is held, whatever the
 *                            session says. "payment.failed does not mean
 *                            the customer was not debited" applies just as
 *                            hard to "the session looks unfinished".
 *   UNKNOWN                  Unverified is not unpaid. Reconcile first.
 *   EXPIRED / CANCELLED      `maintenance-service.ts` has already restocked
 *                            this order's inventory. The basket is no
 *                            longer reserved, so re-opening it would sell
 *                            stock the merchant may not have. This is the
 *                            non-obvious one, and the reason expiry cannot
 *                            simply be pushed forward.
 *   Not yet stale            A checkout minutes old is in progress. Poking
 *                            it is not recovery, it is interference.
 *   Window still open        The buyer already HAS a live window on this
 *                            basket — most likely because it was re-issued
 *                            already. Without this the agent could re-issue
 *                            the same checkout on every cycle forever:
 *                            extending `expiresAt` does not make a stale
 *                            `createdAt` any younger, so staleness alone
 *                            never stops repeating. Found by the
 *                            integration test that expected a second
 *                            re-issue to refuse and watched it succeed.
 *
 * Nothing here decides discounts, and this action never carries an offer.
 * Whether a buyer should also be given a reason to come back is a separate
 * question with its own governance; conflating the two would let "remind
 * them" quietly become "discount it".
 */

/** A checkout idle at least this long is abandoned rather than in
 * progress. Matches `CHECKOUT_STALE_AFTER_HOURS` in
 * `revenue-opportunity.ts`, which is what detects these in the first
 * place — the detector and the guard must not disagree about what
 * "abandoned" means. */
export const CHECKOUT_REISSUE_STALE_AFTER_HOURS = 24;

/**
 * How far past now a re-issued checkout is valid. A fresh full window,
 * because the buyer is being asked to start deciding again — handing back
 * whatever minutes were left on a lapsed session would be a worse
 * experience than not re-issuing at all.
 */
export const CHECKOUT_REISSUE_VALIDITY_HOURS = 48;

export const CHECKOUT_REISSUE_OUTCOMES = ["ELIGIBLE", "NOT_ELIGIBLE", "RECONCILIATION_REQUIRED"] as const;
export type CheckoutReissueOutcome = (typeof CHECKOUT_REISSUE_OUTCOMES)[number];

export interface CheckoutReissueInput {
  checkoutStatus: string;
  orderStatus: string;
  /** Every payment ever attempted on this checkout's order, latest first.
   * All of them, not just the newest: an earlier CAPTURED attempt followed
   * by a later CREATED one is exactly the shape that must refuse. */
  paymentStates: readonly string[];
  ageHours: number;
  /** Whether stock for this order is still held. False once
   * `maintenance-service.ts` has restocked it. */
  inventoryStillReserved: boolean;
  /** Whether the checkout's own validity window has not yet passed. True
   * for a checkout just re-issued, and for one the buyer is still inside. */
  windowStillOpen: boolean;
}

export interface CheckoutReissueDecision {
  outcome: CheckoutReissueOutcome;
  reasonCodes: string[];
  explanation: string;
}

/** Session states from which a basket can be handed back. `CREATED` is
 * included: a checkout that never reached READY_FOR_PAYMENT still holds
 * its stock and its order. */
const REISSUABLE_CHECKOUT_STATUSES = new Set(["CREATED", "READY_FOR_PAYMENT", "PAYMENT_IN_PROGRESS"]);

/** Payment states that mean money has moved, is held, or was refunded —
 * and a refund means there was a capture to refund. */
const MONEY_TOUCHED_STATES = new Set(["CAPTURED", "AUTHORIZED", "REFUNDED", "PARTIALLY_REFUNDED"]);

export function evaluateCheckoutReissueEligibility(input: CheckoutReissueInput): CheckoutReissueDecision {
  if (input.orderStatus === "PAID") {
    return {
      outcome: "NOT_ELIGIBLE",
      reasonCodes: ["ORDER_ALREADY_PAID", "INTEGRITY_FAILURE"],
      explanation: "This order is already paid. Re-opening its checkout would invite a second payment for one basket.",
    };
  }
  if (input.orderStatus === "CANCELLED") {
    return {
      outcome: "NOT_ELIGIBLE",
      reasonCodes: ["ORDER_CANCELLED"],
      explanation: "This order was cancelled; there is no basket to hand back.",
    };
  }

  // Checked against EVERY attempt, before the session's own status. A
  // session can read PAYMENT_IN_PROGRESS while an earlier attempt on the
  // same order was captured, and the session's state is the weaker
  // evidence of the two.
  const touched = input.paymentStates.find((state) => MONEY_TOUCHED_STATES.has(state));
  if (touched) {
    return {
      outcome: "NOT_ELIGIBLE",
      reasonCodes: ["PAYMENT_MONEY_MOVED", "INTEGRITY_FAILURE"],
      explanation: `A payment on this order is ${touched}. Money has moved or is held, so this checkout must not be re-opened.`,
    };
  }
  if (input.paymentStates.includes("UNKNOWN")) {
    return {
      outcome: "RECONCILIATION_REQUIRED",
      reasonCodes: ["PAYMENT_STATE_UNKNOWN", "RECONCILIATION_REQUIRED"],
      explanation:
        "A payment attempt on this order has an unverified final state. Unverified is not unpaid — reconcile it with the provider before re-issuing anything.",
    };
  }

  if (!REISSUABLE_CHECKOUT_STATUSES.has(input.checkoutStatus)) {
    return {
      outcome: "NOT_ELIGIBLE",
      reasonCodes: ["CHECKOUT_NOT_REISSUABLE"],
      explanation: `This checkout is ${input.checkoutStatus}. Only a checkout still holding its order and its stock can be handed back.`,
    };
  }
  if (!input.inventoryStillReserved) {
    return {
      outcome: "NOT_ELIGIBLE",
      reasonCodes: ["INVENTORY_RELEASED"],
      explanation:
        "The stock this basket held has already been returned to inventory. Re-opening the checkout could sell items the merchant no longer has.",
    };
  }
  if (input.windowStillOpen) {
    return {
      outcome: "NOT_ELIGIBLE",
      reasonCodes: ["CHECKOUT_WINDOW_STILL_OPEN"],
      explanation:
        "This checkout is already open and the buyer can still complete it. Re-issuing it again would extend a window nobody has run out of.",
    };
  }
  if (input.ageHours < CHECKOUT_REISSUE_STALE_AFTER_HOURS) {
    return {
      outcome: "NOT_ELIGIBLE",
      reasonCodes: ["CHECKOUT_NOT_STALE"],
      explanation: `This checkout is ${Math.floor(input.ageHours)}h old. A checkout is treated as abandoned only after ${CHECKOUT_REISSUE_STALE_AFTER_HOURS}h; before that the buyer may still be deciding.`,
    };
  }

  return {
    outcome: "ELIGIBLE",
    reasonCodes: ["CHECKOUT_REISSUE_ALLOWED"],
    explanation: `This checkout has been idle for ${Math.floor(input.ageHours)}h with no payment taken and its stock still reserved. The same basket, at the same price, can be handed back to the buyer.`,
  };
}
