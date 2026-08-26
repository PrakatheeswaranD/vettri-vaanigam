import { describe, expect, it } from "vitest";
import { evaluatePolicy } from "./policy-engine.js";
import type { PolicyEvaluationInput } from "./policy-types.js";

const NOW = new Date("2026-01-01T12:00:00.000Z");

function baseInput(overrides: Partial<PolicyEvaluationInput["proposal"]> = {}): PolicyEvaluationInput {
  return {
    now: NOW,
    policy: {
      policyVersion: 1,
      currency: "INR",
      maxDiscountBps: 1000, // 10%
      autoApprovalDiscountBps: 300, // 3%
      maxOrderAmountMinor: 5_000_000,
      autoApprovalOrderAmountMinor: 1_000_000,
      maxRecoveryAttempts: 2,
      proposalValidityMinutes: 30,
    },
    proposal: {
      createdAt: NOW,
      currency: "INR",
      actionType: "CROSS_SELL",
      actionTypeEnabled: true,
      discountBps: null,
      discountMinor: null,
      orderAmountMinor: null,
      productEligible: true,
      productAvailable: true,
      recoveryAttemptCount: 0,
      ...overrides,
    },
  };
}

describe("evaluatePolicy — discount boundaries (PART 05 §90-91)", () => {
  it("allows a discount below the autonomous threshold", () => {
    const result = evaluatePolicy(baseInput({ discountBps: 200 })); // 2%
    expect(result.outcome).toBe("ALLOW");
    expect(result.reasonCodes).toEqual(["WITHIN_AUTONOMOUS_LIMIT"]);
  });

  it("allows exactly at the autonomous threshold (inclusive lower boundary)", () => {
    const result = evaluatePolicy(baseInput({ discountBps: 300 })); // exactly 3%
    expect(result.outcome).toBe("ALLOW");
  });

  it("requires approval just above the autonomous threshold but below the hard max", () => {
    const result = evaluatePolicy(baseInput({ discountBps: 500 })); // 5%
    expect(result.outcome).toBe("REQUIRE_APPROVAL");
    expect(result.reasonCodes).toEqual(["DISCOUNT_REQUIRES_APPROVAL"]);
  });

  it("requires approval (not deny) exactly at the hard maximum", () => {
    const result = evaluatePolicy(baseInput({ discountBps: 1000 })); // exactly 10%
    expect(result.outcome).toBe("REQUIRE_APPROVAL");
  });

  it("denies a discount above the hard maximum", () => {
    const result = evaluatePolicy(baseInput({ discountBps: 1200 })); // 12%
    expect(result.outcome).toBe("DENY");
    expect(result.reasonCodes).toEqual(["DISCOUNT_LIMIT_EXCEEDED"]);
  });
});

describe("evaluatePolicy — order amount boundaries", () => {
  it("allows an order amount at or below the auto-approval threshold", () => {
    const result = evaluatePolicy(baseInput({ orderAmountMinor: 1_000_000 }));
    expect(result.outcome).toBe("ALLOW");
  });

  it("requires approval above the auto-approval threshold but within the hard max", () => {
    const result = evaluatePolicy(baseInput({ orderAmountMinor: 2_000_000 }));
    expect(result.outcome).toBe("REQUIRE_APPROVAL");
    expect(result.reasonCodes).toEqual(["ORDER_AMOUNT_REQUIRES_APPROVAL"]);
  });

  it("denies above the hard maximum order amount", () => {
    const result = evaluatePolicy(baseInput({ orderAmountMinor: 6_000_000 }));
    expect(result.outcome).toBe("DENY");
    expect(result.reasonCodes).toEqual(["ORDER_AMOUNT_LIMIT_EXCEEDED"]);
  });
});

