import { describe, expect, it } from "vitest";
import { calculateOffer, calculateOpportunity } from "./growth-money.js";

describe("calculateOffer", () => {
  it("computes a percentage discount using integer basis points", () => {
    const result = calculateOffer(429900, { kind: "PERCENTAGE", percentageBps: 500, amountMinor: null });
    expect(result.discountMinor).toBe(21495); // 5% of 429900
    expect(result.finalAmountMinor).toBe(429900 - 21495);
  });

  it("rounds a percentage discount down, never up (never exceeds the configured bps)", () => {
    const result = calculateOffer(999, { kind: "PERCENTAGE", percentageBps: 333, amountMinor: null });
    // 999 * 333 / 10000 = 33.2667 -> floors to 33
    expect(result.discountMinor).toBe(33);
  });

  it("uses a fixed amount discount directly", () => {
    const result = calculateOffer(429900, { kind: "FIXED_AMOUNT", percentageBps: null, amountMinor: 20000 });
    expect(result.discountMinor).toBe(20000);
    expect(result.finalAmountMinor).toBe(409900);
  });

  it("never lets the final amount go negative — clamps discount to the base amount", () => {
    const result = calculateOffer(1000, { kind: "FIXED_AMOUNT", percentageBps: null, amountMinor: 999999 });
    expect(result.discountMinor).toBe(1000);
    expect(result.finalAmountMinor).toBe(0);
  });

  it("never produces a negative discount even with malformed negative input", () => {
    const result = calculateOffer(1000, { kind: "FIXED_AMOUNT", percentageBps: null, amountMinor: -500 });
    expect(result.discountMinor).toBe(0);
    expect(result.finalAmountMinor).toBe(1000);
  });
});

describe("calculateOpportunity", () => {
  it("computes basket opportunity deterministically", () => {
    const result = calculateOpportunity(429900, 69900);
    expect(result.potentialBasketMinor).toBe(499800);
    expect(result.opportunityDeltaMinor).toBe(69900);
  });
});
