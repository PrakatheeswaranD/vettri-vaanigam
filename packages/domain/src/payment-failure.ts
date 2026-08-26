/**
 * Deterministic payment-failure taxonomy (PART 07 §49-§50).
 *
 * A small, closed, provider-agnostic vocabulary — never a raw provider
 * error string surfaced as-is to the merchant/buyer. The MAPPING from a
 * specific provider's raw error codes into this taxonomy is Razorpay-
 * specific and therefore lives in `apps/api/src/modules/payments/`
 * (PART 00 §13: provider-specific logic must not spread into the
 * deterministic domain core) — this module only defines the categories
 * themselves and is exercised with zero provider knowledge.
 */

export const PAYMENT_FAILURE_CATEGORIES = [
  "PAYMENT_DECLINED",
  "INSUFFICIENT_FUNDS",
  "AUTHENTICATION_FAILED",
  "NETWORK_ERROR",
  "PROVIDER_ERROR",
  "TIMEOUT_UNKNOWN",
  "CUSTOMER_CANCELLED",
  "UNKNOWN_FAILURE",
] as const;

export type PaymentFailureCategory = (typeof PAYMENT_FAILURE_CATEGORIES)[number];

export function isPaymentFailureCategory(value: string): value is PaymentFailureCategory {
  return (PAYMENT_FAILURE_CATEGORIES as readonly string[]).includes(value);
}
