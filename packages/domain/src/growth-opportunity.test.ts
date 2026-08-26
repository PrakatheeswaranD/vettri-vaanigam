import { describe, expect, it } from "vitest";
import { deterministicGrowthProposal, detectGrowthBlocker, evaluateGrowthCandidates, type EligibleGrowthCandidate, type GrowthCandidateEvidence } from "./growth-opportunity.js";
import type { GrowthActionType } from "./growth-action.js";

const ALL_TYPES: GrowthActionType[] = ["CROSS_SELL", "UPSELL", "BUNDLE", "BOUNDED_OFFER", "RECOVERY"];

function evidence(overrides: Partial<GrowthCandidateEvidence> = {}): GrowthCandidateEvidence {
  return {
    productId: "socks",
    relationshipType: "COMPLEMENTARY",
    priceMinor: 69900,
    availabilityState: "IN_STOCK",
    attributes: { size: "M" },
    readinessState: "AGENT_READY",
    hasStructuredAttributes: true,
    hasPolicyData: true,
    isAgentVisible: true,
    ...overrides,
  };
}

describe("detectGrowthBlocker", () => {
  it("finds no blocker for a fully complete candidate", () => {
    expect(detectGrowthBlocker(evidence())).toBeNull();
  });

  it("flags UNKNOWN_INVENTORY — the readiness-to-growth connection (PART 04 §49-§51)", () => {
    expect(detectGrowthBlocker(evidence({ availabilityState: "UNKNOWN" }))).toBe("UNKNOWN_INVENTORY");
  });

  it("flags MISSING_PRICE", () => {
    expect(detectGrowthBlocker(evidence({ priceMinor: null }))).toBe("MISSING_PRICE");
  });

  it("flags MISSING_VARIANT_ATTRIBUTE", () => {
    expect(detectGrowthBlocker(evidence({ hasStructuredAttributes: false }))).toBe("MISSING_VARIANT_ATTRIBUTE");
  });

  it("flags MISSING_POLICY_DATA", () => {
    expect(detectGrowthBlocker(evidence({ hasPolicyData: false }))).toBe("MISSING_POLICY_DATA");
  });

  it("flags PRODUCT_NOT_AGENT_VISIBLE before any other blocker", () => {
    expect(detectGrowthBlocker(evidence({ isAgentVisible: false, priceMinor: null }))).toBe("PRODUCT_NOT_AGENT_VISIBLE");
  });
});

describe("evaluateGrowthCandidates", () => {
  it("puts a complete, in-stock candidate in the eligible set", () => {
    const result = evaluateGrowthCandidates([evidence()], ALL_TYPES);
    expect(result.eligible).toHaveLength(1);
    expect(result.eligible[0]?.actionType).toBe("CROSS_SELL");
    expect(result.blocked).toHaveLength(0);
  });

  it("puts an UNKNOWN-inventory candidate in the blocked set, not eligible", () => {
    const result = evaluateGrowthCandidates([evidence({ availabilityState: "UNKNOWN" })], ALL_TYPES);
    expect(result.eligible).toHaveLength(0);
    expect(result.blocked).toEqual([{ productId: "socks", actionType: "CROSS_SELL", blockerCode: "UNKNOWN_INVENTORY" }]);
  });

  it("silently excludes an out-of-stock candidate — not a data blocker, just currently unavailable", () => {
    const result = evaluateGrowthCandidates([evidence({ availabilityState: "OUT_OF_STOCK" })], ALL_TYPES);
    expect(result.eligible).toHaveLength(0);
    expect(result.blocked).toHaveLength(0);
  });

  it("excludes a candidate whose mapped action type isn't merchant-enabled", () => {
    const result = evaluateGrowthCandidates([evidence({ relationshipType: "UPSELL_ALTERNATIVE" })], ["CROSS_SELL"]);
    expect(result.eligible).toHaveLength(0);
    expect(result.blocked).toHaveLength(0);
  });

  it("maps relationship types to the correct action types", () => {
    const result = evaluateGrowthCandidates(
      [
        evidence({ productId: "socks", relationshipType: "COMPLEMENTARY" }),
        evidence({ productId: "premium-shoe", relationshipType: "UPSELL_ALTERNATIVE" }),
        evidence({ productId: "bundle-item", relationshipType: "BUNDLE_COMPATIBLE" }),
      ],
      ALL_TYPES,
    );
    const byId = Object.fromEntries(result.eligible.map((c) => [c.productId, c.actionType]));
    expect(byId.socks).toBe("CROSS_SELL");
    expect(byId["premium-shoe"]).toBe("UPSELL");
    expect(byId["bundle-item"]).toBe("BUNDLE");
  });
});

function eligible(overrides: Partial<EligibleGrowthCandidate> = {}): EligibleGrowthCandidate {
  return { ...evidence(), actionType: "CROSS_SELL", ...overrides };
}

describe("deterministicGrowthProposal", () => {
  it("returns a null actionType with no candidates", () => {
    expect(deterministicGrowthProposal([], {})).toEqual({ actionType: null, relatedProductIds: [], reasonCodes: [] });
  });

  it("prefers COMPLEMENTARY over UPSELL_ALTERNATIVE regardless of order", () => {
    const result = deterministicGrowthProposal(
      [
        eligible({ productId: "upsell-candidate", relationshipType: "UPSELL_ALTERNATIVE", actionType: "UPSELL" }),
        eligible({ productId: "socks", relationshipType: "COMPLEMENTARY", actionType: "CROSS_SELL" }),
      ],
      {},
    );
    expect(result.relatedProductIds).toEqual(["socks"]);
    expect(result.actionType).toBe("CROSS_SELL");
    expect(result.reasonCodes).toContain("COMPLEMENTARY_PRODUCT");
    expect(result.reasonCodes).toContain("MERCHANT_CONFIGURED_RELATIONSHIP");
  });

  it("prefers a preference-matching candidate among equal-priority candidates", () => {
    const result = deterministicGrowthProposal(
      [
        eligible({ productId: "grey-socks", attributes: { color: "grey" } }),
        eligible({ productId: "black-socks", attributes: { color: "black" } }),
      ],
      { color: "black" },
    );
    expect(result.relatedProductIds).toEqual(["black-socks"]);
    expect(result.reasonCodes).toContain("BUYER_PREFERENCE_MATCH");
  });

  it("never proposes an offer of its own accord", () => {
    // DeterministicGrowthProposal has no offer field at all — structurally
    // impossible to fabricate a discount from this path (PART 04 §40, §46).
    const result = deterministicGrowthProposal([eligible()], {});
    expect(result).not.toHaveProperty("offer");
  });

  it("is fully deterministic — same input always produces the same output", () => {
    const input = [eligible({ productId: "b" }), eligible({ productId: "a" }), eligible({ productId: "c" })];
    expect(deterministicGrowthProposal(input, {})).toEqual(deterministicGrowthProposal(input, {}));
  });
});
