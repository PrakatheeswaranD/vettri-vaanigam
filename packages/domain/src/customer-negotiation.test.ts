import { describe, it, expect } from "vitest";
import {
  computeCustomerStanding,
  evaluateNegotiation,
  volumeUpliftBps,
  DEFAULT_NEGOTIATION_POLICY,
  DISPUTE_PENALTY_ORDERS,
  TIER_LADDER,
  type CustomerHistory,
  type NegotiationPolicy,
} from "./customer-negotiation.js";

const POLICY: NegotiationPolicy = DEFAULT_NEGOTIATION_POLICY;

function history(overrides: Partial<CustomerHistory> = {}): CustomerHistory {
  return { settledOrders: 0, lifetimeSpendMinor: 0, disputedOrders: 0, ...overrides };
}

/** A basket small enough that no volume uplift and no rupee cap applies. */
const SMALL_BASKET = 400_000; // ₹4,000
/** Cost at 40% margin — comfortably above the 20% floor. */
const SMALL_COST = 240_000;

function negotiate(
  requestedDiscountBps: number | null,
  customer: CustomerHistory,
  basketTotalMinor = SMALL_BASKET,
  basketCostMinor: number | null = SMALL_COST,
  policy: NegotiationPolicy = POLICY,
) {
  return evaluateNegotiation({
    requestedDiscountBps,
    standing: computeCustomerStanding(customer),
    basketTotalMinor,
    basketCostMinor,
    policy,
  });
}

describe("customer standing — earned by history, never asserted", () => {
  it("starts a first-time shopper at NEW with nothing earned", () => {
    const standing = computeCustomerStanding(history());
    expect(standing.tier).toBe("NEW");
    expect(standing.earnedDiscountBps).toBe(0);
    expect(standing.explanation).toContain("first order");
  });

  it("climbs the ladder on settled orders", () => {
    expect(computeCustomerStanding(history({ settledOrders: 1 })).tier).toBe("RETURNING");
    expect(computeCustomerStanding(history({ settledOrders: 3 })).tier).toBe("LOYAL");
    expect(computeCustomerStanding(history({ settledOrders: 8 })).tier).toBe("VIP");
  });

  it("tops out rather than climbing forever", () => {
    const heavy = computeCustomerStanding(history({ settledOrders: 500 }));
    expect(heavy.tier).toBe("VIP");
    expect(heavy.earnedDiscountBps).toBe(TIER_LADDER[0]!.earnedDiscountBps);
    expect(heavy.ordersToNextTier).toBeNull();
  });

  /** A customer who returns half of what they buy is not the same
   * counterparty as one who keeps it. */
  it("charges a dispute against more than one settled order", () => {
    const clean = computeCustomerStanding(history({ settledOrders: 4 }));
    const returning = computeCustomerStanding(history({ settledOrders: 4, disputedOrders: 1 }));

    expect(clean.tier).toBe("LOYAL");
    expect(returning.effectiveOrders).toBe(4 - DISPUTE_PENALTY_ORDERS);
    expect(returning.earnedDiscountBps).toBeLessThan(clean.earnedDiscountBps);
    expect(returning.explanation).toContain("disputed");
  });

  it("does not let disputes drive standing below the floor tier", () => {
    const standing = computeCustomerStanding(history({ settledOrders: 1, disputedOrders: 9 }));
    expect(standing.effectiveOrders).toBe(0);
    expect(standing.tier).toBe("NEW");
    expect(standing.earnedDiscountBps).toBe(0);
  });

  it("tells a shopper what the next tier costs them", () => {
    const standing = computeCustomerStanding(history({ settledOrders: 1 }));
    expect(standing.ordersToNextTier).toBe(2);
    expect(standing.explanation).toContain("2 more settled orders");
  });

  it("ignores nonsensical negative history rather than inflating a tier", () => {
    const standing = computeCustomerStanding({ settledOrders: -5, lifetimeSpendMinor: -1, disputedOrders: -3 });
    expect(standing.tier).toBe("NEW");
    expect(standing.earnedDiscountBps).toBe(0);
  });
});

describe("volume uplift — a bigger basket earns a little more", () => {
  it("gives a small basket nothing", () => {
    expect(volumeUpliftBps(100_000)).toBe(0);
  });

  it("rises with basket value and never falls", () => {
    let previous = -1;
    for (const total of [0, 500_000, 1_000_000, 2_000_000, 5_000_000, 50_000_000]) {
      const uplift = volumeUpliftBps(total);
      expect(uplift).toBeGreaterThanOrEqual(previous);
      previous = uplift;
    }
  });
});

