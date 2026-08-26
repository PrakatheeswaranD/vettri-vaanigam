import { describe, expect, it } from "vitest";
import { resolveAuthorizedSelection } from "./commerce-execution.js";

const PRIMARY = "primary-id";
const RELATED = "related-id";
const RELATED_2 = "related-id-2";

describe("resolveAuthorizedSelection (PART 06 §55-§60)", () => {
  it("rejects a selection that does not match the authorized primary product", () => {
    const result = resolveAuthorizedSelection("CROSS_SELL", PRIMARY, [RELATED], { productId: "someone-elses-id", quantity: 1 });
    expect(result.ok).toBe(false);
  });

  it("CROSS_SELL adds the related product alongside the primary selection", () => {
    const result = resolveAuthorizedSelection("CROSS_SELL", PRIMARY, [RELATED], { productId: PRIMARY, quantity: 2 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lines).toEqual([
      { productId: PRIMARY, role: "PRIMARY", quantity: 2, offerEligible: true },
      { productId: RELATED, role: "ADDED", quantity: 1, offerEligible: false },
    ]);
  });

  it("BUNDLE adds every related product at quantity 1", () => {
    const result = resolveAuthorizedSelection("BUNDLE", PRIMARY, [RELATED, RELATED_2], { productId: PRIMARY, quantity: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lines).toHaveLength(3);
    expect(result.lines[1]).toEqual({ productId: RELATED, role: "ADDED", quantity: 1, offerEligible: false });
    expect(result.lines[2]).toEqual({ productId: RELATED_2, role: "ADDED", quantity: 1, offerEligible: false });
  });

  it("UPSELL replaces the primary with the authorized target, carrying over quantity, and never adds both", () => {
    const result = resolveAuthorizedSelection("UPSELL", PRIMARY, [RELATED], { productId: PRIMARY, quantity: 3 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lines).toEqual([{ productId: RELATED, role: "REPLACEMENT", quantity: 3, offerEligible: true }]);
  });

  it("RECOVERY applies to the primary product alone, even though relatedProductIds conventionally echoes it", () => {
    const result = resolveAuthorizedSelection("RECOVERY", PRIMARY, [PRIMARY], { productId: PRIMARY, quantity: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lines).toEqual([{ productId: PRIMARY, role: "PRIMARY", quantity: 1, offerEligible: true }]);
  });

  it("BOUNDED_OFFER discounts the primary product", () => {
    const result = resolveAuthorizedSelection("BOUNDED_OFFER", PRIMARY, [], { productId: PRIMARY, quantity: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lines).toEqual([{ productId: PRIMARY, role: "PRIMARY", quantity: 1, offerEligible: true }]);
  });

  it("rejects CROSS_SELL with no related product to add", () => {
    const result = resolveAuthorizedSelection("CROSS_SELL", PRIMARY, [], { productId: PRIMARY, quantity: 1 });
    expect(result.ok).toBe(false);
  });

  it("rejects UPSELL with no distinct replacement", () => {
    const result = resolveAuthorizedSelection("UPSELL", PRIMARY, [], { productId: PRIMARY, quantity: 1 });
    expect(result.ok).toBe(false);
  });

  it("exactly one line is offer-eligible per execution (never stacked, §30/§163)", () => {
    const crossSell = resolveAuthorizedSelection("CROSS_SELL", PRIMARY, [RELATED], { productId: PRIMARY, quantity: 1 });
    const bundle = resolveAuthorizedSelection("BUNDLE", PRIMARY, [RELATED, RELATED_2], { productId: PRIMARY, quantity: 1 });
    const upsell = resolveAuthorizedSelection("UPSELL", PRIMARY, [RELATED], { productId: PRIMARY, quantity: 1 });
    for (const result of [crossSell, bundle, upsell]) {
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.lines.filter((l) => l.offerEligible)).toHaveLength(1);
    }
  });
});
