import { describe, expect, it } from "vitest";
import { deriveReasonCodes, renderExplanation, type ReasonCodeInput } from "./recommendation-reason-codes.js";
import { emptyIntent, type BuyerIntent } from "./buyer-intent.js";

function candidate(overrides: Partial<ReasonCodeInput> = {}): ReasonCodeInput {
  return {
    priceMinor: 429900,
    availabilityState: "IN_STOCK",
    attributes: { size: "uk9", color: "black" },
    hasStrongMetadata: true,
    violations: [],
    ...overrides,
  };
}

function intent(overrides: Partial<BuyerIntent> = {}): BuyerIntent {
  return { ...emptyIntent(), ...overrides };
}

describe("deriveReasonCodes", () => {
  it("includes WITHIN_BUDGET and MATCHES_REQUIRED_ATTRIBUTE for a clean exact match", () => {
    const codes = deriveReasonCodes(
      candidate(),
      intent({ budget: { minMinor: null, maxMinor: 500000, currency: "INR" }, requiredAttributes: { size: "uk9" } }),
    );
    expect(codes).toContain("WITHIN_BUDGET");
    expect(codes).toContain("MATCHES_REQUIRED_ATTRIBUTE");
    expect(codes).toContain("IN_STOCK");
    expect(codes).toContain("STRONG_METADATA");
  });

  it("uses NEAR_MATCH_BUDGET instead of WITHIN_BUDGET when over budget", () => {
    const codes = deriveReasonCodes(
      candidate({ violations: [{ type: "BUDGET_MAX", expected: "500000", actual: "529900", differenceMinor: 29900 }] }),
      intent({ budget: { minMinor: null, maxMinor: 500000, currency: "INR" } }),
    );
    expect(codes).toContain("NEAR_MATCH_BUDGET");
    expect(codes).not.toContain("WITHIN_BUDGET");
  });

  it("includes MATCHES_PREFERENCE only when a preferred attribute is actually present", () => {
    const withPref = deriveReasonCodes(candidate({ attributes: { weight: "lightweight" } }), intent({ preferredAttributes: { weight: "lightweight" } }));
    expect(withPref).toContain("MATCHES_PREFERENCE");

    const withoutPref = deriveReasonCodes(candidate({ attributes: {} }), intent({ preferredAttributes: { weight: "lightweight" } }));
    expect(withoutPref).not.toContain("MATCHES_PREFERENCE");
  });
});

describe("renderExplanation", () => {
  it("never fabricates a claim beyond the supplied reason codes", () => {
    expect(renderExplanation(["WITHIN_BUDGET", "IN_STOCK"])).toBe("Within your budget, currently in stock.");
  });

  it("falls back to a generic statement with no reason codes", () => {
    expect(renderExplanation([])).toBe("Matches your search.");
  });
});
