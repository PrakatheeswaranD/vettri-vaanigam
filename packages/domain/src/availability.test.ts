import { describe, expect, it } from "vitest";
import { deriveAvailabilityState, isPurchasable, LOW_STOCK_THRESHOLD } from "./availability";

describe("deriveAvailabilityState", () => {
  it("returns UNAVAILABLE for an inactive variant regardless of quantity", () => {
    expect(deriveAvailabilityState(100, false)).toBe("UNAVAILABLE");
    expect(deriveAvailabilityState(null, false)).toBe("UNAVAILABLE");
  });

  it("returns UNKNOWN when inventory has never been recorded — never IN_STOCK", () => {
    expect(deriveAvailabilityState(null, true)).toBe("UNKNOWN");
    expect(deriveAvailabilityState(undefined, true)).toBe("UNKNOWN");
  });

  it("returns OUT_OF_STOCK for zero or negative quantity", () => {
    expect(deriveAvailabilityState(0, true)).toBe("OUT_OF_STOCK");
    expect(deriveAvailabilityState(-1, true)).toBe("OUT_OF_STOCK");
  });

  it("returns LOW_STOCK at and below the threshold", () => {
    expect(deriveAvailabilityState(1, true)).toBe("LOW_STOCK");
    expect(deriveAvailabilityState(LOW_STOCK_THRESHOLD, true)).toBe("LOW_STOCK");
  });

  it("returns IN_STOCK above the threshold", () => {
    expect(deriveAvailabilityState(LOW_STOCK_THRESHOLD + 1, true)).toBe("IN_STOCK");
    expect(deriveAvailabilityState(1000, true)).toBe("IN_STOCK");
  });
});

describe("isPurchasable", () => {
  it("treats IN_STOCK and LOW_STOCK as purchasable", () => {
    expect(isPurchasable("IN_STOCK")).toBe(true);
    expect(isPurchasable("LOW_STOCK")).toBe(true);
  });

  it("treats OUT_OF_STOCK, UNAVAILABLE, and UNKNOWN as not purchasable", () => {
    expect(isPurchasable("OUT_OF_STOCK")).toBe(false);
    expect(isPurchasable("UNAVAILABLE")).toBe(false);
    expect(isPurchasable("UNKNOWN")).toBe(false);
  });
});
