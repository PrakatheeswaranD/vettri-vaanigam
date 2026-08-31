import { describe, expect, it } from "vitest";
import { evaluatePaymentRisk } from "./payment-risk";

const base = { amountMinor: 100_000, highValueThresholdMinor: 500_000, paymentState: "FAILED" as const, customerDebitStatus: "NOT_DEBITED" as const, merchantCreditStatus: "NOT_CREDITED" as const, repeatedAttemptCount: 0, merchantTrusted: true, authorizationValid: true };

describe("evaluatePaymentRisk", () => {
  it("classifies debit-credit mismatch as critical and blocks retry", () => {
    const result = evaluatePaymentRisk({ ...base, customerDebitStatus: "DEBITED" });
    expect(result.category).toBe("DEBIT_CREDIT_MISMATCH");
    expect(result.automaticRetryAllowed).toBe(false);
    expect(result.reasons).toContain("DUPLICATE_CHARGE_RISK");
  });
  it("never assumes a failed payment means not debited", () => {
    const result = evaluatePaymentRisk({ ...base, customerDebitStatus: "UNKNOWN" });
    expect(result.category).toBe("UNKNOWN_STATE");
    expect(result.automaticRetryAllowed).toBe(false);
  });
  it("allows only a bounded proposal when non-debit is established", () => {
    const result = evaluatePaymentRisk(base);
    expect(result.category).toBe("RECOVERABLE_FAILURE");
    expect(result.automaticRetryAllowed).toBe(true);
  });
});
