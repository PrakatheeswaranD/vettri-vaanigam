import { describe, expect, it } from "vitest";
import { MAX_REASONABLE_BUDGET_MINOR, normalizeBudgetAmount } from "./budget-normalization.js";

describe("normalizeBudgetAmount", () => {
  it("converts major-unit rupees into integer minor units", () => {
    expect(normalizeBudgetAmount(5000)).toBe(500000);
  });

  it("returns null for missing input", () => {
    expect(normalizeBudgetAmount(null)).toBeNull();
    expect(normalizeBudgetAmount(undefined)).toBeNull();
  });

  it("returns null for negative or non-finite input rather than a fabricated value", () => {
    expect(normalizeBudgetAmount(-100)).toBeNull();
    expect(normalizeBudgetAmount(Number.NaN)).toBeNull();
    expect(normalizeBudgetAmount(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("clamps an absurd figure instead of letting it reach catalog filtering unbounded", () => {
    expect(normalizeBudgetAmount(999_999_999)).toBe(MAX_REASONABLE_BUDGET_MINOR);
  });

  it("rounds fractional rupees to the nearest paisa", () => {
    expect(normalizeBudgetAmount(49.994)).toBe(4999);
    expect(Number.isInteger(normalizeBudgetAmount(49.994))).toBe(true);
  });
});
