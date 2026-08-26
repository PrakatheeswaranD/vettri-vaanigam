import { describe, expect, it } from "vitest";
import { validateGrowthProposal, type GrowthValidationContext, type RawGrowthProposalShape } from "./growth-proposal-validation.js";

const baseContext: GrowthValidationContext = {
  candidateProductIds: ["primary", "socks", "expensive-shoe", "hidden"],
  allowedActionTypes: ["CROSS_SELL", "UPSELL", "BUNDLE", "BOUNDED_OFFER", "RECOVERY"],
  maxProposedDiscountBps: 1000,
  maxUpsellIncreaseBps: 1500,
  maxCrossSellItems: 3,
  maxBundleItems: 2,
  buyerBudgetMaxMinor: 500000,
  candidatePricesMinor: { primary: 429900, socks: 69900, "expensive-shoe": 479900, hidden: 100000 },
  primaryProductPriceMinor: 429900,
  currency: "INR",
};

function proposal(overrides: Partial<RawGrowthProposalShape> = {}): RawGrowthProposalShape {
  return {
    actionType: "CROSS_SELL",
    primaryProductId: "primary",
    relatedProductIds: ["socks"],
    offer: null,
    reasonCodes: ["COMPLEMENTARY_PRODUCT"],
    ...overrides,
  };
}

describe("validateGrowthProposal", () => {
  it("accepts a valid cross-sell", () => {
    expect(validateGrowthProposal(proposal(), baseContext)).toEqual({ ok: true, actionType: "CROSS_SELL" });
  });

  it("rejects an unknown action type", () => {
    const result = validateGrowthProposal(proposal({ actionType: "DELETE_EVERYTHING" }), baseContext);
    expect(result.ok).toBe(false);
  });

  it("rejects an action type the merchant hasn't enabled", () => {
    const ctx = { ...baseContext, allowedActionTypes: ["CROSS_SELL"] as const };
    const result = validateGrowthProposal(proposal({ actionType: "UPSELL", relatedProductIds: ["expensive-shoe"] }), ctx);
    expect(result.ok).toBe(false);
  });

  it("rejects a product ID outside the supplied candidate set (hallucination containment, §57)", () => {
    const result = validateGrowthProposal(proposal({ relatedProductIds: ["totally-invented-id"] }), baseContext);
    expect(result.ok).toBe(false);
  });

  it("rejects duplicate related product IDs", () => {
    const result = validateGrowthProposal(proposal({ relatedProductIds: ["socks", "socks"] }), baseContext);
    expect(result.ok).toBe(false);
  });

  it("rejects an empty relatedProductIds array", () => {
    const result = validateGrowthProposal(proposal({ relatedProductIds: [] }), baseContext);
    expect(result.ok).toBe(false);
  });

  it("rejects exceeding the max-cross-sell-items bound", () => {
    const ctx = { ...baseContext, maxCrossSellItems: 1, candidateProductIds: [...baseContext.candidateProductIds, "bottle"], candidatePricesMinor: { ...baseContext.candidatePricesMinor, bottle: 39900 } };
    const result = validateGrowthProposal(proposal({ relatedProductIds: ["socks", "bottle"] }), ctx);
    expect(result.ok).toBe(false);
  });

  it("rejects an unknown reason code", () => {
    const result = validateGrowthProposal(proposal({ reasonCodes: ["FREE_MONEY"] }), baseContext);
    expect(result.ok).toBe(false);
  });

  describe("upsell bounds", () => {
    it("accepts an upsell within budget and within the uplift ceiling", () => {
      const result = validateGrowthProposal(proposal({ actionType: "UPSELL", relatedProductIds: ["expensive-shoe"], reasonCodes: ["UPGRADE_WITHIN_BUDGET"] }), baseContext);
      expect(result.ok).toBe(true);
    });

    it("rejects an upsell that exceeds the buyer's hard budget (§29 — never a normal upsell)", () => {
      const ctx = { ...baseContext, buyerBudgetMaxMinor: 440000 };
      const result = validateGrowthProposal(proposal({ actionType: "UPSELL", relatedProductIds: ["expensive-shoe"] }), ctx);
      expect(result.ok).toBe(false);
    });

    it("rejects an upsell whose price uplift exceeds the configured ceiling", () => {
      const ctx = { ...baseContext, maxUpsellIncreaseBps: 100 }; // 1%
      const result = validateGrowthProposal(proposal({ actionType: "UPSELL", relatedProductIds: ["expensive-shoe"] }), ctx);
      expect(result.ok).toBe(false);
    });

    it("rejects an 'upsell' priced at or below the primary product", () => {
      const result = validateGrowthProposal(proposal({ actionType: "UPSELL", relatedProductIds: ["socks"] }), baseContext);
      expect(result.ok).toBe(false);
    });
  });

  describe("offer bounds", () => {
    it("accepts a bounded percentage offer within the ceiling", () => {
      const result = validateGrowthProposal(
        proposal({ actionType: "BOUNDED_OFFER", offer: { kind: "PERCENTAGE", percentageBps: 500, amountMinor: null } }),
        baseContext,
      );
      expect(result.ok).toBe(true);
    });

    it("rejects a percentage offer above the configured ceiling — never silently clamped (§58)", () => {
      const result = validateGrowthProposal(
        proposal({ actionType: "BOUNDED_OFFER", offer: { kind: "PERCENTAGE", percentageBps: 2000, amountMinor: null } }),
        baseContext,
      );
      expect(result.ok).toBe(false);
    });

    it("rejects a negative percentage", () => {
      const result = validateGrowthProposal(
        proposal({ actionType: "BOUNDED_OFFER", offer: { kind: "PERCENTAGE", percentageBps: -100, amountMinor: null } }),
        baseContext,
      );
      expect(result.ok).toBe(false);
    });

    it("rejects a fixed-amount offer whose implied bps exceeds the ceiling", () => {
      const result = validateGrowthProposal(
        proposal({ actionType: "BOUNDED_OFFER", offer: { kind: "FIXED_AMOUNT", percentageBps: null, amountMinor: 100000 } }),
        baseContext,
      );
      expect(result.ok).toBe(false);
    });

    it("rejects an unknown offer kind", () => {
      const result = validateGrowthProposal(
        proposal({ actionType: "BOUNDED_OFFER", offer: { kind: "MYSTERY", percentageBps: null, amountMinor: null } }),
        baseContext,
      );
      expect(result.ok).toBe(false);
    });
  });
});