describe("negotiation — inside what a customer has earned", () => {
  it("applies a loyal customer's discount with nobody in the loop", () => {
    const result = negotiate(400, history({ settledOrders: 3 }));
    expect(result.outcome).toBe("AUTO_APPLIED");
    expect(result.appliedDiscountBps).toBe(400);
    expect(result.appliedDiscountMinor).toBe(16_000); // 4% of ₹4,000
    expect(result.finalTotalMinor).toBe(SMALL_BASKET - 16_000);
    expect(result.reasonCode).toBe("WITHIN_EARNED_DISCOUNT");
  });

  it("offers what they have earned when they name no number", () => {
    const result = negotiate(null, history({ settledOrders: 8 }));
    expect(result.outcome).toBe("AUTO_APPLIED");
    expect(result.appliedDiscountBps).toBe(500); // 6% earned, clamped to the 5% ceiling
  });

  it("gives a brand-new shopper nothing, and says why", () => {
    const result = negotiate(null, history());
    expect(result.outcome).toBe("DECLINED");
    expect(result.reasonCode).toBe("NOTHING_TO_NEGOTIATE");
    expect(result.appliedDiscountMinor).toBe(0);
    expect(result.explanation).toContain("first order");
  });

  it("applies less than the maximum when that is all the customer asked for", () => {
    const result = negotiate(100, history({ settledOrders: 8 }));
    expect(result.outcome).toBe("AUTO_APPLIED");
    expect(result.appliedDiscountBps).toBe(100);
  });
});

describe("negotiation — past the line, a human decides", () => {
  it("sends an above-ceiling request to the merchant rather than refusing it", () => {
    const result = negotiate(900, history({ settledOrders: 3 }));
    expect(result.outcome).toBe("PROPOSED_TO_MERCHANT");
    expect(result.reasonCode).toBe("ABOVE_AUTO_APPLY_CEILING");
    expect(result.appliedDiscountMinor).toBe(0);
  });

  /** A refusal that hides the alternative is a worse answer than the
   * alternative. */
  it("always tells the customer what they could have right now instead", () => {
    const result = negotiate(900, history({ settledOrders: 3 }));
    expect(result.counterOfferBps).toBe(400);
    expect(result.explanation).toContain("now instead of waiting");
  });

  it("refuses outright past the negotiable maximum, without troubling the merchant", () => {
    const result = negotiate(5000, history({ settledOrders: 8 }));
    expect(result.outcome).toBe("DECLINED");
    expect(result.reasonCode).toBe("ABOVE_NEGOTIABLE_MAXIMUM");
    expect(result.counterOfferBps).toBeGreaterThan(0);
  });

  /** The customer's own words are an assertion, not an instruction. */
  it("does not care what tier the customer claims to be", () => {
    const modest = negotiate(9999, history({ settledOrders: 0 }));
    expect(modest.outcome).toBe("DECLINED");
    expect(modest.appliedDiscountBps).toBe(0);
  });

  it("never returns a discount above the negotiable maximum, in any branch", () => {
    for (const requested of [0, 1, 499, 500, 501, 1499, 1500, 1501, 9999, 100_000]) {
      for (const orders of [0, 1, 3, 8, 500]) {
        const result = negotiate(requested, history({ settledOrders: orders }));
        expect(result.appliedDiscountBps).toBeLessThanOrEqual(POLICY.maxNegotiableDiscountBps);
        expect(result.counterOfferBps).toBeLessThanOrEqual(POLICY.maxNegotiableDiscountBps);
      }
    }
  });
});

/**
 * The half that makes this safe to automate. A percentage is not a limit
 * on a large basket: 5% of ₹5,00,000 is ₹25,000 given away with nobody
 * in the loop.
 */
