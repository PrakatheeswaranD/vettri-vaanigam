/**
 * Catalogue gaps, per product, with the merchant's own vocabulary as the
 * suggestion.
 *
 * WHY A COUNT WAS NOT ENOUGH
 *
 * The console could already say "12 products lack structured attributes".
 * A merchant reading that has learned a number and nothing they can act
 * on: not which twelve, and not what an attribute on those products is
 * supposed to look like. The count is a diagnosis with no prescription.
 *
 * WHY THIS IS NOT THE AI PROPOSING PRODUCT FACTS
 *
 * The one thing an agent must never do to a catalogue is invent a fact —
 * a size, a stock level, a policy. So the suggestion here is not generated
 * at all. It is the attribute vocabulary the merchant's OWN products in
 * the SAME category already use, counted and ranked by how many products
 * use each key.
 *
 * "Products in Running Shoes use size, color, surface and cushioning;
 * these twelve have none" is a statement about the merchant's catalogue,
 * checkable against it, and true whether or not a model was involved —
 * which is exactly the standard the rest of this codebase holds itself to.
 *
 * The agent can therefore say precisely what is missing and what shape the
 * answer takes. It still cannot supply the answer, because only the
 * merchant knows whether that shoe is a UK9.
 */
import type { PrismaClient } from "@prisma/client";
import type { CatalogGapReportDTO, CatalogGapDTO } from "@razorgrowth/contracts";
import { analyzeCatalog } from "./quality-analyzer.js";

/** How many products to name per gap. Enough to start work; the count is
 * always the true total, so a merchant is never told a capped list is
 * everything. */
const MAX_NAMED_PRODUCTS = 25;

/** A key used by fewer than this share of a category's products is that
 * category's exception, not its convention, and suggesting it as one
 * would send a merchant to fill in a field their catalogue does not
 * actually use. */
const CONVENTION_THRESHOLD_BPS = 3_000;

interface Gap {
  code: CatalogGapDTO["code"];
  title: string;
  why: string;
  fix: string;
  matches: (evidence: {
    variantsWithNonEmptyAttributes: number;
    activeVariantCount: number;
    variantsWithKnownInventory: number;
    hasReturnPolicy: boolean;
    hasShippingPolicy: boolean;
    hasMeaningfulDescription: boolean;
    purchasableVariantCount: number;
    attributeKeysConsistentAcrossVariants: boolean;
  }) => boolean;
}

/**
 * Ordered by what blocks an AI buyer hardest.
 *
 * A product with no price cannot be bought at all; one with a thin
 * description merely ranks badly. Presenting those at equal weight is how
 * a merchant spends an afternoon on copy while their catalogue stays
 * untransactable.
 */
const GAPS: readonly Gap[] = [
  {
    code: "NO_PURCHASABLE_VARIANT",
    title: "No variant an agent can actually buy",
    why: "Every variant is inactive, unpriced, or out of stock. An agent can discover this product and can never complete a purchase of it.",
    fix: "Activate and price at least one variant, or archive the product so agents stop surfacing something unbuyable.",
    matches: (e) => e.purchasableVariantCount === 0,
  },
  {
    code: "MISSING_ATTRIBUTES",
    title: "No structured attributes to match against",
    why: "A buyer asking for a specific size or colour cannot be matched to this product, because no variant states one. It will be skipped for every constrained search.",
    fix: "Add the attribute keys the rest of this category already uses to each active variant.",
    matches: (e) => e.activeVariantCount > 0 && e.variantsWithNonEmptyAttributes === 0,
  },
  {
    code: "INCONSISTENT_ATTRIBUTES",
    title: "Variants describe themselves differently",
    why: "Some variants carry attribute keys others do not, so a filter that matches one variant silently misses its siblings.",
    fix: "Use the same attribute keys across every active variant of this product.",
    matches: (e) => e.activeVariantCount > 1 && e.variantsWithNonEmptyAttributes > 0 && !e.attributeKeysConsistentAcrossVariants,
  },
  {
    code: "UNKNOWN_INVENTORY",
    title: "Stock was never recorded",
    why: "Unknown is not zero and it is not available — an agent will not commit to stock nobody has stated, so this product is skipped rather than sold.",
    fix: "Record an inventory quantity for every active variant, even if that quantity is zero.",
    matches: (e) => e.activeVariantCount > 0 && e.variantsWithKnownInventory < e.activeVariantCount,
  },
  {
    code: "MISSING_RETURN_POLICY",
    title: "No return policy stated",
    why: "A buyer agent acting for someone else is far less likely to commit spend where the returns position is unstated.",
    fix: "Add a one-line return summary to this product.",
    matches: (e) => !e.hasReturnPolicy,
  },
  {
    code: "MISSING_SHIPPING_POLICY",
    title: "No shipping or fulfilment information",
    why: "Delivery expectation is part of the purchase decision, and absent means unknown rather than fast.",
    fix: "Add a one-line shipping summary to this product.",
    matches: (e) => !e.hasShippingPolicy,
  },
  {
    code: "THIN_DESCRIPTION",
    title: "Description too thin to reason about",
    why: "There is not enough text for a model to tell what this product is for, so it matches poorly against a described need.",
    fix: "Describe what the product is for, not only what it is.",
    matches: (e) => !e.hasMeaningfulDescription,
  },
];

