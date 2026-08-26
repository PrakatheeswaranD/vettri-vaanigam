import { describe, expect, it } from "vitest";
import { emptyIntent, mergeIntentSignal, needsClarification, type PartialIntentSignal } from "./buyer-intent.js";

function signal(overrides: Partial<PartialIntentSignal> = {}): PartialIntentSignal {
  return {
    category: null,
    budgetMinMinor: null,
    budgetMaxMinor: null,
    currency: null,
    quantity: null,
    requiredAttributes: {},
    preferredAttributes: {},
    excludedAttributes: {},
    availabilityRequirement: null,
    ...overrides,
  };
}

describe("mergeIntentSignal", () => {
  it("adopts every field from the first message when there is no prior intent", () => {
    const merged = mergeIntentSignal(
      null,
      signal({ category: "running-shoes", budgetMaxMinor: 500000, currency: "INR", requiredAttributes: { size: "uk9" } }),
    );
    expect(merged.category).toBe("running-shoes");
    expect(merged.budget.maxMinor).toBe(500000);
    expect(merged.requiredAttributes).toEqual({ size: "uk9" });
  });

  it("retains prior constraints when a follow-up message only adds one field (PART 03 §51)", () => {
    const prior = mergeIntentSignal(null, signal({ category: "running-shoes", budgetMaxMinor: 500000, currency: "INR" }));
    const merged = mergeIntentSignal(prior, signal({ requiredAttributes: { size: "uk9" } }));
    expect(merged.category).toBe("running-shoes");
    expect(merged.budget.maxMinor).toBe(500000);
    expect(merged.requiredAttributes).toEqual({ size: "uk9" });
  });

  it("lets an explicit new value override a prior one (PART 03 §52)", () => {
    const prior = mergeIntentSignal(null, signal({ budgetMaxMinor: 500000, currency: "INR" }));
    const merged = mergeIntentSignal(prior, signal({ budgetMaxMinor: 600000, currency: "INR" }));
    expect(merged.budget.maxMinor).toBe(600000);
  });

  it("merges required attributes additively rather than replacing the whole map", () => {
    const prior = mergeIntentSignal(null, signal({ requiredAttributes: { size: "uk9" } }));
    const merged = mergeIntentSignal(prior, signal({ requiredAttributes: { color: "black" } }));
    expect(merged.requiredAttributes).toEqual({ size: "uk9", color: "black" });
  });

  it("clamps quantity to the maximum bound", () => {
    const merged = mergeIntentSignal(null, signal({ quantity: 999 }));
    expect(merged.quantity).toBeLessThanOrEqual(10);
  });
});

describe("emptyIntent / reset", () => {
  it("produces a blank intent with no leaked constraints", () => {
    const intent = emptyIntent();
    expect(intent.category).toBeNull();
    expect(intent.requiredAttributes).toEqual({});
    expect(intent.budget.maxMinor).toBeNull();
  });
});

describe("needsClarification", () => {
  it("requires clarification when neither category nor required attributes are known", () => {
    expect(needsClarification(emptyIntent())).toBe(true);
  });

  it("does not require clarification once a category is known", () => {
    const intent = mergeIntentSignal(null, signal({ category: "running-shoes" }));
    expect(needsClarification(intent)).toBe(false);
  });

  it("does not require clarification when a required attribute alone is known", () => {
    const intent = mergeIntentSignal(null, signal({ requiredAttributes: { size: "uk9" } }));
    expect(needsClarification(intent)).toBe(false);
  });
});
