/**
 * AgenticReadinessEngine (PART 02 §30-§50).
 *
 * Turns `CatalogEvidence` (+ policy/payment evidence) into a full
 * `ReadinessAssessment`: dimension scores, weighted overall score,
 * critical cap, level, blockers, strengths, and recommendations. Every
 * number here traces back to real evidence collected by
 * `CatalogQualityAnalyzer` — nothing is invented, and no LLM is called
 * anywhere in this file (PART 02 §31, NON-NEGOTIABLE).
 */
import type { PrismaClient } from "@prisma/client";
import {
  applyCriticalCap,
  computeWeightedOverallScore,
  deriveReadinessLevel,
  deriveReadinessRecommendations,
  findStrongestDimension,
  findWeakestDimension,
  prioritizeBlockers,
  READINESS_DIMENSION_LABEL,
  READINESS_MODEL_VERSION,
  scoreFreshnessByAge,
  systemClock,
  type Clock,
  type ReadinessBlocker,
  type ReadinessDimensionScores,
  type ReadinessLevel,
} from "@razorgrowth/domain";
import { analyzeCatalog, type CatalogEvidence } from "../catalog/quality-analyzer.js";

export interface ReadinessAssessment {
  overallScore: number;
  level: ReadinessLevel;
  dimensions: ReadinessDimensionScores;
  weakestDimension: string;
  strongestDimension: string;
  recommendations: string[];
  blockers: ReadinessBlocker[];
  strengths: string[];
  evidence: Record<string, number>;
  calculationVersion: string;
  isSyntheticDemo: boolean;
}

