/**
 * Agentic Readiness Score domain rules (PART 00 §18; PART 01 §18, §80;
 * PART 02 §24-§33).
 *
 * The score and its explanations MUST be deterministic — never generated
 * by an LLM. This module holds the dimension list, weighted scoring, and
 * the deterministic improvement-recommendation rules. Actual per-merchant
 * metric calculation (e.g. "what % of products are missing return-policy
 * data") is an application-service concern
 * (`apps/api` `CatalogQualityAnalyzer` / `AgenticReadinessEngine`) that
 * reads real catalog/order data; this module only encodes the scoring
 * dimensions, weights, and rule → recommendation mapping so they are
 * independently testable and centralized (PART 02 §117) rather than
 * duplicated across backend, frontend, and seed code.
 */
import { READINESS_WEIGHTS, READINESS_WEIGHT_TOTAL } from "./readiness-config.js";

export const READINESS_DIMENSIONS = [
  "catalogCompleteness",
  "aiDiscoverability",
  "priceFreshness",
  "inventoryReliability",
  "policyCompleteness",
  "checkoutReadiness",
  "paymentReliability",
  "metadataQuality",
  "trustInformation",
] as const;

export type ReadinessDimension = (typeof READINESS_DIMENSIONS)[number];

export const READINESS_DIMENSION_LABEL: Record<ReadinessDimension, string> = {
  catalogCompleteness: "Catalog Completeness",
  aiDiscoverability: "AI Discoverability",
  priceFreshness: "Price Freshness",
  inventoryReliability: "Inventory Reliability",
  policyCompleteness: "Policy Completeness",
  checkoutReadiness: "Checkout Readiness",
  paymentReliability: "Payment Reliability",
  metadataQuality: "Metadata Quality",
  trustInformation: "Trust Information",
};

export type ReadinessDimensionScores = Record<ReadinessDimension, number>;

export interface WeakestDimension {
  dimension: ReadinessDimension;
  score: number;
}

/**
 * Identify the single largest readiness gap (lowest-scoring dimension).
 * Ties resolve to the first dimension in `READINESS_DIMENSIONS` order, so
 * the result is deterministic and reproducible for identical input.
 */
export function findWeakestDimension(scores: ReadinessDimensionScores): WeakestDimension {
  let weakest: WeakestDimension = {
    dimension: READINESS_DIMENSIONS[0],
    score: scores[READINESS_DIMENSIONS[0]],
  };
  for (const dimension of READINESS_DIMENSIONS) {
    const score = scores[dimension];
    if (score < weakest.score) {
      weakest = { dimension, score };
    }
  }
  return weakest;
}

export function findStrongestDimension(scores: ReadinessDimensionScores): WeakestDimension {
  let strongest: WeakestDimension = {
    dimension: READINESS_DIMENSIONS[0],
    score: scores[READINESS_DIMENSIONS[0]],
  };
  for (const dimension of READINESS_DIMENSIONS) {
    const score = scores[dimension];
    if (score > strongest.score) {
      strongest = { dimension, score };
    }
  }
  return strongest;
}

/** Simple unweighted mean — used only where no weighting scheme applies
 * (e.g. tests, or a future dimension set without a documented weight
 * rationale yet). The authoritative merchant score MUST use
 * `computeWeightedOverallScore` with `READINESS_WEIGHTS` (PART 02 §33). */
export function computeOverallScore(scores: ReadinessDimensionScores): number {
  const sum = READINESS_DIMENSIONS.reduce((acc, dimension) => acc + scores[dimension], 0);
  return Math.round(sum / READINESS_DIMENSIONS.length);
}

/**
 * Authoritative weighted overall score (PART 02 §33, §117). Weights are
 * centralized in `readiness-config.ts` and validated (by
 * `assertValidWeights`) to sum to `READINESS_WEIGHT_TOTAL` — this
 * function does not itself renormalize, so a corrupted weight table
 * fails loudly via the weight-sum test rather than silently skewing
 * every score.
 */
export function computeWeightedOverallScore(
  scores: ReadinessDimensionScores,
  weights: Record<ReadinessDimension, number> = READINESS_WEIGHTS,
): number {
  const weightedSum = READINESS_DIMENSIONS.reduce((acc, dimension) => acc + scores[dimension] * weights[dimension], 0);
  return Math.round(weightedSum / READINESS_WEIGHT_TOTAL);
}

/** Invariant check (PART 02 §116) — call from a test, not at runtime on
 * every request, to catch an accidentally corrupted weight table. */
export function assertValidWeights(weights: Record<ReadinessDimension, number> = READINESS_WEIGHTS): void {
  const sum = READINESS_DIMENSIONS.reduce((acc, dimension) => acc + weights[dimension], 0);
  if (sum !== READINESS_WEIGHT_TOTAL) {
    throw new Error(`Readiness weights must sum to ${READINESS_WEIGHT_TOTAL}, got ${sum}`);
  }
}

/**
 * Deterministic recommendation rule: below `threshold` on `dimension`
 * yields `recommendation`. PART 00 §80 — deterministic logic is preferred
 * over an LLM call when deterministic logic is sufficient. No AI is
 * involved anywhere in this module.
 */
export interface ReadinessRule {
  dimension: ReadinessDimension;
  threshold: number;
  recommendation: string;
}

export const READINESS_RULES: readonly ReadinessRule[] = [
  {
    dimension: "catalogCompleteness",
    threshold: 80,
    recommendation:
      "Complete missing structured product attributes (category, brand, description) so AI buyers can reliably match products to intent.",
  },
  {
    dimension: "aiDiscoverability",
    threshold: 80,
    recommendation:
      "Add richer structured metadata (attributes, use-case tags) to more variants so AI buyers can discover them for relevant queries.",
  },
  {
    dimension: "priceFreshness",
    threshold: 80,
    recommendation: "Review and refresh variant pricing so AI buyers are never quoted a stale price.",
  },
  {
    dimension: "inventoryReliability",
    threshold: 80,
    recommendation: "Improve inventory-count freshness for agent-visible variants to avoid proposing unavailable products.",
  },
  {
    dimension: "policyCompleteness",
    threshold: 80,
    recommendation: "Add structured shipping and return-policy information to more products.",
  },
  {
    dimension: "checkoutReadiness",
    threshold: 80,
    recommendation: "Ensure all active variants have valid pricing and availability so checkout can be created without manual fixes.",
  },
  {
    dimension: "paymentReliability",
    threshold: 80,
    recommendation: "Investigate recent failed-payment patterns; a bounded recovery flow can recapture lost checkouts.",
  },
  {
    dimension: "metadataQuality",
    threshold: 80,
    recommendation: "Normalize duplicate/inconsistent attribute keys and fill in missing SKUs to improve metadata quality.",
  },
  {
    dimension: "trustInformation",
    threshold: 80,
    recommendation: "Publish clear, consistent returns and shipping information so AI buyers can evaluate transaction risk.",
  },
];

/**
 * Deterministically derive recommendations from real dimension scores.
 * Every dimension below its rule's threshold produces a recommendation;
 * dimensions at or above threshold produce none. Order matches
 * `READINESS_DIMENSIONS`, so output is reproducible for identical input.
 */
export function deriveReadinessRecommendations(scores: ReadinessDimensionScores): string[] {
  return READINESS_RULES.filter((rule) => scores[rule.dimension] < rule.threshold).map((rule) => rule.recommendation);
}
