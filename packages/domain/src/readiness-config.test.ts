import { describe, expect, it } from "vitest";
import {
  applyCriticalCap,
  deriveReadinessLevel,
  READINESS_WEIGHTS,
  READINESS_WEIGHT_TOTAL,
  scoreFreshnessByAge,
} from "./readiness-config";
import { assertValidWeights, READINESS_DIMENSIONS } from "./readiness";

describe("READINESS_WEIGHTS", () => {
  it("has an entry for every readiness dimension", () => {
    for (const dimension of READINESS_DIMENSIONS) {
      expect(READINESS_WEIGHTS[dimension]).toBeGreaterThan(0);
    }
  });

  it("sums to exactly READINESS_WEIGHT_TOTAL (PART 02 §116)", () => {
    const sum = READINESS_DIMENSIONS.reduce((acc, d) => acc + READINESS_WEIGHTS[d], 0);
    expect(sum).toBe(READINESS_WEIGHT_TOTAL);
    expect(() => assertValidWeights()).not.toThrow();
  });

  it("assertValidWeights throws on a corrupted weight table", () => {
    const corrupted = { ...READINESS_WEIGHTS, catalogCompleteness: 999 };
    expect(() => assertValidWeights(corrupted)).toThrow();
  });
});

describe("deriveReadinessLevel", () => {
  it("maps score ranges to the documented levels", () => {
    expect(deriveReadinessLevel(100)).toBe("AGENT_READY");
    expect(deriveReadinessLevel(90)).toBe("AGENT_READY");
    expect(deriveReadinessLevel(89)).toBe("NEARLY_READY");
    expect(deriveReadinessLevel(75)).toBe("NEARLY_READY");
    expect(deriveReadinessLevel(74)).toBe("PARTIALLY_READY");
    expect(deriveReadinessLevel(50)).toBe("PARTIALLY_READY");
    expect(deriveReadinessLevel(49)).toBe("NOT_READY");
    expect(deriveReadinessLevel(0)).toBe("NOT_READY");
  });
});

describe("scoreFreshnessByAge", () => {
  it("scores recent updates highest", () => {
    expect(scoreFreshnessByAge(1)).toBe(100);
    expect(scoreFreshnessByAge(24)).toBe(100);
  });

  it("scores progressively older updates lower", () => {
    expect(scoreFreshnessByAge(48)).toBe(90);
    expect(scoreFreshnessByAge(24 * 6)).toBe(75);
    expect(scoreFreshnessByAge(24 * 20)).toBe(55);
  });

  it("never returns below the oldest band's score", () => {
    expect(scoreFreshnessByAge(24 * 365)).toBe(35);
  });
});

describe("applyCriticalCap", () => {
  it("caps at 0 when there are no active variants at all", () => {
    const capped = applyCriticalCap(95, { activeVariantCount: 0, purchasableProductCount: 0 });
    expect(capped).toBe(0);
  });

  it("caps at 20 when variants exist but none are purchasable", () => {
    const capped = applyCriticalCap(95, { activeVariantCount: 10, purchasableProductCount: 0 });
    expect(capped).toBe(20);
  });

  it("does not alter the score when the merchant can actually transact", () => {
    const capped = applyCriticalCap(82, { activeVariantCount: 10, purchasableProductCount: 5 });
    expect(capped).toBe(82);
  });

  it("never raises a low score — cap is a ceiling, not a floor", () => {
    const capped = applyCriticalCap(5, { activeVariantCount: 10, purchasableProductCount: 5 });
    expect(capped).toBe(5);
  });
});
