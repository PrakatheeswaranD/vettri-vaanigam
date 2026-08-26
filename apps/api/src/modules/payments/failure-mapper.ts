/**
 * Razorpay-specific failure normalization (PART 07 §49-§50, §154). Maps
 * Razorpay's own `error_code`/`error_description` strings (from a fetched
 * payment or a `payment.failed` webhook) into the small, closed,
 * provider-agnostic taxonomy defined in `@razorgrowth/domain`
 * `payment-failure.ts`. This mapping — and only this mapping — is
 * Razorpay-specific; the taxonomy itself has zero provider knowledge.
 *
 * Razorpay Test Mode's documented test cards/UPI IDs deliberately trigger
 * specific, named failure reasons (e.g. a test card configured to decline
 * with "insufficient funds"), so this mapping is exercised by real,
 * reproducible Test Mode behavior, not guesswork (PART 07 §96, §181).
 */
import type { PaymentFailureCategory } from "@razorgrowth/domain";

const REASON_SUBSTRING_MAP: Array<{ match: RegExp; category: PaymentFailureCategory }> = [
  { match: /insufficient/i, category: "INSUFFICIENT_FUNDS" },
  { match: /otp|authentication|3ds|3d_secure/i, category: "AUTHENTICATION_FAILED" },
  { match: /timeout|timed out/i, category: "TIMEOUT_UNKNOWN" },
  { match: /cancel/i, category: "CUSTOMER_CANCELLED" },
  { match: /declined|decline/i, category: "PAYMENT_DECLINED" },
];

const CODE_MAP: Record<string, PaymentFailureCategory> = {
  GATEWAY_ERROR: "PROVIDER_ERROR",
  SERVER_ERROR: "PROVIDER_ERROR",
  BAD_REQUEST_ERROR: "PAYMENT_DECLINED",
};

export function normalizeRazorpayFailure(errorCode: string | null, errorDescription: string | null): PaymentFailureCategory {
  const description = errorDescription ?? "";
  for (const { match, category } of REASON_SUBSTRING_MAP) {
    if (match.test(description)) return category;
  }
  if (errorCode && CODE_MAP[errorCode]) return CODE_MAP[errorCode]!;
  if (errorCode || errorDescription) return "PAYMENT_DECLINED";
  return "UNKNOWN_FAILURE";
}
