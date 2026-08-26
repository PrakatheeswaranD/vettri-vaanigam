/**
 * Honest-uncertainty modeling (PART 02 §9).
 *
 * Applies to commerce metadata whose absence must never be silently
 * interpreted as a positive answer — e.g. a missing return policy must
 * not become "returns allowed", missing shipping info must not become
 * "ships nationwide".
 */
export const KNOWN_STATUSES = ["KNOWN", "UNKNOWN"] as const;
export type KnownStatus = (typeof KNOWN_STATUSES)[number];

export function knownStatusOf(value: string | null | undefined): KnownStatus {
  return value !== null && value !== undefined && value.trim().length > 0 ? "KNOWN" : "UNKNOWN";
}

/** PART 02 §57 — eligibility for a future offer is not itself an
 * authorization to discount; that remains the Policy Engine's job
 * (PART 05). This only records whether the merchant has marked the
 * product as a promotion candidate at all. */
export const PROMOTION_ELIGIBILITY_STATES = ["ELIGIBLE", "INELIGIBLE", "UNKNOWN"] as const;
export type PromotionEligibility = (typeof PROMOTION_ELIGIBILITY_STATES)[number];
