import { describe, expect, it } from "vitest";
import { canonicalStringify } from "./canonical-json.js";

describe("canonicalStringify", () => {
  it("produces the same string regardless of key insertion order", () => {
    const a = { b: 1, a: 2, c: 3 };
    const b = { c: 3, a: 2, b: 1 };
    expect(canonicalStringify(a)).toBe(canonicalStringify(b));
  });

  it("produces a different string when a value actually differs", () => {
    expect(canonicalStringify({ a: 1 })).not.toBe(canonicalStringify({ a: 2 }));
  });

  it("sorts keys recursively in nested objects", () => {
    const a = { outer: { z: 1, y: 2 } };
    const b = { outer: { y: 2, z: 1 } };
    expect(canonicalStringify(a)).toBe(canonicalStringify(b));
  });

  it("preserves array order (arrays are not reordered)", () => {
    expect(canonicalStringify([1, 2, 3])).not.toBe(canonicalStringify([3, 2, 1]));
  });

  it("is stable across repeated calls with the same value", () => {
    const value = { z: [1, { b: 2, a: 1 }], a: "x" };
    expect(canonicalStringify(value)).toBe(canonicalStringify(value));
  });

  it("distinguishes null from absent/other falsy values", () => {
    expect(canonicalStringify({ a: null })).not.toBe(canonicalStringify({ a: 0 }));
    expect(canonicalStringify({ a: null })).not.toBe(canonicalStringify({ a: false }));
  });
});
