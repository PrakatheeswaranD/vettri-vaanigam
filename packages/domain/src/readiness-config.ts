/**
 * Centralized Agentic Readiness configuration (PART 02 §33, §36, §50,
 * §117). Every weight, threshold, and version constant used anywhere in
 * the readiness calculation lives here — never duplicated in the API,
 * frontend, seed script, or tests. The frontend imports the display
 * constants (dimension labels/order, level thresholds) but never
 * recomputes an authoritative score (PART 02 §118) — only the backend
 * `AgenticReadinessEngine` performs the weighted calculation.
 */
import type { ReadinessDimension } from "./readiness.js";

/** Bump this whenever the scoring formula, weights, or dimension set
 * changes, so a stored snapshot's score is never misread against a
 * different formula version (PART 02 §50). */
export const READINESS_MODEL_VERSION = "2.0";

/**
 * Dimension weights, summing to exactly 100. Rationale (PART 02 §33):
 * `catalogCompleteness` and `checkoutReadiness` are weighted highest
 * because they gate whether a transaction is possible at all.
 * `inventoryReliability` and `policyCompleteness` are next because an AI
 * buyer needs both to safely commit to a purchase. `priceFreshness`
 * matters because a stale price risks quoting the buyer a wrong amount.
 * `paymentReliability`, `aiDiscoverability`, `metadataQuality`, and
 * `trustInformation` improve optimization/trust but don't individually
 * block a transaction the way the others can.
 */
export const READINESS_WEIGHTS: Record<ReadinessDimension, number> = {
  catalogCompleteness: 15,
  checkoutReadiness: 15,
  inventoryReliability: 13,
  policyCompleteness: 12,
  priceFreshness: 12,
  paymentReliability: 10,
  aiDiscoverability: 10,
  metadataQuality: 8,
  trustInformation: 5,
};

export const READINESS_WEIGHT_TOTAL = 100;

/** Merchant-level readiness level thresholds (PART 02 §36). */
export const READINESS_LEVELS = ["AGENT_READY", "NEARLY_READY", "PARTIALLY_READY", "NOT_READY"] as const;
export type ReadinessLevel = (typeof READINESS_LEVELS)[number];

export interface ReadinessLevelThreshold {
  level: ReadinessLevel;
  minScore: number;
}

/** Ordered highest → lowest; `deriveReadinessLevel` picks the first
 * threshold the score meets or exceeds. */
export const READINESS_LEVEL_THRESHOLDS: readonly ReadinessLevelThreshold[] = [
  { level: "AGENT_READY", minScore: 90 },
  { level: "NEARLY_READY", minScore: 75 },
  { level: "PARTIALLY_READY", minScore: 50 },
  { level: "NOT_READY", minScore: 0 },
];

export function deriveReadinessLevel(overallScore: number): ReadinessLevel {
  for (const threshold of READINESS_LEVEL_THRESHOLDS) {
    if (overallScore >= threshold.minScore) return threshold.level;
  }
  return "NOT_READY";
}

/** Price-freshness age bands (PART 02 §21), in hours, mapped to a score.
 * Documented and centralized rather than randomly assigned. */
export interface FreshnessBand {
  maxAgeHours: number;
  score: number;
}

export const PRICE_FRESHNESS_BANDS: readonly FreshnessBand[] = [
  { maxAgeHours: 24, score: 100 },
  { maxAgeHours: 72, score: 90 },
  { maxAgeHours: 24 * 7, score: 75 },
  { maxAgeHours: 24 * 30, score: 55 },
  { maxAgeHours: Number.POSITIVE_INFINITY, score: 35 },
];

export function scoreFreshnessByAge(ageHours: number): number {
  for (const band of PRICE_FRESHNESS_BANDS) {
    if (ageHours <= band.maxAgeHours) return band.score;
  }
  return PRICE_FRESHNESS_BANDS[PRICE_FRESHNESS_BANDS.length - 1]!.score;
}

/**
 * Critical-cap rule (PART 02 §34): a merchant that cannot actually
 * transact must never show a misleadingly high score, no matter how
 * complete its metadata is elsewhere.
 */
export const CRITICAL_CAP_NO_VARIANTS = 0; // no active variants exist at all
export const CRITICAL_CAP_NO_PURCHASABLE_PRODUCT = 20; // variants exist, but none are purchasable (priced + available)

export function applyCriticalCap(
  overallScore: number,
  evidence: { activeVariantCount: number; purchasableProductCount: number },
): number {
  if (evidence.activeVariantCount === 0) {
    return Math.min(overallScore, CRITICAL_CAP_NO_VARIANTS);
  }
  if (evidence.purchasableProductCount === 0) {
    return Math.min(overallScore, CRITICAL_CAP_NO_PURCHASABLE_PRODUCT);
  }
  return overallScore;
}
