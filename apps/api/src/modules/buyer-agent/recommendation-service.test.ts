import { describe, expect, it } from "vitest";
import type { AgentReadableProductDTO, AgentVariantDTO } from "@razorgrowth/contracts";
import { emptyIntent, type BuyerIntent } from "@razorgrowth/domain";
import { buildRecommendations } from "./recommendation-service.js";
import type { EvaluatedCandidate, EvaluatedCandidateSet } from "./candidate-evaluation.js";
import { createFixtureProvider } from "../agents/providers/fixture-provider.js";
import { createDemoRuleBasedProvider } from "../agents/providers/demo-rule-based-provider.js";

function variant(id: string, overrides: Partial<AgentVariantDTO> = {}): AgentVariantDTO {
  return {
    variantId: id,
    sku: `SKU-${id}`,
    title: "Variant",
    price: { amountMinor: 449900, currency: "INR" },
    priceUpdatedAt: new Date().toISOString(),
    availability: { state: "IN_STOCK", availableQuantity: 10, updatedAt: new Date().toISOString() },
    attributes: { size: "UK9" },
    active: true,
    ...overrides,
  };
}

function product(id: string, overrides: Partial<AgentReadableProductDTO> = {}): AgentReadableProductDTO {
  return {
    productId: id,
    merchantId: "merchant-1",
    identity: { name: `Product ${id}`, brand: "Meridian", category: "Running Shoes", description: "A shoe." },
    variants: [variant(`${id}-v1`)],
    commerce: { currency: "INR", priceRange: { minMinor: 449900, maxMinor: 449900, currency: "INR" }, purchasableVariantCount: 1 },
    policies: { returns: { status: "KNOWN", summary: "30 days" }, shipping: { status: "KNOWN", summary: "fast" }, promotionEligibility: "UNKNOWN" },
    freshness: { productUpdatedAt: new Date().toISOString(), oldestPriceUpdateAt: null, oldestInventoryUpdateAt: null },
    readiness: { state: "AGENT_READY", missingCritical: [], missingImportant: [] },
    provenance: { source: "MERCHANT_AUTHORED", derivedFields: "SYSTEM_DERIVED", dataset: "SYNTHETIC_DEMO" },
    ...overrides,
  };
}

function candidate(id: string, overrides: Partial<EvaluatedCandidate> = {}): EvaluatedCandidate {
  return {
    product: product(id),
    representativeVariantId: `${id}-v1`,
    matchType: "EXACT",
    violations: [],
    priceMinor: 449900,
    availabilityState: "IN_STOCK",
    attributes: { size: "UK9" },
    ...overrides,
  };
}

function intent(overrides: Partial<BuyerIntent> = {}): BuyerIntent {
  return { ...emptyIntent(), ...overrides };
}

describe("buildRecommendations", () => {
  it("returns NO_MATCH with no candidates when nothing was eligible", async () => {
    const set: EvaluatedCandidateSet = { exact: [], nearMatch: [] };
    const outcome = await buildRecommendations(createDemoRuleBasedProvider(), set, intent());
    expect(outcome.mode).toBe("NO_MATCH");
    expect(outcome.recommendations).toHaveLength(0);
  });

  it("uses DETERMINISTIC_SINGLE_MATCH with no AI call for exactly one exact candidate", async () => {
    const provider = createFixtureProvider({
      rankCandidates: () => {
        throw new Error("must not be called for a single candidate");
      },
    });
    const set: EvaluatedCandidateSet = { exact: [candidate("p1")], nearMatch: [] };
    const outcome = await buildRecommendations(provider, set, intent());
    expect(outcome.mode).toBe("DETERMINISTIC_SINGLE_MATCH");
    expect(outcome.recommendations).toHaveLength(1);
    expect(outcome.recommendations[0]?.productId).toBe("p1");
  });

  it("orders NEAR_MATCH candidates by closeness to budget, with no AI call", async () => {
    const provider = createFixtureProvider({
      rankCandidates: () => {
        throw new Error("must not be called for near-match-only discovery");
      },
    });
    const far = candidate("far", { violations: [{ type: "BUDGET_MAX", expected: "100", actual: "500", differenceMinor: 400 }] });
    const near = candidate("near", { violations: [{ type: "BUDGET_MAX", expected: "100", actual: "150", differenceMinor: 50 }] });
    const set: EvaluatedCandidateSet = { exact: [], nearMatch: [far, near] };
    const outcome = await buildRecommendations(provider, set, intent());
    expect(outcome.mode).toBe("NEAR_MATCH");
    expect(outcome.recommendations[0]?.productId).toBe("near");
  });

  it("never calls the AI provider when running the demo rule-based provider — always DETERMINISTIC_FALLBACK", async () => {
    const set: EvaluatedCandidateSet = { exact: [candidate("p1"), candidate("p2")], nearMatch: [] };
    const outcome = await buildRecommendations(createDemoRuleBasedProvider(), set, intent());
    expect(outcome.mode).toBe("DETERMINISTIC_FALLBACK");
    expect(outcome.groundingFailed).toBe(false);
  });

  it("uses AI_RANKED when the model returns a valid, grounded ranking", async () => {
    const provider = createFixtureProvider({
      rankCandidates: ({ candidates }) => candidates.map((c, i) => ({ productId: c.productId, rank: i + 1, reasonCodes: ["IN_STOCK"] })),
    });
    const set: EvaluatedCandidateSet = { exact: [candidate("p1"), candidate("p2")], nearMatch: [] };
    const outcome = await buildRecommendations(provider, set, intent());
    expect(outcome.mode).toBe("AI_RANKED");
    expect(outcome.groundingFailed).toBe(false);
  });

  it("falls back deterministically when the model hallucinates a product ID outside the candidate set", async () => {
    const provider = createFixtureProvider({
      rankCandidates: () => [{ productId: "HALLUCINATED", rank: 1, reasonCodes: [] }],
    });
    const set: EvaluatedCandidateSet = { exact: [candidate("p1"), candidate("p2")], nearMatch: [] };
    const outcome = await buildRecommendations(provider, set, intent());
    expect(outcome.mode).toBe("DETERMINISTIC_FALLBACK");
    expect(outcome.groundingFailed).toBe(true);
    for (const rec of outcome.recommendations) {
      expect(["p1", "p2"]).toContain(rec.productId);
    }
  });

  it("falls back deterministically when the AI call throws (timeout/network failure)", async () => {
    const provider = createFixtureProvider({
      rankCandidates: () => {
        throw new Error("network down");
      },
    });
    const set: EvaluatedCandidateSet = { exact: [candidate("p1"), candidate("p2")], nearMatch: [] };
    const outcome = await buildRecommendations(provider, set, intent());
    expect(outcome.mode).toBe("DETERMINISTIC_FALLBACK");
    expect(outcome.groundingFailed).toBe(true);
  });

  it("never lets a model-proposed reason code stand without independent factual verification", async () => {
    // Model claims a reason code that isn't actually true of the candidate
    // (candidate has no required attributes match, budget unconstrained).
    const provider = createFixtureProvider({
      rankCandidates: ({ candidates }) => candidates.map((c, i) => ({ productId: c.productId, rank: i + 1, reasonCodes: ["MATCHES_PREFERENCE"] })),
    });
    const set: EvaluatedCandidateSet = { exact: [candidate("p1"), candidate("p2")], nearMatch: [] };
    const outcome = await buildRecommendations(provider, set, intent()); // no preferences set at all
    for (const rec of outcome.recommendations) {
      expect(rec.reasonCodes).not.toContain("MATCHES_PREFERENCE");
    }
  });
});
