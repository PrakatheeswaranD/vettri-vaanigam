import { describe, expect, it } from "vitest";
import type { AgentReadableProductDTO, AgentVariantDTO } from "@razorgrowth/contracts";
import { emptyIntent, type BuyerIntent } from "@razorgrowth/domain";
import { evaluateCandidates, evaluateProduct } from "./candidate-evaluation.js";

function variant(overrides: Partial<AgentVariantDTO> = {}): AgentVariantDTO {
  return {
    variantId: "11111111-1111-1111-1111-111111111111",
    sku: "SKU-1",
    title: "Variant",
    price: { amountMinor: 580200, currency: "INR" },
    priceUpdatedAt: new Date().toISOString(),
    availability: { state: "IN_STOCK", availableQuantity: 13, updatedAt: new Date().toISOString() },
    attributes: { size: "UK9", color: "Black" },
    active: true,
    ...overrides,
  };
}

function product(overrides: Partial<AgentReadableProductDTO> = {}, variants: AgentVariantDTO[] = [variant()]): AgentReadableProductDTO {
  return {
    productId: "22222222-2222-2222-2222-222222222222",
    merchantId: "33333333-3333-3333-3333-333333333333",
    identity: { name: "Meridian Summit Trail", brand: "Meridian", category: "Running Shoes", description: "Trail shoe." },
    variants,
    commerce: { currency: "INR", priceRange: { minMinor: 580200, maxMinor: 580200, currency: "INR" }, purchasableVariantCount: 1 },
    policies: { returns: { status: "KNOWN", summary: "30 days" }, shipping: { status: "KNOWN", summary: "2 days" }, promotionEligibility: "UNKNOWN" },
    freshness: { productUpdatedAt: new Date().toISOString(), oldestPriceUpdateAt: null, oldestInventoryUpdateAt: null },
    readiness: { state: "AGENT_READY", missingCritical: [], missingImportant: [] },
    provenance: { source: "MERCHANT_AUTHORED", derivedFields: "SYSTEM_DERIVED", dataset: "SYNTHETIC_DEMO" },
    relationships: { crossSell: [], upsell: [], similar: [], bundle: [] },
    ...overrides,
  };
}

function intent(overrides: Partial<BuyerIntent> = {}): BuyerIntent {
  return { ...emptyIntent(), ...overrides };
}

describe("evaluateProduct", () => {
  it("is an EXACT match when every hard constraint is satisfied", () => {
    const result = evaluateProduct(
      product(),
      intent({ requiredAttributes: { size: "uk9", color: "black" }, budget: { minMinor: null, maxMinor: 600000, currency: "INR" } }),
    );
    expect(result?.matchType).toBe("EXACT");
    expect(result?.violations).toHaveLength(0);
  });

  it("is a NEAR_MATCH when the only violation is over budget", () => {
    const result = evaluateProduct(
      product(),
      intent({ requiredAttributes: { size: "uk9", color: "black" }, budget: { minMinor: null, maxMinor: 500000, currency: "INR" } }),
    );
    expect(result?.matchType).toBe("NEAR_MATCH");
    expect(result?.violations[0]).toMatchObject({ type: "BUDGET_MAX", differenceMinor: 80200 });
  });

  it("is neither exact nor near-match when a required attribute is violated (never silently relaxed)", () => {
    const result = evaluateProduct(product(), intent({ requiredAttributes: { size: "uk8" } }));
    expect(result).toBeNull();
  });

  it("is excluded entirely when the variant matches an excluded attribute, even if price/size fit", () => {
    const result = evaluateProduct(product(), intent({ excludedAttributes: { color: ["black"] } }));
    expect(result).toBeNull();
  });

  it("picks the cheapest exactly-eligible variant among several as the representative", () => {
    const cheap = variant({ variantId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", price: { amountMinor: 449900, currency: "INR" }, attributes: { size: "UK9", color: "Black" } });
    const expensive = variant({ variantId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", price: { amountMinor: 580200, currency: "INR" }, attributes: { size: "UK9", color: "Black" } });
    const result = evaluateProduct(product({}, [expensive, cheap]), intent({ requiredAttributes: { size: "uk9" } }));
    expect(result?.representativeVariantId).toBe("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
  });

  it("skips inactive variants entirely", () => {
    const result = evaluateProduct(product({}, [variant({ active: false })]), intent());
    expect(result).toBeNull();
  });
});

describe("evaluateCandidates", () => {
  it("buckets products into exact and near-match sets", () => {
    const exactProduct = product({ productId: "exact-product" });
    const nearProduct = product({ productId: "near-product" }, [variant({ price: { amountMinor: 900000, currency: "INR" } })]);
    const result = evaluateCandidates([exactProduct, nearProduct], intent({ budget: { minMinor: null, maxMinor: 600000, currency: "INR" } }));
    expect(result.exact.map((c) => c.product.productId)).toContain("exact-product");
    expect(result.nearMatch.map((c) => c.product.productId)).toContain("near-product");
  });
});
