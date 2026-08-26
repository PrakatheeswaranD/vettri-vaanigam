/**
 * Per-product candidate evaluation (PART 03 §12-§15, §30-§34).
 *
 * A product can have several variants (sizes/colors); the buyer's hard
 * constraints are really per-VARIANT (a size-8 variant might be eligible
 * while a size-9 variant of the same product isn't). This picks, per
 * product, the single best representative variant — the cheapest exactly
 * eligible one, or (failing that) the closest-to-budget near-match one —
 * using only the pure deterministic domain functions. It never calls an
 * AI model.
 */
import type { AgentReadableProductDTO, AgentVariantDTO } from "@razorgrowth/contracts";
import {
  evaluateEligibility,
  isNearMatchEligible,
  violatesExclusion,
  type BuyerIntent,
  type ConstraintViolation,
  type EligibilityCandidate,
} from "@razorgrowth/domain";

export interface EvaluatedCandidate {
  product: AgentReadableProductDTO;
  representativeVariantId: string;
  matchType: "EXACT" | "NEAR_MATCH";
  violations: ConstraintViolation[];
  priceMinor: number;
  availabilityState: string;
  attributes: Record<string, string>;
}

function lowercaseAttrs(attrs: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(attrs).map(([k, v]) => [k.toLowerCase(), v.toLowerCase()]));
}

function toEligibilityCandidate(productId: string, variant: AgentVariantDTO): EligibilityCandidate {
  return {
    productId,
    priceMinor: variant.price.amountMinor,
    availabilityState: variant.availability.state,
    attributes: lowercaseAttrs(variant.attributes),
  };
}

function budgetDifference(violations: ConstraintViolation[]): number {
  return violations.find((v) => v.type === "BUDGET_MAX")?.differenceMinor ?? Number.POSITIVE_INFINITY;
}

export function evaluateProduct(product: AgentReadableProductDTO, intent: BuyerIntent): EvaluatedCandidate | null {
  const activeVariants = product.variants.filter((v) => v.active);

  let bestExactVariant: AgentVariantDTO | null = null;
  let bestNear: { variant: AgentVariantDTO; violations: ConstraintViolation[] } | null = null;

  for (const variant of activeVariants) {
    const eligibilityCandidate = toEligibilityCandidate(product.productId, variant);
    if (violatesExclusion(eligibilityCandidate, intent)) continue;

    const { eligible, violations } = evaluateEligibility(eligibilityCandidate, intent);
    if (eligible) {
      if (!bestExactVariant || variant.price.amountMinor < bestExactVariant.price.amountMinor) {
        bestExactVariant = variant;
      }
      continue;
    }

    if (isNearMatchEligible(violations) && budgetDifference(violations) < budgetDifference(bestNear?.violations ?? [])) {
      bestNear = { variant, violations };
    }
  }

  if (bestExactVariant) {
    return {
      product,
      representativeVariantId: bestExactVariant.variantId,
      matchType: "EXACT",
      violations: [],
      priceMinor: bestExactVariant.price.amountMinor,
      availabilityState: bestExactVariant.availability.state,
      attributes: bestExactVariant.attributes,
    };
  }
  if (bestNear) {
    return {
      product,
      representativeVariantId: bestNear.variant.variantId,
      matchType: "NEAR_MATCH",
      violations: bestNear.violations,
      priceMinor: bestNear.variant.price.amountMinor,
      availabilityState: bestNear.variant.availability.state,
      attributes: bestNear.variant.attributes,
    };
  }
  return null;
}

export interface EvaluatedCandidateSet {
  exact: EvaluatedCandidate[];
  nearMatch: EvaluatedCandidate[];
}

export function evaluateCandidates(products: AgentReadableProductDTO[], intent: BuyerIntent): EvaluatedCandidateSet {
  const exact: EvaluatedCandidate[] = [];
  const nearMatch: EvaluatedCandidate[] = [];
  for (const product of products) {
    const evaluated = evaluateProduct(product, intent);
    if (!evaluated) continue;
    if (evaluated.matchType === "EXACT") exact.push(evaluated);
    else nearMatch.push(evaluated);
  }
  return { exact, nearMatch };
}
