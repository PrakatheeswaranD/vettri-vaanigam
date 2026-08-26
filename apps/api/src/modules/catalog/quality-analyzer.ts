/**
 * CatalogQualityAnalyzer (PART 02 §45, §46).
 *
 * Reads active products/variants/inventory ONCE (PART 02 §72-§74 — no
 * N+1, no per-card recomputation) and produces deterministic evidence.
 * `AgenticReadinessEngine` turns this evidence into scores; this module
 * never scores anything itself — it only measures. Evidence-first:
 * DATA → EVIDENCE → (elsewhere) RULES → SCORE → EXPLANATION (PART 02 §46).
 */
import type { PrismaClient } from "@prisma/client";
import {
  deriveAvailabilityState,
  deriveProductReadiness,
  hoursBetween,
  isPurchasable,
  knownStatusOf,
  systemClock,
  type Clock,
  type ProductReadinessResult,
} from "@razorgrowth/domain";

const MIN_MEANINGFUL_DESCRIPTION_LENGTH = 20;
const RICH_DESCRIPTION_LENGTH = 60;

export interface ProductEvidence {
  productId: string;
  name: string;
  category: string;
  activeVariantCount: number;
  purchasableVariantCount: number;
  variantsWithKnownInventory: number;
  variantsWithNonEmptyAttributes: number;
  attributeKeysConsistentAcrossVariants: boolean;
  skusUniqueWithinProduct: boolean;
  hasMeaningfulDescription: boolean;
  hasRichDescription: boolean;
  hasReturnPolicy: boolean;
  hasShippingPolicy: boolean;
  promotionEligibilityKnown: boolean;
  avgPriceFreshnessAgeHours: number;
  avgInventoryFreshnessAgeHours: number | null;
  readiness: ProductReadinessResult;
}

export interface CatalogEvidence {
  activeProductCount: number;
  activeVariantCount: number;
  purchasableProductCount: number;
  productsMissingReturnPolicy: number;
  productsMissingShippingPolicy: number;
  productsWithUnknownPromotionEligibility: number;
  variantsWithUnknownInventory: number;
  agentReadyProductCount: number;
  partiallyReadyProductCount: number;
  notReadyProductCount: number;
  perProduct: ProductEvidence[];
}

export type ProductWithRelations = Awaited<ReturnType<typeof loadActiveProducts>>[number];

async function loadActiveProducts(prisma: PrismaClient, merchantId: string) {
  return prisma.product.findMany({
    where: { merchantId, status: "ACTIVE" },
    include: { variants: { include: { inventory: true } } },
  });
}

export function analyzeProduct(product: ProductWithRelations, clock: Clock): ProductEvidence {
  const now = clock.now();
  const activeVariants = product.variants.filter((v) => v.active);

  const availabilityStates = activeVariants.map((v) =>
    deriveAvailabilityState(v.inventory?.availableQuantity ?? null, v.active),
  );
  const purchasableVariantCount = availabilityStates.filter(isPurchasable).length;
  const variantsWithKnownInventory = activeVariants.filter((v) => v.inventory !== null).length;
  const variantsWithNonEmptyAttributes = activeVariants.filter(
    (v) => Object.keys((v.attributes as Record<string, string>) ?? {}).length > 0,
  ).length;

  const attributeKeySets = activeVariants.map((v) =>
    Object.keys((v.attributes as Record<string, string>) ?? {})
      .sort()
      .join(","),
  );
  const attributeKeysConsistentAcrossVariants =
    attributeKeySets.length === 0 || new Set(attributeKeySets).size === 1;

  const skus = activeVariants.map((v) => v.sku);
  const skusUniqueWithinProduct = new Set(skus).size === skus.length;

  const priceAges = activeVariants.map((v) => hoursBetween(v.priceUpdatedAt, now));
  const avgPriceFreshnessAgeHours =
    priceAges.length > 0 ? priceAges.reduce((a, b) => a + b, 0) / priceAges.length : Number.POSITIVE_INFINITY;

  const inventoryAges = activeVariants
    .filter((v) => v.inventory !== null)
    .map((v) => hoursBetween(v.inventory!.updatedAt, now));
  const avgInventoryFreshnessAgeHours =
    inventoryAges.length > 0 ? inventoryAges.reduce((a, b) => a + b, 0) / inventoryAges.length : null;

  const descriptionLength = product.description.trim().length;
  const hasReturnPolicy = knownStatusOf(product.returnPolicySummary) === "KNOWN";
  const hasShippingPolicy = knownStatusOf(product.shippingSummary) === "KNOWN";

  const readiness = deriveProductReadiness({
    hasActivePurchasableVariant: purchasableVariantCount > 0,
    hasValidPriceAndCurrency: activeVariants.every((v) => v.priceMinor > 0),
    hasKnownAvailability: activeVariants.length > 0 && variantsWithKnownInventory === activeVariants.length,
    hasReturnPolicy,
    hasShippingPolicy,
    hasCategory: product.category.trim().length > 0,
    hasStructuredAttributes: variantsWithNonEmptyAttributes === activeVariants.length && activeVariants.length > 0,
  });

  return {
    productId: product.id,
    name: product.name,
    category: product.category,
    activeVariantCount: activeVariants.length,
    purchasableVariantCount,
    variantsWithKnownInventory,
    variantsWithNonEmptyAttributes,
    attributeKeysConsistentAcrossVariants,
    skusUniqueWithinProduct,
    hasMeaningfulDescription: descriptionLength >= MIN_MEANINGFUL_DESCRIPTION_LENGTH,
    hasRichDescription: descriptionLength >= RICH_DESCRIPTION_LENGTH,
    hasReturnPolicy,
    hasShippingPolicy,
    promotionEligibilityKnown: product.promotionEligibility !== "UNKNOWN",
    avgPriceFreshnessAgeHours,
    avgInventoryFreshnessAgeHours,
    readiness,
  };
}

export async function analyzeCatalog(
  prisma: PrismaClient,
  merchantId: string,
  clock: Clock = systemClock,
): Promise<CatalogEvidence> {
  const products = await loadActiveProducts(prisma, merchantId);
  const perProduct = products.map((p) => analyzeProduct(p, clock));

  const activeVariantCount = perProduct.reduce((sum, p) => sum + p.activeVariantCount, 0);
  const purchasableProductCount = perProduct.filter((p) => p.purchasableVariantCount > 0).length;
  const variantsWithUnknownInventory = perProduct.reduce(
    (sum, p) => sum + (p.activeVariantCount - p.variantsWithKnownInventory),
    0,
  );

  return {
    activeProductCount: perProduct.length,
    activeVariantCount,
    purchasableProductCount,
    productsMissingReturnPolicy: perProduct.filter((p) => !p.hasReturnPolicy).length,
    productsMissingShippingPolicy: perProduct.filter((p) => !p.hasShippingPolicy).length,
    productsWithUnknownPromotionEligibility: perProduct.filter((p) => !p.promotionEligibilityKnown).length,
    variantsWithUnknownInventory,
    agentReadyProductCount: perProduct.filter((p) => p.readiness.state === "AGENT_READY").length,
    partiallyReadyProductCount: perProduct.filter((p) => p.readiness.state === "PARTIALLY_READY").length,
    notReadyProductCount: perProduct.filter((p) => p.readiness.state === "NOT_READY").length,
    perProduct,
  };
}
