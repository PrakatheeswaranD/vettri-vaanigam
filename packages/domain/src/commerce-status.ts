/**
 * Commerce lifecycle vocabularies and transition tables (PART 06 §13,
 * §34, §39-§40, §113-§115). Mirrors the Prisma enums exactly, following
 * the same convention already established for `GrowthProposalStatus`
 * (`growth-action.ts`) — one authoritative transition table both the API
 * layer and tests share, rather than re-deriving legality ad hoc.
 */

export const CART_STATUSES = ["ACTIVE", "CHECKOUT_PENDING", "CONVERTED", "EXPIRED", "ABANDONED"] as const;
export type CartStatus = (typeof CART_STATUSES)[number];

export const CART_TRANSITIONS: Record<CartStatus, readonly CartStatus[]> = {
  ACTIVE: ["CHECKOUT_PENDING", "ABANDONED", "EXPIRED"],
  CHECKOUT_PENDING: ["CONVERTED", "ACTIVE"],
  CONVERTED: [],
  EXPIRED: [],
  ABANDONED: [],
};

export function isValidCartTransition(from: CartStatus, to: CartStatus): boolean {
  return CART_TRANSITIONS[from].includes(to);
}

/**
 * PART 06 §34 — `PENDING` (pre-existing, PART 01) doubles as the
 * "created, no payment attempted" state for a real PART 06 order, so no
 * redundant `CREATED` value was introduced. `PAYMENT_PENDING` is added
 * now purely for PART 07 forward-compatibility (§34: "you may create the
 * enum now") — nothing in PART 06 ever sets it.
 */
export const ORDER_STATUSES = ["PENDING", "PAYMENT_PENDING", "PAID", "FAILED", "CANCELLED"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** PART 08 §35-§36 — `FAILED -> PAYMENT_PENDING` is a deliberate, narrow
 * addition: an order does not become permanently unrecoverable the
 * instant a payment attempt fails. It is only ever exercised behind a
 * verified `ExecutionAuthorization` for a bounded, policy-gated recovery
 * proposal (never automatically) — see
 * `PaymentRecoveryExecutionService`. This does not weaken `PAID`/
 * `CANCELLED`'s own terminal status; only `FAILED` gains one bounded
 * outgoing edge. */
export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  PENDING: ["PAYMENT_PENDING", "CANCELLED"],
  PAYMENT_PENDING: ["PAID", "FAILED", "CANCELLED"],
  PAID: [],
  FAILED: ["PAYMENT_PENDING"],
  CANCELLED: [],
};

export function isValidOrderTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

/** PART 06 §63 — closed order-provenance vocabulary (PART 00 §29
 * foundation). Recorded for future attribution; never implies a causal
 * revenue claim on its own (PART 06 §64-§65). */
export const ORDER_SOURCES = ["DIRECT_BUYER", "AI_CROSS_SELL", "AI_UPSELL", "AI_BUNDLE", "AI_BOUNDED_OFFER", "AI_RECOVERY"] as const;
export type OrderSource = (typeof ORDER_SOURCES)[number];

export const CHECKOUT_SESSION_STATUSES = [
  "CREATED",
  "READY_FOR_PAYMENT",
  "PAYMENT_IN_PROGRESS",
  "COMPLETED",
  "FAILED",
  "EXPIRED",
  "CANCELLED",
] as const;
export type CheckoutSessionStatus = (typeof CHECKOUT_SESSION_STATUSES)[number];

/** PART 06 §40 — PART 06 only ever exercises `CREATED -> READY_FOR_PAYMENT`
 * (and `-> CANCELLED`/`-> EXPIRED`); `PAYMENT_IN_PROGRESS`/`COMPLETED`/
 * `FAILED` exist for PART 07 to set later. */
export const CHECKOUT_SESSION_TRANSITIONS: Record<CheckoutSessionStatus, readonly CheckoutSessionStatus[]> = {
  CREATED: ["READY_FOR_PAYMENT", "CANCELLED", "EXPIRED"],
  READY_FOR_PAYMENT: ["PAYMENT_IN_PROGRESS", "CANCELLED", "EXPIRED"],
  PAYMENT_IN_PROGRESS: ["COMPLETED", "FAILED"],
  COMPLETED: [],
  FAILED: [],
  EXPIRED: [],
  CANCELLED: [],
};

export function isValidCheckoutTransition(from: CheckoutSessionStatus, to: CheckoutSessionStatus): boolean {
  return CHECKOUT_SESSION_TRANSITIONS[from].includes(to);
}

/** PART 06 §32-§33 — versioned so a stored `CartTotals`/order calculation
 * is never misread against a different formula version later. */
export const CART_PRICING_VERSION = "1";

/** PART 06 §43 — order/checkout financial fingerprint version, distinct
 * from the pricing version and from PART 05's proposal-fingerprint
 * version (PART 05 §141: these are different concerns, kept separately
 * named and independently versioned). */
export const ORDER_FINGERPRINT_VERSION = "1";

/** PART 06 §41 — a fixed, documented constant rather than a new
 * merchant-configurable field: checkout expiry is a technical safety
 * margin, not a growth/policy lever a merchant needs to tune, so adding
 * it to `MerchantPolicy` would be configuration for its own sake. */
export const CHECKOUT_VALIDITY_MINUTES = 20;

/** PART 06 §20 — same buyer-selectable-quantity bound already established
 * for Buyer Agent intent (`buyer-intent.ts`), reused here rather than a
 * second magic number. */
export const MAX_SELECTION_QUANTITY = 10;
