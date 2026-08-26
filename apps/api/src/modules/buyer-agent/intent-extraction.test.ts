import { describe, expect, it } from "vitest";
import { extractAndNormalizeIntent, normalizeCategory } from "./intent-extraction.js";
import { AIProviderError, type AIProvider } from "../agents/ai-provider.js";

const KNOWN_CATEGORIES = ["Running Shoes", "Sportswear", "Socks", "Hydration", "Accessories"];

function providerReturning(extractIntent: AIProvider["extractIntent"]): AIProvider {
  return {
    mode: "LIVE_ANTHROPIC",
    extractIntent,
    rankCandidates: async () => [],
    proposeGrowthAction: async () => {
      throw new Error("not used in these tests");
    },
    proposeRecoveryAction: async () => {
      throw new Error("not used in these tests");
    },
  };
}

describe("normalizeCategory", () => {
  it("matches exactly, case-insensitively", () => {
    expect(normalizeCategory("running shoes", KNOWN_CATEGORIES)).toBe("Running Shoes");
  });

  it("matches a singular guess against the plural catalog category", () => {
    expect(normalizeCategory("sock", KNOWN_CATEGORIES)).toBe("Socks");
  });

  it("passes through an unresolved guess rather than silently dropping the constraint", () => {
    expect(normalizeCategory("bicycles", KNOWN_CATEGORIES)).toBe("bicycles");
  });

  it("returns null for an absent category", () => {
    expect(normalizeCategory(null, KNOWN_CATEGORIES)).toBeNull();
  });
});

describe("extractAndNormalizeIntent", () => {
  it("normalizes a valid raw extraction into a partial intent signal", async () => {
    const provider = providerReturning(async () => ({
      category: "running shoes",
      budgetMinMajor: null,
      budgetMaxMajor: 5000,
      currency: "INR",
      quantity: null,
      requiredAttributes: { size: "UK9", color: "Black" },
      preferredAttributes: {},
      excludedAttributes: {},
      availabilityRequirement: null,
      confidence: 0.9,
    }));

    const outcome = await extractAndNormalizeIntent(provider, "black running shoes size 9 under 5000", KNOWN_CATEGORIES);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.signal.category).toBe("Running Shoes");
    expect(outcome.result.signal.budgetMaxMinor).toBe(500000);
    expect(outcome.result.signal.requiredAttributes).toEqual({ size: "UK9", color: "Black" });
  });

  it("fails safely rather than fabricating an intent when the provider always throws", async () => {
    const provider = providerReturning(async () => {
      throw new AIProviderError("AI_PROVIDER_UNAVAILABLE", "down");
    });
    const outcome = await extractAndNormalizeIntent(provider, "anything", KNOWN_CATEGORIES);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.errorCode).toBe("AI_PROVIDER_UNAVAILABLE");
  });

  it("retries once on malformed structured output before giving up (bounded retry, PART 03 §41)", async () => {
    let calls = 0;
    const provider = providerReturning(async () => {
      calls++;
      if (calls === 1) {
        // Malformed: requiredAttributes is a string, not a record — fails schema validation.
        return { requiredAttributes: "not-a-record" } as never;
      }
      return {
        category: "Sportswear",
        budgetMinMajor: null,
        budgetMaxMajor: null,
        currency: null,
        quantity: null,
        requiredAttributes: {},
        preferredAttributes: {},
        excludedAttributes: {},
        availabilityRequirement: null,
        confidence: 0.5,
      };
    });
    const outcome = await extractAndNormalizeIntent(provider, "some shirt", KNOWN_CATEGORIES);
    expect(calls).toBe(2);
    expect(outcome.ok).toBe(true);
  });

  it("never exceeds the bounded retry count even when every attempt fails", async () => {
    let calls = 0;
    const provider = providerReturning(async () => {
      calls++;
      return { requiredAttributes: "still broken" } as never;
    });
    const outcome = await extractAndNormalizeIntent(provider, "anything", KNOWN_CATEGORIES);
    expect(calls).toBe(2); // 1 initial + MAX_AI_RETRIES(1)
    expect(outcome.ok).toBe(false);
  });

  it("clamps an absurd extracted budget instead of passing it through unbounded", async () => {
    const provider = providerReturning(async () => ({
      category: null,
      budgetMinMajor: null,
      budgetMaxMajor: 999_999_999,
      currency: "INR",
      quantity: null,
      requiredAttributes: {},
      preferredAttributes: {},
      excludedAttributes: {},
      availabilityRequirement: null,
      confidence: 0.5,
    }));
    const outcome = await extractAndNormalizeIntent(provider, "anything", KNOWN_CATEGORIES);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.signal.budgetMaxMinor).toBeLessThanOrEqual(10_000_000_00);
  });
});
