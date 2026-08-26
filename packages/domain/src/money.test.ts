import { describe, expect, it } from "vitest";
import { Money, MoneyError } from "./money";

describe("Money", () => {
  it("accepts a valid INR integer minor-unit amount", () => {
    // ₹4,999.50
    const m = Money.of(499_950, "INR");
    expect(m.amountMinor).toBe(499_950);
    expect(m.currency).toBe("INR");
  });

  it("accepts zero", () => {
    const m = Money.zero("INR");
    expect(m.isZero()).toBe(true);
  });

  it("rejects a fractional minor-unit amount (float leakage)", () => {
    expect(() => Money.of(499_950.5, "INR")).toThrow(MoneyError);
  });

  it("rejects NaN", () => {
    expect(() => Money.of(Number.NaN, "INR")).toThrow(MoneyError);
  });

  it("rejects Infinity", () => {
    expect(() => Money.of(Number.POSITIVE_INFINITY, "INR")).toThrow(MoneyError);
  });

  it("rejects an unsupported currency", () => {
    expect(() => Money.of(100, "XXX")).toThrow(MoneyError);
  });

  it("adds two amounts of the same currency", () => {
    const a = Money.of(1_000, "INR");
    const b = Money.of(500, "INR");
    expect(a.add(b).amountMinor).toBe(1_500);
  });

  it("subtracts two amounts of the same currency", () => {
    const a = Money.of(1_000, "INR");
    const b = Money.of(300, "INR");
    expect(a.subtract(b).amountMinor).toBe(700);
  });

  it("throws on cross-currency addition", () => {
    const a = Money.of(1_000, "INR");
    const b = Money.of(1_000, "USD");
    expect(() => a.add(b)).toThrow(MoneyError);
  });

  it("throws on cross-currency comparison", () => {
    const a = Money.of(1_000, "INR");
    const b = Money.of(1_000, "USD");
    expect(() => a.greaterThan(b)).toThrow(MoneyError);
  });

  it("compares amounts of the same currency", () => {
    const a = Money.of(1_000, "INR");
    const b = Money.of(500, "INR");
    expect(a.greaterThan(b)).toBe(true);
    expect(b.lessThan(a)).toBe(true);
    expect(a.equals(Money.of(1_000, "INR"))).toBe(true);
  });

  it("scales by a non-negative integer quantity", () => {
    const unit = Money.of(19_900, "INR");
    expect(unit.multiplyByQuantity(3).amountMinor).toBe(59_700);
  });

  it("rejects a negative quantity", () => {
    const unit = Money.of(19_900, "INR");
    expect(() => unit.multiplyByQuantity(-1)).toThrow(MoneyError);
  });

  it("round-trips through JSON", () => {
    const original = Money.of(250_000, "INR");
    const restored = Money.fromJSON(JSON.parse(JSON.stringify(original.toJSON())));
    expect(restored.equals(original)).toBe(true);
  });
});
