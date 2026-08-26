/**
 * Deterministic growth-offer arithmetic (PART 04 §18-§20, §34, §44-§45).
 *
 * The model never computes an authoritative discount or opportunity
 * amount — it may only request terms; this module is the ONLY place
 * those terms become an integer minor-unit calculation. Percentages are
 * represented as integer basis points (500 = 5%), never floats.
 */

export const BASIS_POINTS_DENOMINATOR = 10_000;

export interface OfferTerms {
  kind: "PERCENTAGE" | "FIXED_AMOUNT";
  percentageBps: number | null;
  amountMinor: number | null;
}

export interface OfferCalculation {
  baseAmountMinor: number;
  discountMinor: number;
  finalAmountMinor: number;
}

/**
 * Percentage discounts round DOWN (floor) — a computed discount can never
 * exceed what the configured basis points allow due to rounding, and the
 * discount is always clamped to `[0, baseAmountMinor]` so a proposal can
 * never make the final amount negative (PART 04 §100).
 */
export function calculateOffer(baseAmountMinor: number, offer: OfferTerms): OfferCalculation {
  const rawDiscount =
    offer.kind === "PERCENTAGE"
      ? Math.floor((baseAmountMinor * (offer.percentageBps ?? 0)) / BASIS_POINTS_DENOMINATOR)
      : (offer.amountMinor ?? 0);
  const discountMinor = Math.max(0, Math.min(rawDiscount, baseAmountMinor));
  return {
    baseAmountMinor,
    discountMinor,
    finalAmountMinor: baseAmountMinor - discountMinor,
  };
}

export interface OpportunityCalculation {
  currentBasketMinor: number;
  potentialBasketMinor: number;
  opportunityDeltaMinor: number;
}

/** PART 04 §45 — deterministic basket-opportunity arithmetic. This is a
 * potential upside if the proposal is accepted, never a claim of
 * realized revenue (PART 04 §44, §84). */
export function calculateOpportunity(currentBasketMinor: number, addedProductMinor: number): OpportunityCalculation {
  const potentialBasketMinor = currentBasketMinor + addedProductMinor;
  return {
    currentBasketMinor,
    potentialBasketMinor,
    opportunityDeltaMinor: potentialBasketMinor - currentBasketMinor,
  };
}