describe("negotiation — the rupee cap binds before the percentage does", () => {
  const BIG_BASKET = 50_000_000; // ₹5,00,000
  const BIG_COST = 25_000_000; // 50% margin

  it("caps an auto-applied discount in rupees, not just in percent", () => {
    const result = negotiate(null, history({ settledOrders: 8 }), BIG_BASKET, BIG_COST);
    expect(result.outcome).toBe("AUTO_APPLIED");
    expect(result.appliedDiscountMinor).toBeLessThanOrEqual(POLICY.maxAutoApplyDiscountMinor);
    expect(result.cappedByAmount).toBe(true);
  });

  it("says so, rather than silently giving less than the tier promises", () => {
    const result = negotiate(null, history({ settledOrders: 8 }), BIG_BASKET, BIG_COST);
    expect(result.explanation).toContain("stops at");
    expect(result.entitledDiscountBps).toBeGreaterThan(result.appliedDiscountBps);
  });

  it("sends a VIP's full tier discount to the merchant once it exceeds the rupee cap", () => {
    // 5% of ₹5,00,000 = ₹25,000, far past the ₹2,000 automatic cap.
    const result = negotiate(500, history({ settledOrders: 8 }), BIG_BASKET, BIG_COST);
    expect(result.outcome).toBe("PROPOSED_TO_MERCHANT");
    expect(result.cappedByAmount).toBe(true);
  });

  it("never auto-applies more than the cap, at any basket size or tier", () => {
    for (const total of [100_000, 1_000_000, 10_000_000, 100_000_000]) {
      for (const orders of [0, 3, 8, 200]) {
        const result = negotiate(null, history({ settledOrders: orders }), total, Math.round(total * 0.4));
        if (result.outcome === "AUTO_APPLIED") {
          expect(result.appliedDiscountMinor).toBeLessThanOrEqual(POLICY.maxAutoApplyDiscountMinor);
        }
      }
    }
  });

  it("leaves the cap irrelevant on a basket small enough not to reach it", () => {
    const result = negotiate(null, history({ settledOrders: 3 }), SMALL_BASKET, SMALL_COST);
    expect(result.cappedByAmount).toBe(false);
    expect(result.appliedDiscountBps).toBe(400);
  });
});

describe("negotiation — margin is refused, never trimmed", () => {
  /** Cost at 85% of the basket: almost any discount breaks the 20% floor. */
  const THIN_COST = Math.round(SMALL_BASKET * 0.85);

  it("refuses a discount that would sell below the merchant's floor", () => {
    const result = negotiate(400, history({ settledOrders: 3 }), SMALL_BASKET, THIN_COST);
    expect(result.outcome).toBe("DECLINED");
    expect(result.reasonCode).toBe("WOULD_BREACH_FLOOR_MARGIN");
    expect(result.appliedDiscountMinor).toBe(0);
  });

  it("says it was refused rather than trimmed, because a smaller breach is still a breach", () => {
    const result = negotiate(400, history({ settledOrders: 3 }), SMALL_BASKET, THIN_COST);
    expect(result.explanation).toContain("refused rather than trimmed");
  });

  it("offers a smaller earned discount when that one does clear the floor", () => {
    // Cost leaves room for ~2% but not for the 4% requested.
    const cost = Math.round(SMALL_BASKET * 0.783);
    const result = negotiate(400, history({ settledOrders: 1 }), SMALL_BASKET, cost);
    if (result.outcome === "DECLINED" && result.reasonCode === "WOULD_BREACH_FLOOR_MARGIN") {
      expect(result.counterOfferBps).toBeGreaterThanOrEqual(0);
    }
  });

  /** A discount nobody can prove is affordable is exactly the kind a human
   * should be looking at. */
  it("fails closed to the merchant when cost is unknown", () => {
    const result = negotiate(400, history({ settledOrders: 8 }), SMALL_BASKET, null);
    expect(result.outcome).toBe("PROPOSED_TO_MERCHANT");
    expect(result.reasonCode).toBe("COST_UNKNOWN");
    expect(result.appliedDiscountMinor).toBe(0);
    expect(result.counterOfferMinor).toBe(0);
  });
});

describe("negotiation — every answer is readable", () => {
  it("gives a sentence a shopper can act on, whatever the outcome", () => {
    const cases = [
      negotiate(null, history()),
      negotiate(200, history({ settledOrders: 1 })),
      negotiate(900, history({ settledOrders: 3 })),
      negotiate(5000, history({ settledOrders: 8 })),
      negotiate(400, history({ settledOrders: 3 }), SMALL_BASKET, Math.round(SMALL_BASKET * 0.85)),
      negotiate(400, history({ settledOrders: 3 }), SMALL_BASKET, null),
    ];
    for (const result of cases) {
      expect(result.explanation.length).toBeGreaterThan(30);
      expect(result.explanation).not.toContain("undefined");
      expect(result.explanation).not.toContain("NaN");
      expect(result.explanation).not.toContain("bps");
    }
  });

  it("keeps the arithmetic consistent with what it says was applied", () => {
    const result = negotiate(200, history({ settledOrders: 1 }));
    expect(result.finalTotalMinor).toBe(result.appliedDiscountMinor === 0 ? SMALL_BASKET : SMALL_BASKET - result.appliedDiscountMinor);
    expect(result.finalTotalMinor).toBeGreaterThan(0);
  });
});
