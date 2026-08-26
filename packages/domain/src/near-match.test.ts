import { describe, expect, it } from "vitest";
import { isNearMatchEligible } from "./near-match.js";
import type { ConstraintViolation } from "./buyer-eligibility.js";

const budgetViolation: ConstraintViolation = { type: "BUDGET_MAX", expected: "500000", actual: "529900", differenceMinor: 29900 };
const attributeViolation: ConstraintViolation = { type: "REQUIRED_ATTRIBUTE", expected: "size=uk9", actual: "size=uk8", differenceMinor: null };

describe("isNearMatchEligible", () => {
  it("is not near-match eligible with zero violations (it's an exact match)", () => {
    expect(isNearMatchEligible([])).toBe(false);
  });

  it("is eligible when the only violation is over budget", () => {
    expect(isNearMatchEligible([budgetViolation])).toBe(true);
  });

  it("is never eligible when a required attribute is violated, even alongside budget", () => {
    expect(isNearMatchEligible([attributeViolation])).toBe(false);
    expect(isNearMatchEligible([budgetViolation, attributeViolation])).toBe(false);
  });
});
