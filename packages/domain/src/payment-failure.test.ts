import { describe, expect, it } from "vitest";
import { PAYMENT_FAILURE_CATEGORIES, isPaymentFailureCategory } from "./payment-failure.js";

describe("payment-failure taxonomy", () => {
  it("is a small, closed, distinct vocabulary", () => {
    expect(new Set(PAYMENT_FAILURE_CATEGORIES).size).toBe(PAYMENT_FAILURE_CATEGORIES.length);
  });

  it("recognizes every category in the closed list", () => {
    for (const category of PAYMENT_FAILURE_CATEGORIES) {
      expect(isPaymentFailureCategory(category)).toBe(true);
    }
  });

  it("rejects a raw/unrecognized provider string", () => {
    expect(isPaymentFailureCategory("BAD_REQUEST_ERROR")).toBe(false);
    expect(isPaymentFailureCategory("")).toBe(false);
  });
});
