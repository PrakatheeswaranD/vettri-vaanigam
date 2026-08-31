import { describe, it, expect } from "vitest";
import {
  evaluateAgentGatewayPolicy,
  clampNegotiatedDiscountBps,
  shouldNegotiate,
  offerBreachesFloorMargin,
  type AgentGatewayPolicy,
  type GatewayEvaluationContext,
} from "./agent-gateway-policy.js";

const POLICY: AgentGatewayPolicy = {
  policyVersion: 3,
  currency: "INR",
  unknownAgentCeilingMinor: 1_000_000, // ₹10,000
  knownAgentCeilingMinor: 5_000_000, // ₹50,000
  blockedCategories: ["Gift Cards"],
  maxNegotiationDiscountBps: 1000,
  negotiatorMinBundleItems: 2,
  negotiatorFloorMarginBps: 2000,
  velocityMaxIntentsPerHour: 20,
};

function context(overrides: Partial<GatewayEvaluationContext> = {}): GatewayEvaluationContext {
  return {
    agentTrust: "UNKNOWN",
    orderTotalMinor: 500_000,
    claimedTotalMinor: 500_000,
    currency: "INR",
    categories: ["Running Shoes"],
    lineCount: 1,
    recentIntentCount: 1,
    protocolSupported: true,
    ...overrides,
  };
}

describe("agent gateway policy", () => {
  it("auto-approves an unknown agent inside the ceiling", () => {
    const result = evaluateAgentGatewayPolicy(POLICY, context());
    expect(result.decision).toBe("AUTO_APPROVE");
    expect(result.reasonCode).toBe("WITHIN_ENVELOPE");
    expect(result.appliedCeilingMinor).toBe(POLICY.unknownAgentCeilingMinor);
  });

  it("applies the higher ceiling to an agent that has bought before", () => {
    const result = evaluateAgentGatewayPolicy(
      POLICY,
      context({ agentTrust: "KNOWN", orderTotalMinor: 4_000_000, claimedTotalMinor: 4_000_000 }),
    );
    expect(result.decision).toBe("AUTO_APPROVE");
    expect(result.appliedCeilingMinor).toBe(POLICY.knownAgentCeilingMinor);
  });

  /**
   * The scenario the brief demos on stage. An over-ceiling intent must
   * STEP UP, never decline outright — refusing a legitimate sale is as
   * much a failure as charging one silently.
   */
  it("steps up an unregistered agent's ₹48,000 order against a ₹10,000 ceiling", () => {
    const result = evaluateAgentGatewayPolicy(POLICY, context({ orderTotalMinor: 4_800_000, claimedTotalMinor: 4_800_000 }));

    expect(result.decision).toBe("STEP_UP");
    expect(result.reasonCode).toBe("UNKNOWN_AGENT_CEILING_EXCEEDED");
    expect(result.explanation).toContain("hasn't transacted with you before");
    expect(result.explanation).toContain("4.8x");
    expect(result.explanation).toContain("₹38,000.00");
  });

  it("declines a blocked category at any value", () => {
    const result = evaluateAgentGatewayPolicy(POLICY, context({ orderTotalMinor: 100, claimedTotalMinor: 100, categories: ["Gift Cards"] }));
    expect(result.decision).toBe("DECLINE");
    expect(result.reasonCode).toBe("CATEGORY_BLOCKED");
  });

  it("declines when the agent's claimed total disagrees with the catalogue", () => {
    const result = evaluateAgentGatewayPolicy(POLICY, context({ orderTotalMinor: 500_000, claimedTotalMinor: 100 }));
    expect(result.decision).toBe("DECLINE");
    expect(result.reasonCode).toBe("AMOUNT_MISMATCH");
    expect(result.explanation).toContain("Your price is the one that counts");
  });

  it("accepts an intent that states no price at all", () => {
    const result = evaluateAgentGatewayPolicy(POLICY, context({ claimedTotalMinor: null }));
    expect(result.decision).toBe("AUTO_APPROVE");
  });

  it("declines an unreadable protocol rather than guessing at its fields", () => {
    const result = evaluateAgentGatewayPolicy(POLICY, context({ protocolSupported: false }));
    expect(result.decision).toBe("DECLINE");
    expect(result.reasonCode).toBe("PROTOCOL_UNSUPPORTED");
  });

  it("declines a foreign currency rather than inventing a rate", () => {
    const result = evaluateAgentGatewayPolicy(POLICY, context({ currency: "USD" }));
    expect(result.decision).toBe("DECLINE");
    expect(result.reasonCode).toBe("CURRENCY_UNSUPPORTED");
  });

  it("declines past the velocity limit", () => {
    const result = evaluateAgentGatewayPolicy(POLICY, context({ recentIntentCount: 21 }));
    expect(result.decision).toBe("DECLINE");
    expect(result.reasonCode).toBe("VELOCITY_LIMIT_EXCEEDED");
  });

  it("declines an intent with nothing resolvable in it", () => {
    const result = evaluateAgentGatewayPolicy(POLICY, context({ lineCount: 0 }));
    expect(result.decision).toBe("DECLINE");
    expect(result.reasonCode).toBe("EMPTY_INTENT");
  });

  it("gives every outcome a sentence a merchant can read", () => {
    const scenarios: GatewayEvaluationContext[] = [
      context(),
      context({ orderTotalMinor: 4_800_000, claimedTotalMinor: 4_800_000 }),
      context({ categories: ["Gift Cards"] }),
      context({ protocolSupported: false }),
      context({ currency: "USD" }),
      context({ recentIntentCount: 99 }),
      context({ lineCount: 0 }),
      context({ claimedTotalMinor: 7 }),
    ];
    for (const scenario of scenarios) {
      const result = evaluateAgentGatewayPolicy(POLICY, scenario);
      expect(result.explanation.length).toBeGreaterThan(40);
      expect(result.explanation).toMatch(/\.$/);
      expect(result.explanation).not.toMatch(/[A-Z]{2,}_[A-Z]/); // never a raw code
    }
  });
});