export async function getCatalogGapReport(prisma: PrismaClient, merchantId: string): Promise<CatalogGapReportDTO> {
  // Reuses the analyzer that already reads every active product, variant
  // and inventory row exactly once. A second traversal would be a second
  // opinion about the same catalogue.
  const evidence = await analyzeCatalog(prisma, merchantId);

  /**
   * The attribute vocabulary each category actually uses, from the
   * merchant's own products. This is the entire "suggestion" mechanism —
   * no model, no external taxonomy, nothing invented.
   */
  const variants = await prisma.productVariant.findMany({
    where: { active: true, product: { merchantId, status: "ACTIVE" } },
    select: { attributes: true, product: { select: { category: true } } },
  });

  const keysByCategory = new Map<string, Map<string, number>>();
  const productsByCategory = new Map<string, number>();
  for (const variant of variants) {
    const category = variant.product.category;
    productsByCategory.set(category, (productsByCategory.get(category) ?? 0) + 1);
    const keys = keysByCategory.get(category) ?? new Map<string, number>();
    for (const key of Object.keys((variant.attributes as Record<string, unknown> | null) ?? {})) {
      keys.set(key, (keys.get(key) ?? 0) + 1);
    }
    keysByCategory.set(category, keys);
  }

  function conventionFor(category: string): string[] {
    const keys = keysByCategory.get(category);
    const total = productsByCategory.get(category) ?? 0;
    if (!keys || total === 0) return [];
    return [...keys.entries()]
      .filter(([, count]) => Math.round((count * 10_000) / total) >= CONVENTION_THRESHOLD_BPS)
      .sort((a, b) => b[1] - a[1])
      .map(([key]) => key);
  }

  const gaps: CatalogGapDTO[] = [];
  for (const gap of GAPS) {
    const affected = evidence.perProduct.filter((product) => gap.matches(product));
    if (affected.length === 0) continue;

    // The convention is only meaningful for attribute-shaped gaps, and
    // only from categories that actually have one.
    const categories = [...new Set(affected.map((p) => p.category))];
    const convention =
      gap.code === "MISSING_ATTRIBUTES" || gap.code === "INCONSISTENT_ATTRIBUTES"
        ? [...new Set(categories.flatMap(conventionFor))]
        : [];

    gaps.push({
      code: gap.code,
      title: gap.title,
      why: gap.why,
      fix: gap.fix,
      affectedCount: affected.length,
      // The count above is the truth; this list is a starting point.
      products: affected.slice(0, MAX_NAMED_PRODUCTS).map((p) => ({
        productId: p.productId,
        name: p.name,
        category: p.category,
      })),
      /** The merchant's own keys, from their own catalogue. Empty when the
       * category has no established convention to point at — in which case
       * the agent says what is missing without pretending to know its
       * shape. */
      suggestedAttributeKeys: convention,
    });
  }

  return {
    activeProducts: evidence.perProduct.length,
    // Products with no gap at all. The number a merchant is actually
    // trying to move, and the only one that means "an agent can buy this
    // without qualification".
    fullyReadyProducts: evidence.perProduct.filter((product) => !GAPS.some((gap) => gap.matches(product))).length,
    gaps,
    generatedAt: new Date().toISOString(),
  };
}
