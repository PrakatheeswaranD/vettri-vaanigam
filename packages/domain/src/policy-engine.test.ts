import { describe, expect, it } from "vitest";
import { evaluatePolicy } from "./policy-engine.js";
import type { PolicyEvaluationInput } from "./policy-types.js";

const NOW = new Date("2026-01-01T12:00:00.000Z");

function baseInput(
  overrides: Partial<PolicyEvaluationInput["proposal"]> = {},
  policyOverrides: Partial<PolicyEvaluationInput["policy"]> = {},
): PolicyEvaluationInput {
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
      // PART 08 boundaries. The defaults here are deliberately PERMISSIVE
      // so every pre-existing assertion still tests what it was written to
      // test; each new boundary has its own describe block below that
      // overrides exactly one of them.
      minMarginBps: 0,
      maxAutonomousActionsPerDay: 1_000,
      recoveryEnabled: true,
      prohibitedActions: [],
      eligibleCategories: [],
      minCustomerPaidOrders: 0,
      ...policyOverrides,
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
      marginBps: null,
      productCategory: "Running Shoes",
      customerPaidOrderCount: null,
      autonomousActionsToday: 0,
      unattended: false,
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

/* ═══════════════════════════════════════════════════════════════════════
 * PART 08 — the six boundaries that had no enforcement
 *
 * Every one of these is a DENY rather than a REQUIRE_APPROVAL, and that is
 * the point being pinned: each is a merchant saying "not this, ever"
 * rather than "not this without asking me". Routing any of them to
 * approval would turn a prohibition into a prompt.
 * ══════════════════════════════════════════════════════════════════════ */

describe("evaluatePolicy — margin floor", () => {
  it("denies a discount that would sell below the floor", () => {
    const result = evaluatePolicy(
      baseInput({ discountBps: 200, marginBps: 500 }, { minMarginBps: 1_000 }),
    );
    expect(result.outcome).toBe("DENY");
    expect(result.reasonCodes).toContain("MARGIN_FLOOR_BREACHED");
    expect(result.explanation).toContain("below the floor");
  });

  it("allows a discount that leaves exactly the floor", () => {
    // Exactly AT a limit is not a breach — the same boundary convention
    // every other limit in this engine uses.
    const result = evaluatePolicy(
      baseInput({ discountBps: 200, marginBps: 1_000 }, { minMarginBps: 1_000 }),
    );
    expect(result.outcome).toBe("ALLOW");
  });

  it("denies when cost is unknown and a floor is configured", () => {
    // The conservative reading, and the one a floor implies: a merchant
    // who asked not to sell below a margin did not mean "unless the
    // margin cannot be computed".
    const result = evaluatePolicy(
      baseInput({ discountBps: 200, marginBps: null }, { minMarginBps: 1_000 }),
    );
    expect(result.outcome).toBe("DENY");
    expect(result.reasonCodes).toContain("MARGIN_FLOOR_BREACHED");
    expect(result.explanation).toContain("no recorded cost");
  });

  it("never tests the floor on an action carrying no discount", () => {
    // Otherwise every cross-sell of a thin-margin product would be denied
    // for a discount it never asked for.
    const result = evaluatePolicy(
      baseInput({ discountBps: null, marginBps: null }, { minMarginBps: 5_000 }),
    );
    expect(result.outcome).toBe("ALLOW");
  });

  it("never tests the floor on a zero discount", () => {
    const result = evaluatePolicy(
      baseInput({ discountBps: 0, marginBps: null }, { minMarginBps: 5_000 }),
    );
    expect(result.outcome).toBe("ALLOW");
  });
});

describe("evaluatePolicy — daily autonomous action limit", () => {
  it("denies an unattended action once the day's ceiling is reached", () => {
    const result = evaluatePolicy(
      baseInput({ unattended: true, autonomousActionsToday: 50 }, { maxAutonomousActionsPerDay: 50 }),
    );
    expect(result.outcome).toBe("DENY");
    expect(result.reasonCodes).toContain("DAILY_ACTION_LIMIT_REACHED");
  });

  it("allows the action that reaches the ceiling but does not exceed it", () => {
    const result = evaluatePolicy(
      baseInput({ unattended: true, autonomousActionsToday: 49 }, { maxAutonomousActionsPerDay: 50 }),
    );
    expect(result.outcome).toBe("ALLOW");
  });

  it("does not apply the ceiling to a merchant who is present", () => {
    // The limit exists for the case where nobody is watching. A merchant
    // pressing "run a cycle" is watching.
    const result = evaluatePolicy(
      baseInput({ unattended: false, autonomousActionsToday: 999 }, { maxAutonomousActionsPerDay: 50 }),
    );
    expect(result.outcome).toBe("ALLOW");
  });
});

describe("evaluatePolicy — recovery permission", () => {
  it("denies recovery outright when the merchant has switched it off", () => {
    const result = evaluatePolicy(
      baseInput({ actionType: "RECOVERY" }, { recoveryEnabled: false }),
    );
    expect(result.outcome).toBe("DENY");
    expect(result.reasonCodes).toContain("RECOVERY_NOT_PERMITTED");
  });

  it("leaves other action types alone when recovery is off", () => {
    const result = evaluatePolicy(
      baseInput({ actionType: "CROSS_SELL" }, { recoveryEnabled: false }),
    );
    expect(result.outcome).toBe("ALLOW");
  });
});

describe("evaluatePolicy — prohibited actions", () => {
  it("denies an action type on the prohibited list", () => {
    const result = evaluatePolicy(
      baseInput({ actionType: "BOUNDED_OFFER" }, { prohibitedActions: ["BOUNDED_OFFER"] }),
    );
    expect(result.outcome).toBe("DENY");
    expect(result.reasonCodes).toContain("ACTION_TYPE_PROHIBITED");
  });

  it("prohibition survives the action type being enabled elsewhere", () => {
    // A denylist rather than the absence of an allow, precisely so that
    // enabling the feature in growth configuration cannot re-permit
    // something the merchant prohibited.
    const result = evaluatePolicy(
      baseInput({ actionType: "BOUNDED_OFFER", actionTypeEnabled: true }, { prohibitedActions: ["BOUNDED_OFFER"] }),
    );
    expect(result.outcome).toBe("DENY");
    expect(result.reasonCodes).toContain("ACTION_TYPE_PROHIBITED");
  });
});

describe("evaluatePolicy — eligible categories", () => {
  it("treats an empty list as every category permitted", () => {
    const result = evaluatePolicy(baseInput({ productCategory: "Anything" }, { eligibleCategories: [] }));
    expect(result.outcome).toBe("ALLOW");
  });

  it("denies a category outside a named set", () => {
    const result = evaluatePolicy(
      baseInput({ productCategory: "Hydration" }, { eligibleCategories: ["Running Shoes"] }),
    );
    expect(result.outcome).toBe("DENY");
    expect(result.reasonCodes).toContain("CATEGORY_NOT_ELIGIBLE");
  });

  it("denies an unknown category when a set is named", () => {
    // A product with no category cannot be shown to be inside the
    // merchant's set, so it is outside it.
    const result = evaluatePolicy(
      baseInput({ productCategory: null }, { eligibleCategories: ["Running Shoes"] }),
    );
    expect(result.outcome).toBe("DENY");
    expect(result.reasonCodes).toContain("CATEGORY_NOT_ELIGIBLE");
  });
});

describe("evaluatePolicy — eligible customers", () => {
  it("denies a customer with fewer paid orders than required", () => {
    const result = evaluatePolicy(
      baseInput({ customerPaidOrderCount: 0 }, { minCustomerPaidOrders: 1 }),
    );
    expect(result.outcome).toBe("DENY");
    expect(result.reasonCodes).toContain("CUSTOMER_NOT_ELIGIBLE");
  });

  it("allows a customer who exactly meets the requirement", () => {
    const result = evaluatePolicy(
      baseInput({ customerPaidOrderCount: 1 }, { minCustomerPaidOrders: 1 }),
    );
    expect(result.outcome).toBe("ALLOW");
  });

  it("skips the boundary when the action targets nobody in particular", () => {
    // A catalogue-wide cross-sell has no customer to be ineligible. The
    // boundary is about WHO is targeted, and nobody is.
    const result = evaluatePolicy(
      baseInput({ customerPaidOrderCount: null }, { minCustomerPaidOrders: 5 }),
    );
    expect(result.outcome).toBe("ALLOW");
  });
});

describe("evaluatePolicy — precedence holds with the new boundaries", () => {
  it("reports a prohibition rather than an approval when both would fire", () => {
    // Tier 1 always wins. A prohibited action that ALSO exceeds the
    // approval threshold must read as prohibited, not as "waiting for
    // you" — the merchant would otherwise be invited to approve something
    // they had forbidden.
    const result = evaluatePolicy(
      baseInput(
        { actionType: "BOUNDED_OFFER", discountBps: 900 },
        { prohibitedActions: ["BOUNDED_OFFER"], autoApprovalDiscountBps: 300, maxDiscountBps: 1_000 },
      ),
    );
    expect(result.outcome).toBe("DENY");
    expect(result.reasonCodes).toContain("ACTION_TYPE_PROHIBITED");
    expect(result.reasonCodes).not.toContain("DISCOUNT_REQUIRES_APPROVAL");
  });

  it("reports every applicable Tier 1 reason together", () => {
    const result = evaluatePolicy(
      baseInput(
        { actionType: "RECOVERY", productCategory: "Hydration", unattended: true, autonomousActionsToday: 99 },
        {
          recoveryEnabled: false,
          eligibleCategories: ["Running Shoes"],
          maxAutonomousActionsPerDay: 10,
        },
      ),
    );
    expect(result.outcome).toBe("DENY");
    // A complete explanation, not just the first thing found — a merchant
    // fixing one boundary should not discover the next one at the next
    // attempt.
    expect(result.reasonCodes).toContain("RECOVERY_NOT_PERMITTED");
    expect(result.reasonCodes).toContain("CATEGORY_NOT_ELIGIBLE");
    expect(result.reasonCodes).toContain("DAILY_ACTION_LIMIT_REACHED");
  });

  it("rejects a margin floor above 100%", () => {
    const result = evaluatePolicy(baseInput({}, { minMarginBps: 10_001 }));
    expect(result.outcome).toBe("DENY");
    expect(result.reasonCodes).toContain("POLICY_CONFIGURATION_INVALID");
  });
});
