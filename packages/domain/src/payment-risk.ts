export const PAYMENT_RISK_CATEGORIES = [
  "NO_RISK", "LOW_RISK", "RECOVERABLE_FAILURE", "DEBIT_CREDIT_MISMATCH",
  "PENDING_PAYMENT", "REPEATED_FAILURE", "HIGH_VALUE_REVIEW", "UNKNOWN_STATE",
] as const;
export type PaymentRiskCategory = (typeof PAYMENT_RISK_CATEGORIES)[number];
export type PaymentRiskLevel = "NONE" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface PaymentRiskInput {
  amountMinor: number;
  highValueThresholdMinor: number;
  paymentState: "CREATED" | "AUTHORIZED" | "CAPTURED" | "FAILED" | "CANCELLED" | "UNKNOWN" | "REFUNDED" | "PARTIALLY_REFUNDED";
  customerDebitStatus: "UNKNOWN" | "NOT_DEBITED" | "DEBITED";
  merchantCreditStatus: "UNKNOWN" | "NOT_CREDITED" | "CREDITED";
  repeatedAttemptCount: number;
  merchantTrusted: boolean;
  authorizationValid: boolean;
}

export interface PaymentRiskDecision {
  category: PaymentRiskCategory;
  score: number;
  level: PaymentRiskLevel;
  reasons: string[];
  automaticRetryAllowed: boolean;
}

export function evaluatePaymentRisk(input: PaymentRiskInput): PaymentRiskDecision {
  const reasons: string[] = [];
  if (input.customerDebitStatus === "DEBITED" && input.merchantCreditStatus !== "CREDITED") {
    return { category: "DEBIT_CREDIT_MISMATCH", score: 100, level: "CRITICAL", reasons: ["CUSTOMER_DEBITED", "MERCHANT_NOT_CREDITED", "DUPLICATE_CHARGE_RISK"], automaticRetryAllowed: false };
  }
  if (input.paymentState === "UNKNOWN" || (input.paymentState === "FAILED" && input.customerDebitStatus === "UNKNOWN")) {
    return { category: "UNKNOWN_STATE", score: 90, level: "CRITICAL", reasons: ["CUSTOMER_DEBIT_UNCONFIRMED", "PROVIDER_STATE_UNCERTAIN"], automaticRetryAllowed: false };
  }
  if (input.repeatedAttemptCount >= 2) {
    return { category: "REPEATED_FAILURE", score: 78, level: "HIGH", reasons: ["REPEATED_PAYMENT_ATTEMPTS", "VELOCITY_REVIEW_REQUIRED"], automaticRetryAllowed: false };
  }
  if (!input.authorizationValid) {
    return { category: "HIGH_VALUE_REVIEW", score: 75, level: "HIGH", reasons: ["AUTHORIZATION_MISSING_OR_INVALID"], automaticRetryAllowed: false };
  }
  if (input.amountMinor > input.highValueThresholdMinor) {
    return { category: "HIGH_VALUE_REVIEW", score: 65, level: "HIGH", reasons: ["AMOUNT_ABOVE_REVIEW_THRESHOLD", "USER_APPROVAL_REQUIRED"], automaticRetryAllowed: false };
  }
  if (input.paymentState === "CREATED" || input.paymentState === "AUTHORIZED") {
    return { category: "PENDING_PAYMENT", score: 40, level: "MEDIUM", reasons: ["PAYMENT_NOT_TERMINAL"], automaticRetryAllowed: false };
  }
  if (input.paymentState === "FAILED" && input.customerDebitStatus === "NOT_DEBITED") {
    return { category: "RECOVERABLE_FAILURE", score: 35, level: "MEDIUM", reasons: ["CUSTOMER_NOT_DEBITED", "BOUNDED_RECOVERY_MAY_BE_PROPOSED"], automaticRetryAllowed: true };
  }
  if (input.merchantTrusted) reasons.push("MERCHANT_TRUSTED");
  reasons.push("AUTHORIZATION_VALID", "NO_DUPLICATE_ATTEMPT");
  return { category: input.paymentState === "CAPTURED" ? "NO_RISK" : "LOW_RISK", score: input.paymentState === "CAPTURED" ? 0 : 18, level: input.paymentState === "CAPTURED" ? "NONE" : "LOW", reasons, automaticRetryAllowed: false };
}