describe("negotiator ceiling", () => {
  it("clamps a discount the model proposed above the merchant's ceiling", () => {
    expect(clampNegotiatedDiscountBps(4000, POLICY)).toBe(1000);
  });

  it("passes through a discount inside the ceiling", () => {
    expect(clampNegotiatedDiscountBps(500, POLICY)).toBe(500);
  });

  it("treats a nonsensical model figure as no discount", () => {
    expect(clampNegotiatedDiscountBps(-5, POLICY)).toBe(0);
    expect(clampNegotiatedDiscountBps(Number.NaN, POLICY)).toBe(0);
    expect(clampNegotiatedDiscountBps(Number.POSITIVE_INFINITY, POLICY)).toBe(0);
  });
});

describe("negotiator envelope (TECH_SPEC §4)", () => {
  it("engages only on a basket below the bundle threshold", () => {
    expect(shouldNegotiate(1, POLICY)).toBe(true);
    // Already at the threshold: this is a sale in hand, not an upsell
    // opportunity, and discounting it is margin the merchant was keeping.
    expect(shouldNegotiate(2, POLICY)).toBe(false);
    expect(shouldNegotiate(5, POLICY)).toBe(false);
  });

  it("never engages when the merchant has disabled discounting", () => {
    expect(shouldNegotiate(1, { ...POLICY, maxNegotiationDiscountBps: 0 })).toBe(false);
  });

  /**
   * A margin breach is REJECTED, not clamped. A smaller below-floor
   * discount is still below the floor.
   */
  it("rejects an offer that would take the basket below the floor margin", () => {
    // A 20% floor means 2000bps of margin must SURVIVE the discount.
    expect(offerBreachesFloorMargin({ revenueMinor: 10_000, costMinor: 6_000, discountBps: 1000 }, POLICY)).toBe(false);
    expect(offerBreachesFloorMargin({ revenueMinor: 10_000, costMinor: 8_000, discountBps: 1 }, POLICY)).toBe(true);
    expect(offerBreachesFloorMargin({ revenueMinor: 10_000, costMinor: 1_000, discountBps: 9500 }, POLICY)).toBe(true);
  });

  it("allows an offer that lands exactly ON the floor", () => {
    // Landing on the floor meets it; only going under is a breach. Being
    // stricter here would silently move the merchant's floor by 1bp.
    expect(offerBreachesFloorMargin({ revenueMinor: 10_000, costMinor: 1_600, discountBps: 8000 }, POLICY)).toBe(false);
    expect(offerBreachesFloorMargin({ revenueMinor: 10_000, costMinor: 1_601, discountBps: 8000 }, POLICY)).toBe(true);
  });

  it("fails closed when cost is unknown", () => {
    expect(offerBreachesFloorMargin({ revenueMinor: 10_000, costMinor: null, discountBps: 500 }, POLICY)).toBe(true);
  });
});
