import { describe, it, expect } from "vitest";
import { scanCatalogueForOpportunities, type ScanProduct } from "./opportunity-scan.js";

function product(overrides: Partial<ScanProduct> = {}): ScanProduct {
  return {
    productId: "p1",
    name: "Pulse Runner",
    category: "Running Shoes",
    buyableVariantCount: 3,
    variantsWithUnknownStock: 0,
    variantsWithoutAttributes: 0,
    outgoingRelationshipCount: 2,
    ...overrides,
  };
}

/** A second product keeps the category off the thin-category rule. */
const FILLER = product({ productId: "p2", name: "Trailblaze" });

describe("catalogue opportunity scan", () => {
  it("finds nothing wrong with a healthy catalogue", () => {
    expect(scanCatalogueForOpportunities([product(), FILLER])).toEqual([]);
  });

  it("returns nothing for an empty catalogue rather than inventing work", () => {
    expect(scanCatalogueForOpportunities([])).toEqual([]);
  });

  it("flags a product an agent could discover but never buy", () => {
    const found = scanCatalogueForOpportunities([product({ buyableVariantCount: 0 }), FILLER]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ category: "CATALOG_GAP", productId: "p1" });
    expect(found[0]!.signal).toContain("no active, priced variant");
  });

  /** An unbuyable product's other defects are noise until it can be sold. */
  it("reports only the blocking gap on an unbuyable product", () => {
    const found = scanCatalogueForOpportunities([
      product({ buyableVariantCount: 0, outgoingRelationshipCount: 0, variantsWithUnknownStock: 2 }),
      FILLER,
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]!.category).toBe("CATALOG_GAP");
  });

  it("flags a product the Merchant Agent has nothing to cross-sell from", () => {
    const found = scanCatalogueForOpportunities([product({ outgoingRelationshipCount: 0 }), FILLER]);
    expect(found.map((o) => o.category)).toContain("CROSS_SELL");
  });

  it("flags unrecorded stock as a readiness gap, not as out of stock", () => {
    const found = scanCatalogueForOpportunities([product({ variantsWithUnknownStock: 2 }), FILLER]);
    const gap = found.find((o) => o.category === "READINESS_GAP");
    expect(gap!.signal).toContain("no recorded stock");
    expect(gap!.recommendation).toContain("will not commit to stock nobody has stated");
  });

  it("flags variants with nothing structured to match on", () => {
    const found = scanCatalogueForOpportunities([product({ variantsWithoutAttributes: 1 }), FILLER]);
    expect(found.some((o) => o.signal.includes("no structured attributes"))).toBe(true);
  });

  it("flags a category too thin to upsell within", () => {
    const found = scanCatalogueForOpportunities([product({ category: "Hydration" }), FILLER]);
    const upsell = found.find((o) => o.category === "UPSELL");
    expect(upsell).toBeTruthy();
    expect(upsell!.productId).toBeNull();
  });

  /**
   * The feed must never carry a revenue figure. We have no basis for one,
   * and a fabricated rupee amount is precisely what made the old seeded
   * feed misleading.
   */
  it("never attaches an invented value to an opportunity", () => {
    const found = scanCatalogueForOpportunities([
      product({ buyableVariantCount: 0 }),
      product({ productId: "p3", name: "Aero", outgoingRelationshipCount: 0 }),
      FILLER,
    ]);
    expect(found.length).toBeGreaterThan(0);
    for (const opportunity of found) {
      expect(Object.keys(opportunity)).not.toContain("estimatedValueMinor");
      expect(opportunity.signal.length).toBeGreaterThan(10);
      expect(opportunity.recommendation.length).toBeGreaterThan(10);
    }
  });
});
