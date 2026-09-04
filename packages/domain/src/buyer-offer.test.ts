/**
 * PART 18 — the discount arithmetic, pinned in one place.
 *
 * These numbers decide what a buyer is quoted in discovery AND what they
 * are charged at checkout. Before this module they were computed inline in
 * `createPurchaseProposal` only, and discovery used list price — so a
 * product a governed discount brought inside the buyer's budget was
 * rejected as over-budget.
 */
import { describe, expect, it } from "vitest";
import { effectivePriceMinor, offerDiscountMinor } from "./buyer-offer.js";

describe("offerDiscountMinor", () => {
  it("recomputes a percentage against THIS basket, not the merchant's assumed one", () => {
    // 5% of ₹4,500 — not the ₹224.95 the merchant calculated against ₹4,499.
    expect(offerDiscountMinor(450_000, { percentageBps: 500, discountMinor: 22_495 })).toBe(22_500);
  });

  it("caps a fixed amount at the basket — a discount bigger than the basket is a refund nobody authorized", () => {
    expect(offerDiscountMinor(1_000, { percentageBps: null, discountMinor: 5_000 })).toBe(1_000);
  });

  it("is zero for no offer, an empty offer, or an empty basket", () => {
    expect(offerDiscountMinor(450_000, null)).toBe(0);
    expect(offerDiscountMinor(450_000, { percentageBps: 0, discountMinor: 0 })).toBe(0);
    expect(offerDiscountMinor(0, { percentageBps: 500, discountMinor: null })).toBe(0);
  });

  it("never returns a negative discount or one above the basket", () => {
    for (const bps of [1, 500, 9_999, 10_000, 20_000]) {
      const d = offerDiscountMinor(450_000, { percentageBps: bps, discountMinor: null });
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(450_000);
    }
  });

  it("stays in integer minor units", () => {
    // 3.33% of ₹4,499 rounds rather than producing a fraction of a paisa.
    const d = offerDiscountMinor(449_900, { percentageBps: 333, discountMinor: null });
    expect(Number.isInteger(d)).toBe(true);
    expect(d).toBe(Math.round((449_900 * 333) / 10_000));
  });
});

describe("effectivePriceMinor", () => {
  it("is what the buyer actually pays", () => {
    expect(effectivePriceMinor(450_000, { percentageBps: 500, discountMinor: null })).toBe(427_500);
  });

  it("brings a product inside a budget its list price misses", () => {
    // The bug this module exists to fix: ₹5,200 list, 10% authorized, a
    // buyer with a ₹5,000 ceiling. List price says no; the truth says yes.
    const listMinor = 520_000;
    const budgetMinor = 500_000;
    expect(listMinor).toBeGreaterThan(budgetMinor);
    expect(effectivePriceMinor(listMinor, { percentageBps: 1_000, discountMinor: null })).toBeLessThanOrEqual(budgetMinor);
  });

  it("never goes below zero", () => {
    expect(effectivePriceMinor(1_000, { percentageBps: null, discountMinor: 999_999 })).toBe(0);
  });
});
