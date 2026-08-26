import { describe, expect, it } from "vitest";
import { evaluateEligibility, violatesExclusion, type EligibilityCandidate } from "./buyer-eligibility.js";
import { emptyIntent, type BuyerIntent } from "./buyer-intent.js";

function candidate(overrides: Partial<EligibilityCandidate> = {}): EligibilityCandidate {
  return {
    productId: "p1",
    priceMinor: 429900,
    availabilityState: "IN_STOCK",
    attributes: { size: "uk9", color: "black" },
    ...overrides,
  };
}

function intent(overrides: Partial<BuyerIntent> = {}): BuyerIntent {
  return { ...emptyIntent(), ...overrides };
}

describe("evaluateEligibility", () => {
  it("is eligible when every hard constraint is satisfied", () => {
    const result = evaluateEligibility(
      candidate(),
      intent({ budget: { minMinor: null, maxMinor: 500000, currency: "INR" }, requiredAttributes: { size: "uk9" } }),
    );
    expect(result.eligible).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("code decides the budget boundary, not the model — a product over budget is a BUDGET_MAX violation", () => {
    const result = evaluateEligibility(
      candidate({ priceMinor: 529900 }),
      intent({ budget: { minMinor: null, maxMinor: 500000, currency: "INR" } }),
    );
    expect(result.eligible).toBe(false);
    expect(result.violations).toEqual([
      { type: "BUDGET_MAX", expected: "500000", actual: "529900", differenceMinor: 29900 },
    ]);
  });

  it("flags a required-attribute mismatch, case-insensitively matching what IS present", () => {
    const result = evaluateEligibility(candidate({ attributes: { size: "uk8" } }), intent({ requiredAttributes: { size: "UK9" } }));
    expect(result.eligible).toBe(false);
    expect(result.violations[0]?.type).toBe("REQUIRED_ATTRIBUTE");
  });

  it("flags a missing attribute as unknown, never assuming a match", () => {
    const result = evaluateEligibility(candidate({ attributes: {} }), intent({ requiredAttributes: { size: "uk9" } }));
    expect(result.violations[0]).toMatchObject({ type: "REQUIRED_ATTRIBUTE", actual: "size=unknown" });
  });

  it("rejects unavailable products when availability requirement is purchasable-only", () => {
    const result = evaluateEligibility(candidate({ availabilityState: "OUT_OF_STOCK" }), intent());
    expect(result.eligible).toBe(false);
    expect(result.violations[0]?.type).toBe("AVAILABILITY");
  });

  it("does not require availability when the buyer explicitly wants to include unavailable items", () => {
    const result = evaluateEligibility(
      candidate({ availabilityState: "OUT_OF_STOCK" }),
      intent({ availabilityRequirement: "INCLUDE_UNAVAILABLE" }),
    );
    expect(result.eligible).toBe(true);
  });

  it("never lets a preference affect eligibility", () => {
    const result = evaluateEligibility(candidate({ attributes: { size: "uk9" } }), intent({ preferredAttributes: { weight: "lightweight" } }));
    expect(result.eligible).toBe(true);
  });
});

describe("violatesExclusion", () => {
  it("flags an excluded attribute value", () => {
    expect(violatesExclusion(candidate({ attributes: { color: "white" } }), intent({ excludedAttributes: { color: ["white"] } }))).toBe(true);
  });

  it("does not flag a non-excluded value", () => {
    expect(violatesExclusion(candidate({ attributes: { color: "black" } }), intent({ excludedAttributes: { color: ["white"] } }))).toBe(false);
  });
});
