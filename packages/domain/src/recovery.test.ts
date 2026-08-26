import { describe, expect, it } from "vitest";
import { deterministicRecoveryAction, evaluateRecoveryEligibility, isKnownRecoveryAction, RECOVERY_ACTIONS, validateRecoveryProposal } from "./recovery.js";

const base = { paymentState: "FAILED" as const, failureCategory: "PAYMENT_DECLINED" as const, orderStatus: "FAILED" as const, recoveryAttemptCount: 0, maxRecoveryAttempts: 1 };

describe("evaluateRecoveryEligibility", () => {
  it("is ELIGIBLE for a retryable failure within the attempt limit", () => {
    const result = evaluateRecoveryEligibility(base);
    expect(result.outcome).toBe("ELIGIBLE");
    expect(result.reasonCodes).toContain("RECOVERY_ALLOWED");
  });

  it("blocks an already-PAID order", () => {
    const result = evaluateRecoveryEligibility({ ...base, orderStatus: "PAID" });
    expect(result.outcome).toBe("NOT_ELIGIBLE");
    expect(result.reasonCodes).toContain("ORDER_ALREADY_PAID");
  });

  it("blocks a CANCELLED order", () => {
    const result = evaluateRecoveryEligibility({ ...base, orderStatus: "CANCELLED" });
    expect(result.outcome).toBe("NOT_ELIGIBLE");
    expect(result.reasonCodes).toContain("ORDER_CANCELLED");
  });

  it("flags an already-CAPTURED payment as an integrity concern, not ordinary ineligibility", () => {
    const result = evaluateRecoveryEligibility({ ...base, paymentState: "CAPTURED" });
    expect(result.outcome).toBe("NOT_ELIGIBLE");
    expect(result.reasonCodes).toContain("PAYMENT_ALREADY_CAPTURED");
    expect(result.reasonCodes).toContain("INTEGRITY_FAILURE");
  });

  it("requires reconciliation before recovery when payment state is UNKNOWN", () => {
    const result = evaluateRecoveryEligibility({ ...base, paymentState: "UNKNOWN" });
    expect(result.outcome).toBe("RECONCILIATION_REQUIRED");
    expect(result.reasonCodes).toContain("PAYMENT_STATE_UNKNOWN");
  });

  it("blocks when the recovery attempt limit has been reached", () => {
    const result = evaluateRecoveryEligibility({ ...base, recoveryAttemptCount: 1, maxRecoveryAttempts: 1 });
    expect(result.outcome).toBe("NOT_ELIGIBLE");
    expect(result.reasonCodes).toContain("RECOVERY_LIMIT_REACHED");
  });

  it("blocks a non-retryable failure category", () => {
    const result = evaluateRecoveryEligibility({ ...base, failureCategory: "UNKNOWN_FAILURE" });
    expect(result.outcome).toBe("NOT_ELIGIBLE");
    expect(result.reasonCodes).toContain("FAILURE_NOT_RETRYABLE");
  });

  it("blocks a payment that has not reached a definitive FAILED state", () => {
    const result = evaluateRecoveryEligibility({ ...base, paymentState: "CREATED" });
    expect(result.outcome).toBe("NOT_ELIGIBLE");
  });

  it("attempt-limit check takes precedence over failure-category retryability", () => {
    const result = evaluateRecoveryEligibility({ ...base, recoveryAttemptCount: 1, maxRecoveryAttempts: 1, failureCategory: "UNKNOWN_FAILURE" });
    expect(result.reasonCodes).toEqual(["RECOVERY_LIMIT_REACHED"]);
  });
});

describe("deterministicRecoveryAction", () => {
  it("proposes RETRY_SAME_CHECKOUT when eligible", () => {
    expect(deterministicRecoveryAction("ELIGIBLE")).toBe("RETRY_SAME_CHECKOUT");
  });
  it("proposes NO_RECOVERY otherwise", () => {
    expect(deterministicRecoveryAction("NOT_ELIGIBLE")).toBe("NO_RECOVERY");
    expect(deterministicRecoveryAction("RECONCILIATION_REQUIRED")).toBe("NO_RECOVERY");
  });
});

describe("isKnownRecoveryAction", () => {
  it("recognizes every action in the closed list", () => {
    for (const action of RECOVERY_ACTIONS) expect(isKnownRecoveryAction(action)).toBe(true);
  });
  it("rejects an unsupported model-invented action", () => {
    expect(isKnownRecoveryAction("REFUND_FULL_ORDER")).toBe(false);
  });
});

describe("validateRecoveryProposal", () => {
  const context = { allowedActions: ["RETRY_SAME_CHECKOUT"] as const, recoveryActionEnabled: true };

  it("accepts an allowed, known action", () => {
    const result = validateRecoveryProposal({ action: "RETRY_SAME_CHECKOUT" }, context);
    expect(result.ok).toBe(true);
  });

  it("rejects an unknown/hallucinated action", () => {
    const result = validateRecoveryProposal({ action: "REFUND_FULL_ORDER" }, context);
    expect(result.ok).toBe(false);
  });

  it("rejects a known action that eligibility did not actually allow", () => {
    const result = validateRecoveryProposal({ action: "RETRY_SAME_CHECKOUT" }, { ...context, allowedActions: [] });
    expect(result.ok).toBe(false);
  });

  it("rejects when recovery actions are disabled by merchant configuration", () => {
    const result = validateRecoveryProposal({ action: "RETRY_SAME_CHECKOUT" }, { ...context, recoveryActionEnabled: false });
    expect(result.ok).toBe(false);
  });
});
