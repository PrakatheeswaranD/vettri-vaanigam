/**
 * Regression tests for the attribute-vocabulary sample.
 *
 * A live query once returned NO_MATCH because the sample took the FIRST N
 * values of a sorted list: this catalog's sizes sort as
 * `250ml, 750ml, L, L/XL, M, One Size, S, S/M, UK10, …`, so the model was
 * shown no `UK*` value at all, answered `size: "9"`, and the deterministic
 * filter matched nothing. The sample must always reach the end of the
 * range.
 */
import { describe, it, expect } from "vitest";
import { sampleValues } from "./modules/buyer-agent/catalog-gateway.js";

const SIZES = ["250ml", "750ml", "L", "L/XL", "M", "One Size", "S", "S/M", "UK10", "UK11", "UK7", "UK8", "UK9", "XL"];

describe("attribute vocabulary sampling", () => {
  it("returns every value when the list fits within the limit", () => {
    expect(sampleValues(SIZES, 20)).toEqual(SIZES);
  });

  it("still represents the end of the range when it must truncate", () => {
    const sampled = sampleValues(SIZES, 6);
    expect(sampled.length).toBeLessThanOrEqual(6);
    expect(sampled[0]).toBe("250ml");
    expect(sampled).toContain("XL");
    // The bug: a first-N slice stopped at "S/M" and showed no UK size.
    expect(sampled.some((v) => v.startsWith("UK"))).toBe(true);
  });

  it("never invents or reorders values", () => {
    const sampled = sampleValues(SIZES, 5);
    expect(sampled.every((v) => SIZES.includes(v))).toBe(true);
    expect([...sampled]).toEqual([...sampled].sort((a, b) => SIZES.indexOf(a) - SIZES.indexOf(b)));
  });

  it("handles a single value and an empty list", () => {
    expect(sampleValues(["Black"], 8)).toEqual(["Black"]);
    expect(sampleValues([], 8)).toEqual([]);
  });
});