describe("evaluatePolicy — invalid/unsafe tier always wins (PART 05 §9)", () => {
  it("denies a disabled action type even when the discount would otherwise be auto-allowed", () => {
    const result = evaluatePolicy(baseInput({ discountBps: 50, actionTypeEnabled: false }));
    expect(result.outcome).toBe("DENY");
    expect(result.reasonCodes).toContain("ACTION_TYPE_DISABLED");
  });

  it("denies a currency mismatch regardless of amount", () => {
    const result = evaluatePolicy(baseInput({ discountBps: 50, currency: "USD" }));
    expect(result.outcome).toBe("DENY");
    expect(result.reasonCodes).toContain("CURRENCY_MISMATCH");
  });

  it("denies an expired proposal even with a trivially small discount", () => {
    const created = new Date(NOW.getTime() - 60 * 60 * 1000); // 60 minutes ago, validity is 30
    const result = evaluatePolicy(baseInput({ discountBps: 50, createdAt: created }));
    expect(result.outcome).toBe("DENY");
    expect(result.reasonCodes).toContain("PROPOSAL_EXPIRED");
  });

  it("allows a proposal exactly at the validity boundary", () => {
    const created = new Date(NOW.getTime() - 30 * 60 * 1000); // exactly 30 minutes ago
    const result = evaluatePolicy(baseInput({ discountBps: 50, createdAt: created }));
    expect(result.outcome).toBe("ALLOW");
  });

  it("denies a product that failed revalidation as no longer eligible", () => {
    const result = evaluatePolicy(baseInput({ discountBps: 50, productEligible: false }));
    expect(result.outcome).toBe("DENY");
    expect(result.reasonCodes).toContain("PRODUCT_NOT_ELIGIBLE");
  });

  it("denies a product that is no longer available", () => {
    const result = evaluatePolicy(baseInput({ discountBps: 50, productAvailable: false }));
    expect(result.outcome).toBe("DENY");
    expect(result.reasonCodes).toContain("PRODUCT_NOT_AVAILABLE");
  });

  it("denies a RECOVERY proposal once the attempt count reaches the configured maximum", () => {
    const result = evaluatePolicy(
      baseInput({ discountBps: 50, actionType: "RECOVERY", recoveryAttemptCount: 2 }),
    );
    expect(result.outcome).toBe("DENY");
    expect(result.reasonCodes).toContain("RECOVERY_LIMIT_EXCEEDED");
  });

  it("allows a RECOVERY proposal below the attempt limit", () => {
    const result = evaluatePolicy(
      baseInput({ discountBps: 50, actionType: "RECOVERY", recoveryAttemptCount: 1 }),
    );
    expect(result.outcome).toBe("ALLOW");
  });

  it("denies an internally invalid policy configuration (auto-approval above hard max)", () => {
    const input = baseInput({ discountBps: 50 });
    input.policy.autoApprovalDiscountBps = 2000; // above maxDiscountBps of 1000
    const result = evaluatePolicy(input);
    expect(result.outcome).toBe("DENY");
    expect(result.reasonCodes).toContain("POLICY_CONFIGURATION_INVALID");
  });

  it("a hard-limit breach always wins over a lower-severity concern (precedence, §9)", () => {
    // Both an approval-tier concern (order amount) AND a hard-limit breach
    // (discount) are true at once — the result must be DENY, never
    // REQUIRE_APPROVAL, because DENY is the higher-severity tier.
    const result = evaluatePolicy(baseInput({ discountBps: 5000, orderAmountMinor: 2_000_000 }));
    expect(result.outcome).toBe("DENY");
    expect(result.reasonCodes).toEqual(["DISCOUNT_LIMIT_EXCEEDED"]);
  });

  it("collects every applicable invalid-tier reason code, not just the first", () => {
    const result = evaluatePolicy(
      baseInput({ discountBps: 50, currency: "USD", actionTypeEnabled: false, productAvailable: false }),
    );
    expect(result.outcome).toBe("DENY");
    expect(result.reasonCodes).toEqual(
      expect.arrayContaining(["CURRENCY_MISMATCH", "ACTION_TYPE_DISABLED", "PRODUCT_NOT_AVAILABLE"]),
    );
  });
});

describe("evaluatePolicy — determinism", () => {
  it("produces an identical result for identical input", () => {
    const input = baseInput({ discountBps: 700 });
    const a = evaluatePolicy(input);
    const b = evaluatePolicy(input);
    expect(a).toEqual(b);
  });
});
