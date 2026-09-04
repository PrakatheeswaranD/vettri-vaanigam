/**
 * PART 18 — a budget is about what the buyer pays.
 *
 * `evaluateEligibility` compares a candidate's `priceMinor` to the
 * buyer's ceiling. Discovery fed it the LIST price while offers were
 * resolved only for products that had already won ranking — so a product
 * a merchant-authorized discount brought inside the buyer's stated budget
 * was rejected as over-budget. The buyer lost something they could
 * afford; the merchant lost the sale their own agent had discounted.
 *
 * These assert the domain rule the fix depends on: feed eligibility the
 * effective price and the answer changes, without loosening the budget.
 */
import { describe, expect, it } from "vitest";
import { effectivePriceMinor } from "./buyer-offer.js";
import { evaluateEligibility } from "./buyer-eligibility.js";
import type { BuyerIntent } from "./buyer-intent.js";
import type { EligibilityCandidate } from "./buyer-eligibility.js";

const intent: BuyerIntent = {
  category: "Running Shoes",
  budget: { maxMinor: 500_000, minMinor: null, currency: "INR" },
  requiredAttributes: {},
  excludedAttributes: {},
  preferredAttributes: {},
  availabilityRequirement: "PURCHASABLE_ONLY",
  quantity: 1,
};

function candidate(priceMinor: number): EligibilityCandidate {
  return {
    productId: "p1",
    priceMinor,
    availabilityState: "IN_STOCK",
    attributes: { category: "running shoes" },
  };
}

const LIST = 520_000; // ₹5,200 — over the buyer's ₹5,000 ceiling
const TEN_PERCENT = { percentageBps: 1_000, discountMinor: null };

describe("budget eligibility and merchant-authorized offers", () => {
  it("rejects the product on its list price", () => {
    const { eligible, violations } = evaluateEligibility(candidate(LIST), intent);
    expect(eligible).toBe(false);
    expect(violations.some((v) => v.type === "BUDGET_MAX")).toBe(true);
  });

  it("accepts the same product on the price the buyer would actually pay", () => {
    const effective = effectivePriceMinor(LIST, TEN_PERCENT);
    expect(effective).toBe(468_000);
    const { eligible } = evaluateEligibility(candidate(effective), intent);
    expect(eligible, "₹4,680 is inside a ₹5,000 budget").toBe(true);
  });

  it("does not loosen the budget — a discount that is not enough still fails", () => {
    // 2% off ₹5,200 is ₹5,096: still over. The fix must change which
    // number is compared, never the comparison.
    const effective = effectivePriceMinor(LIST, { percentageBps: 200, discountMinor: null });
    expect(effective).toBeGreaterThan(intent.budget.maxMinor!);
    expect(evaluateEligibility(candidate(effective), intent).eligible).toBe(false);
  });

  it("leaves an undiscounted product exactly where it was", () => {
    const effective = effectivePriceMinor(LIST, null);
    expect(effective).toBe(LIST);
    expect(evaluateEligibility(candidate(effective), intent).eligible).toBe(false);
  });
});