function pct(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Math.round((numerator / denominator) * 100);
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

async function getPaymentEvidence(prisma: PrismaClient, merchantId: string) {
  const [captured, failed] = await Promise.all([
    prisma.payment.count({ where: { order: { merchantId }, state: "CAPTURED" } }),
    prisma.payment.count({ where: { order: { merchantId }, state: "FAILED" } }),
  ]);
  return { captured, failed };
}

function scoreDimensions(
  catalog: CatalogEvidence,
  payment: { captured: number; failed: number },
): ReadinessDimensionScores {
  const { perProduct, activeProductCount } = catalog;

  const catalogCompleteness = average(
    perProduct.map((p) => {
      const checks = [
        p.category.trim().length > 0,
        p.hasMeaningfulDescription,
        p.activeVariantCount > 0,
        p.skusUniqueWithinProduct,
        p.variantsWithNonEmptyAttributes === p.activeVariantCount && p.activeVariantCount > 0,
      ];
      return pct(checks.filter(Boolean).length, checks.length);
    }),
  );

  const aiDiscoverability = average(
    perProduct.map((p) => {
      const checks = [
        p.category.trim().length > 0,
        p.variantsWithNonEmptyAttributes > 0,
        p.hasRichDescription,
        p.attributeKeysConsistentAcrossVariants,
      ];
      return pct(checks.filter(Boolean).length, checks.length);
    }),
  );

  const priceFreshness = average(perProduct.map((p) => scoreFreshnessByAge(p.avgPriceFreshnessAgeHours)));

  const inventoryReliability = average(
    perProduct.map((p) => {
      const knownRatio = pct(p.variantsWithKnownInventory, p.activeVariantCount);
      const freshnessScore =
        p.avgInventoryFreshnessAgeHours === null ? 0 : scoreFreshnessByAge(p.avgInventoryFreshnessAgeHours);
      return Math.round(knownRatio * 0.5 + freshnessScore * 0.5);
    }),
  );

  const policyCompleteness = average(
    perProduct.map((p) => {
      const checks = [p.hasReturnPolicy, p.hasShippingPolicy, p.promotionEligibilityKnown];
      return pct(checks.filter(Boolean).length, checks.length);
    }),
  );

  // Deliberately stricter than "has any purchasable variant"
  // (`purchasableProductCount`): a product with even one variant of
  // unknown availability or invalid pricing is NOT_READY (PART 02 §11),
  // and checkoutReadiness must reflect that same critical bar — otherwise
  // this dimension could score high while the CRITICAL
  // PRODUCTS_NOT_TRANSACTABLE blocker (below) reports real gaps,
  // contradicting each other (PART 02 §26 — honest, not decorative).
  const checkoutReadiness = pct(activeProductCount - catalog.notReadyProductCount, activeProductCount);

  const totalPaymentEvidence = payment.captured + payment.failed;
  const paymentReliability = totalPaymentEvidence === 0 ? 50 : pct(payment.captured, totalPaymentEvidence);

  const metadataQuality = average(
    perProduct.map((p) => {
      const checks = [
        p.skusUniqueWithinProduct,
        p.attributeKeysConsistentAcrossVariants,
        p.hasMeaningfulDescription,
        p.activeVariantCount > 0,
      ];
      return pct(checks.filter(Boolean).length, checks.length);
    }),
  );

  const trustInformation = average(
    perProduct.map((p) => {
      const checks = [
        p.hasReturnPolicy,
        p.hasShippingPolicy,
        p.avgPriceFreshnessAgeHours <= 24 * 30,
        p.avgInventoryFreshnessAgeHours !== null && p.avgInventoryFreshnessAgeHours <= 24 * 30,
      ];
      return pct(checks.filter(Boolean).length, checks.length);
    }),
  );

  return {
    catalogCompleteness,
    aiDiscoverability,
    priceFreshness,
    inventoryReliability,
    policyCompleteness,
    checkoutReadiness,
    paymentReliability,
    metadataQuality,
    trustInformation,
  };
}

function buildBlockers(catalog: CatalogEvidence, dimensions: ReadinessDimensionScores): ReadinessBlocker[] {
  const blockers: ReadinessBlocker[] = [];
  const total = catalog.activeProductCount;

  // PART 02 §115 — empty state must be a defensible, honest outcome, not
  // a divide-by-zero or a misleadingly "clean" score.
  if (total === 0) {
    return [
      {
        dimension: "checkoutReadiness",
        severity: "CRITICAL",
        code: "NO_ACTIVE_PRODUCTS",
        title: "No active products exist",
        explanation: "No active purchasable products are available for AI buyers to discover or transact with.",
        affectedCount: 0,
        totalCount: 0,
        remediation: "Publish at least one active product with a priced, available variant.",
      },
    ];
  }

  if (catalog.notReadyProductCount > 0) {
    blockers.push({
      dimension: "checkoutReadiness",
      severity: "CRITICAL",
      code: "PRODUCTS_NOT_TRANSACTABLE",
      title: "Products cannot currently be safely transacted",
      explanation: `${catalog.notReadyProductCount} of ${total} active products are missing a critical requirement (purchasable variant, valid price, or known availability).`,
      affectedCount: catalog.notReadyProductCount,
      totalCount: total,
      remediation: "Add a valid priced, available variant to each affected product.",
    });
  }

  if (catalog.variantsWithUnknownInventory > 0) {
    blockers.push({
      dimension: "inventoryReliability",
      severity: catalog.variantsWithUnknownInventory > catalog.activeVariantCount / 2 ? "HIGH" : "MEDIUM",
      code: "UNKNOWN_INVENTORY",
      title: "Inventory visibility is unknown for some variants",
      explanation: `${catalog.variantsWithUnknownInventory} of ${catalog.activeVariantCount} active variants have no recorded inventory count.`,
      affectedCount: catalog.variantsWithUnknownInventory,
      totalCount: catalog.activeVariantCount,
      remediation: "Update inventory visibility for active variants so AI buyers never guess at availability.",
    });
  }

  if (catalog.productsMissingReturnPolicy > 0) {
    blockers.push({
      dimension: "policyCompleteness",
      severity: "MEDIUM",
      code: "MISSING_RETURN_POLICY",
      title: "Return-policy information is missing",
      explanation: `${catalog.productsMissingReturnPolicy} of ${total} active products do not expose structured return-policy information.`,
      affectedCount: catalog.productsMissingReturnPolicy,
      totalCount: total,
      remediation: "Add structured return-policy information to the affected products.",
    });
  }

  if (catalog.productsMissingShippingPolicy > 0) {
    blockers.push({
      dimension: "policyCompleteness",
      severity: "MEDIUM",
      code: "MISSING_SHIPPING_POLICY",
      title: "Shipping information is missing",
      explanation: `${catalog.productsMissingShippingPolicy} of ${total} active products do not expose structured shipping information.`,
      affectedCount: catalog.productsMissingShippingPolicy,
      totalCount: total,
      remediation: "Add structured shipping information to the affected products.",
    });
  }

  const staleProducts = catalog.perProduct.filter((p) => p.avgPriceFreshnessAgeHours > 24 * 7).length;
  if (staleProducts > 0) {
    blockers.push({
      dimension: "priceFreshness",
      severity: "LOW",
      code: "STALE_PRICE_DATA",
      title: "Some pricing has not been refreshed recently",
      explanation: `${staleProducts} of ${total} active products have variants with pricing older than 7 days.`,
      affectedCount: staleProducts,
      totalCount: total,
      remediation: "Refresh pricing information for stale variants.",
    });
  }

  const lowAttributeProducts = catalog.perProduct.filter((p) => p.variantsWithNonEmptyAttributes === 0).length;
  if (lowAttributeProducts > 0) {
    blockers.push({
      dimension: "metadataQuality",
      severity: "LOW",
      code: "LOW_ATTRIBUTE_COVERAGE",
      title: "Structured attributes are missing",
      explanation: `${lowAttributeProducts} of ${total} active products have no structured variant attributes at all.`,
      affectedCount: lowAttributeProducts,
      totalCount: total,
      remediation: "Add structured attributes (size, color, material, etc.) for agent discovery.",
    });
  }

  if (catalog.productsWithUnknownPromotionEligibility > 0) {
    blockers.push({
      dimension: "policyCompleteness",
      severity: "LOW",
      code: "UNKNOWN_PROMOTION_ELIGIBILITY",
      title: "Promotion eligibility has not been decided",
      explanation: `${catalog.productsWithUnknownPromotionEligibility} of ${total} active products have not been marked eligible or ineligible for future promotions.`,
      affectedCount: catalog.productsWithUnknownPromotionEligibility,
      totalCount: total,
      remediation: "Explicitly mark each product's promotion eligibility instead of leaving it unknown.",
    });
  }

  void dimensions; // dimension scores available for future severity tuning
  return prioritizeBlockers(blockers);
}

function buildStrengths(dimensions: ReadinessDimensionScores): string[] {
  const label: Record<string, string> = {
    catalogCompleteness: "Catalog structure is well-formed across active products.",
    aiDiscoverability: "Products carry rich, structured metadata that supports AI discovery.",
    priceFreshness: "Pricing is kept current across active variants.",
    inventoryReliability: "Inventory visibility is reliable and current.",
    policyCompleteness: "Return, shipping, and promotion information is well documented.",
    checkoutReadiness: "Most active products have a purchasable, correctly priced variant.",
    paymentReliability: "Recent payment history shows a healthy capture rate.",
    metadataQuality: "Attribute keys and SKUs are consistent across variants.",
    trustInformation: "Commerce information is clear and current, supporting buyer trust.",
  };
  return Object.entries(dimensions)
    .filter(([, score]) => score >= 90)
    .map(([dimension]) => label[dimension] ?? `${dimension} is strong.`);
}

export async function runReadinessAssessment(
  prisma: PrismaClient,
  merchantId: string,
  clock: Clock = systemClock,
): Promise<ReadinessAssessment> {
  const [catalog, payment] = await Promise.all([
    analyzeCatalog(prisma, merchantId, clock),
    getPaymentEvidence(prisma, merchantId),
  ]);

  const dimensions = scoreDimensions(catalog, payment);
  const rawOverall = computeWeightedOverallScore(dimensions);
  const overallScore = applyCriticalCap(rawOverall, {
    activeVariantCount: catalog.activeVariantCount,
    purchasableProductCount: catalog.purchasableProductCount,
  });
  const level = deriveReadinessLevel(overallScore);
  const weakest = findWeakestDimension(dimensions);
  const strongest = findStrongestDimension(dimensions);
  const recommendations = deriveReadinessRecommendations(dimensions);
  const blockers = buildBlockers(catalog, dimensions);
  const strengths = buildStrengths(dimensions);

  return {
    overallScore,
    level,
    dimensions,
    weakestDimension: READINESS_DIMENSION_LABEL[weakest.dimension],
    strongestDimension: READINESS_DIMENSION_LABEL[strongest.dimension],
    recommendations,
    blockers,
    strengths,
    evidence: {
      activeProductCount: catalog.activeProductCount,
      activeVariantCount: catalog.activeVariantCount,
      purchasableProductCount: catalog.purchasableProductCount,
      agentReadyProductCount: catalog.agentReadyProductCount,
      partiallyReadyProductCount: catalog.partiallyReadyProductCount,
      notReadyProductCount: catalog.notReadyProductCount,
      productsMissingReturnPolicy: catalog.productsMissingReturnPolicy,
      productsMissingShippingPolicy: catalog.productsMissingShippingPolicy,
      variantsWithUnknownInventory: catalog.variantsWithUnknownInventory,
      paymentCaptured: payment.captured,
      paymentFailed: payment.failed,
    },
    calculationVersion: READINESS_MODEL_VERSION,
    isSyntheticDemo: true,
  };
}
