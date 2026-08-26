/**
 * Deterministic buyer-constraint eligibility (PART 03 §12-§15, §30-§34).
 *
 * This is the code the contract means by "the LLM does not decide whether
 * a ₹5,500 product is under ₹5,000 — code does" (§30). It never calls out
 * to a model: given a candidate and a normalized `BuyerIntent`, it always
 * returns the same violations for the same input.
 */
import type { AvailabilityState } from "./availability.js";
import { isPurchasable } from "./availability.js";
import type { BuyerIntent } from "./buyer-intent.js";

export const CONSTRAINT_VIOLATION_TYPES = ["BUDGET_MAX", "BUDGET_MIN", "REQUIRED_ATTRIBUTE", "AVAILABILITY"] as const;
export type ConstraintViolationType = (typeof CONSTRAINT_VIOLATION_TYPES)[number];

export interface ConstraintViolation {
  type: ConstraintViolationType;
  expected: string;
  actual: string;
  differenceMinor: number | null;
}

export interface EligibilityCandidate {
  productId: string;
  priceMinor: number;
  /** Best (most available) availability state across the product's
   * purchasable variants — PART 02's `AvailabilityState`. */
  availabilityState: AvailabilityState;
  /** Lower-cased attribute map (e.g. `{ size: "uk9", color: "black" }`) —
   * normalization to lower case happens once, at the catalog-gateway
   * boundary, not scattered across every comparison here. */
  attributes: Record<string, string>;
}

export interface EligibilityResult {
  eligible: boolean;
  /** True if any violation is an exclusion or a required-attribute
   * mismatch — these are NEVER eligible for near-match relaxation
   * (§33: "never silently relax an explicit exclusion"). Only a pure
   * BUDGET_MAX violation may become a disclosed near match. */
  violations: ConstraintViolation[];
}

function normalizedEquals(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Evaluate one candidate against the intent's HARD constraints only
 * (required attributes, budget, availability). Preferences never affect
 * eligibility (§14) — only ranking, elsewhere. */
export function evaluateEligibility(candidate: EligibilityCandidate, intent: BuyerIntent): EligibilityResult {
  const violations: ConstraintViolation[] = [];

  for (const [key, expectedValue] of Object.entries(intent.requiredAttributes)) {
    const actual = candidate.attributes[key.toLowerCase()];
    if (actual === undefined || !normalizedEquals(actual, expectedValue)) {
      violations.push({
        type: "REQUIRED_ATTRIBUTE",
        expected: `${key}=${expectedValue}`,
        actual: actual === undefined ? `${key}=unknown` : `${key}=${actual}`,
        differenceMinor: null,
      });
    }
  }

  if (intent.budget.maxMinor !== null && candidate.priceMinor > intent.budget.maxMinor) {
    violations.push({
      type: "BUDGET_MAX",
      expected: String(intent.budget.maxMinor),
      actual: String(candidate.priceMinor),
      differenceMinor: candidate.priceMinor - intent.budget.maxMinor,
    });
  }
  if (intent.budget.minMinor !== null && candidate.priceMinor < intent.budget.minMinor) {
    violations.push({
      type: "BUDGET_MIN",
      expected: String(intent.budget.minMinor),
      actual: String(candidate.priceMinor),
      differenceMinor: intent.budget.minMinor - candidate.priceMinor,
    });
  }

  if (intent.availabilityRequirement === "PURCHASABLE_ONLY" && !isPurchasable(candidate.availabilityState)) {
    violations.push({
      type: "AVAILABILITY",
      expected: "purchasable",
      actual: candidate.availabilityState,
      differenceMinor: null,
    });
  }

  return { eligible: violations.length === 0, violations };
}

/**
 * Explicit exclusions are a HARD, never-relaxable rule (§15, §33) —
 * checked separately from `evaluateEligibility` so a caller can never
 * accidentally route an excluded product into near-match relaxation.
 */
export function violatesExclusion(candidate: EligibilityCandidate, intent: BuyerIntent): boolean {
  for (const [key, excludedValues] of Object.entries(intent.excludedAttributes)) {
    const actual = candidate.attributes[key.toLowerCase()];
    if (actual !== undefined && excludedValues.some((v) => normalizedEquals(actual, v))) {
      return true;
    }
  }
  return false;
}
