import { describe, expect, it } from "vitest";
import { formatMoney } from "./format";

describe("formatMoney", () => {
  it("formats integer minor units as a localized INR amount", () => {
    expect(formatMoney({ amountMinor: 499_950, currency: "INR" })).toBe("₹4,999.50");
  });

  it("formats zero correctly", () => {
    expect(formatMoney({ amountMinor: 0, currency: "INR" })).toBe("₹0.00");
  });

  it("formats USD with the correct symbol", () => {
    expect(formatMoney({ amountMinor: 150_00, currency: "USD" })).toBe("$150.00");
  });

  it("never divides by anything other than 100 (minor units are always cents/paise)", () => {
    expect(formatMoney({ amountMinor: 100, currency: "INR" })).toBe("₹1.00");
  });
});
