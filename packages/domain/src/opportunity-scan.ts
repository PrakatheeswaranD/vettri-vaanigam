/**
 * Catalogue opportunity scanning.
 *
 * WHY THIS EXISTS
 *
 * The Growth page's opportunity feed was fifteen seeded rows that no agent
 * ever wrote, sitting immediately beside the real proposal pipeline and
 * looking like the same kind of thing. That is the most dangerous sort of
 * demo artifact: not false, but easy to mistake for live output.
 *
 * This makes it real. Every opportunity below is DERIVED from catalogue
 * facts the merchant can check — a product with no relationships, a variant
 * with no recorded stock, a category with a single item. Nothing here is an
 * estimate of revenue; `estimatedValueMinor` is deliberately absent because
 * we have no basis for one, and inventing a rupee figure to make the feed
 * look impressive is exactly the dishonesty the rest of this codebase
 * refuses.
 *
 * PURE ON PURPOSE
 *
 * No database, no clock, no AI. The Merchant Agent proposes ACTIONS on an
 * opportunity later, through the normal validation → policy → approval
 * chain; identifying that an opportunity exists is deterministic reading of
 * the catalogue, and a model would only add a hallucination surface to a
 * job arithmetic already does correctly.
 */

export type ScannedOpportunityCategory = "CROSS_SELL" | "UPSELL" | "CATALOG_GAP" | "READINESS_GAP";

export interface ScanProduct {
  productId: string;
  name: string;
  category: string;
  /** Variants that are active AND priced — what an agent could actually buy. */
  buyableVariantCount: number;
  /** Variants whose stock was never recorded. `UNKNOWN` is a real state. */
  variantsWithUnknownStock: number;
  /** Variants carrying no structured attributes to match on. */
  variantsWithoutAttributes: number;
  /** How many relationships point out of this product (cross-sell reach). */
  outgoingRelationshipCount: number;
}

export interface ScannedOpportunity {
  category: ScannedOpportunityCategory;
  /** The observed fact. Always checkable against the catalogue. */
  signal: string;
  /** What the merchant could do about it. */
  recommendation: string;
  productId: string | null;
}

/** A category this thin cannot support a credible cross-sell. */
const THIN_CATEGORY_THRESHOLD = 2;

export function scanCatalogueForOpportunities(products: ScanProduct[]): ScannedOpportunity[] {
  const opportunities: ScannedOpportunity[] = [];
  if (products.length === 0) return opportunities;

  const categoryCounts = new Map<string, number>();
  for (const product of products) {
    categoryCounts.set(product.category, (categoryCounts.get(product.category) ?? 0) + 1);
  }

  for (const product of products) {
    // Unbuyable: an agent can discover it and can never transact on it.
    if (product.buyableVariantCount === 0) {
      opportunities.push({
        category: "CATALOG_GAP",
        productId: product.productId,
        signal: `"${product.name}" has no active, priced variant.`,
        recommendation: "Add a price and activate at least one variant, or archive the product so agents stop surfacing it.",
      });
      continue;
    }

    // No relationships means the Merchant Agent has nothing to propose here.
    if (product.outgoingRelationshipCount === 0) {
      opportunities.push({
        category: "CROSS_SELL",
        productId: product.productId,
        signal: `"${product.name}" has no related products recorded, so no cross-sell can be proposed on it.`,
        recommendation: "Link a complementary product so a buyer selecting this one can be offered a genuine add-on.",
      });
    }

    if (product.variantsWithUnknownStock > 0) {
      opportunities.push({
        category: "READINESS_GAP",
        productId: product.productId,
        signal: `${product.variantsWithUnknownStock} variant${product.variantsWithUnknownStock === 1 ? "" : "s"} of "${product.name}" ${product.variantsWithUnknownStock === 1 ? "has" : "have"} no recorded stock.`,
        recommendation: "Record inventory for these variants — an agent will not commit to stock nobody has stated.",
      });
    }

    if (product.variantsWithoutAttributes > 0) {
      opportunities.push({
        category: "READINESS_GAP",
        productId: product.productId,
        signal: `${product.variantsWithoutAttributes} variant${product.variantsWithoutAttributes === 1 ? "" : "s"} of "${product.name}" ${product.variantsWithoutAttributes === 1 ? "carries" : "carry"} no structured attributes.`,
        recommendation: "Add size/colour attributes so an agent can match this against a buyer's stated requirements.",
      });
    }
  }

  for (const [category, count] of categoryCounts) {
    if (count < THIN_CATEGORY_THRESHOLD) {
      opportunities.push({
        category: "UPSELL",
        productId: null,
        signal: `"${category}" contains only ${count} product, so there is nothing to upsell within it.`,
        recommendation: "Add at least one higher-tier option so the agent can propose a genuine upgrade rather than a substitute.",
      });
    }
  }

  return opportunities;
}
