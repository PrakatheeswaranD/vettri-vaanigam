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
  effectivePriceMinor,
  evaluateEligibility,
  isNearMatchEligible,
  violatesExclusion,
  type BuyerIntent,
  type ConstraintViolation,
  type AuthorizedOfferTerms,
  type EligibilityCandidate,
} from "@razorgrowth/domain";

export interface EvaluatedCandidate {
  product: AgentReadableProductDTO;
  representativeVariantId: string;
  matchType: "EXACT" | "NEAR_MATCH";
  violations: ConstraintViolation[];
  /** The variant's LIST price. Unchanged meaning — existing callers that
   * display a price still get the catalogue figure. */
  priceMinor: number;
  /**
   * What the buyer would actually pay, after any merchant-authorized
   * offer on this product.
   *
   * PART 18 — budget eligibility and ranking both compared LIST price, so
   * a product a governed discount brought inside the buyer's stated
   * budget was rejected as over-budget: the buyer lost something they
   * could afford, and the merchant lost the sale their own agent had
   * authorized the discount for. Equal to `priceMinor` when no offer
   * applies, which is the common case.
   */
  effectivePriceMinor: number;
  /** Zero when the buyer pays list. */
  offerDiscountMinor: number;
  availabilityState: string;
  attributes: Record<string, string>;
}

function lowercaseAttrs(attrs: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(attrs).map(([k, v]) => [k.toLowerCase(), v.toLowerCase()]));
}

function toEligibilityCandidate(
  productId: string,
  variant: AgentVariantDTO,
  offer: AuthorizedOfferTerms | null,
): EligibilityCandidate {
  return {
    productId,
    // The price the budget is really about. A violation message therefore
    // quotes what they would pay, not a figure no one would be charged.
    priceMinor: effectivePriceMinor(variant.price.amountMinor, offer),
    availabilityState: variant.availability.state,
    attributes: lowercaseAttrs(variant.attributes),
  };
}

function budgetDifference(violations: ConstraintViolation[]): number {
  return violations.find((v) => v.type === "BUDGET_MAX")?.differenceMinor ?? Number.POSITIVE_INFINITY;
}

export function evaluateProduct(
  product: AgentReadableProductDTO,
  intent: BuyerIntent,
  offer: AuthorizedOfferTerms | null = null,
): EvaluatedCandidate | null {
  const activeVariants = product.variants.filter((v) => v.active);
  const effective = (variant: AgentVariantDTO) => effectivePriceMinor(variant.price.amountMinor, offer);

  let bestExactVariant: AgentVariantDTO | null = null;
  let bestNear: { variant: AgentVariantDTO; violations: ConstraintViolation[] } | null = null;

  for (const variant of activeVariants) {
    const eligibilityCandidate = toEligibilityCandidate(product.productId, variant, offer);
    if (violatesExclusion(eligibilityCandidate, intent)) continue;

    const { eligible, violations } = evaluateEligibility(eligibilityCandidate, intent);
    if (eligible) {
      if (!bestExactVariant || effective(variant) < effective(bestExactVariant)) {
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
      effectivePriceMinor: effective(bestExactVariant),
      offerDiscountMinor: bestExactVariant.price.amountMinor - effective(bestExactVariant),
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
      effectivePriceMinor: effective(bestNear.variant),
      offerDiscountMinor: bestNear.variant.price.amountMinor - effective(bestNear.variant),
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

export function evaluateCandidates(
  products: AgentReadableProductDTO[],
  intent: BuyerIntent,
  /** Merchant-authorized offers, keyed by product id. Absent for callers
   * that have not resolved them; every candidate then evaluates at list
   * price, which is the pre-PART-18 behaviour. */
  offersByProductId: ReadonlyMap<string, AuthorizedOfferTerms> = new Map(),
): EvaluatedCandidateSet {
  const exact: EvaluatedCandidate[] = [];
  const nearMatch: EvaluatedCandidate[] = [];
  for (const product of products) {
    const evaluated = evaluateProduct(product, intent, offersByProductId.get(product.productId) ?? null);
    if (!evaluated) continue;
    if (evaluated.matchType === "EXACT") exact.push(evaluated);
    else nearMatch.push(evaluated);
  }
  return { exact, nearMatch };
}
