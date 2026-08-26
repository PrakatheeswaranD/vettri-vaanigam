/**
 * Merchant Agent growth-action taxonomy (PART 04 §10, §17, §24-§25, §37,
 * §50, §61).
 *
 * A small, explicit, closed vocabulary — never an open string the model
 * can extend. Every enum here is a genuine domain concept, not a
 * generated label.
 */

export const GROWTH_ACTION_TYPES = ["CROSS_SELL", "UPSELL", "BUNDLE", "BOUNDED_OFFER", "RECOVERY"] as const;
export type GrowthActionType = (typeof GROWTH_ACTION_TYPES)[number];

/**
 * PART 04 ends at proposal creation/validation (`PROPOSED` /
 * `REJECTED_VALIDATION`); PART 05 adds the real governance lifecycle a
 * validated proposal moves through afterward (§26-§28):
 *
 * PROPOSED --[policy evaluate]--> POLICY_DENIED | ALLOWED | PENDING_APPROVAL
 * ALLOWED --[authorization issued]--> AUTHORIZED (stays ALLOWED, retryable,
 *   if issuance fails revalidation)
 * PENDING_APPROVAL --[merchant decides]--> APPROVED | APPROVAL_REJECTED
 * APPROVED --[authorization issued]--> AUTHORIZED (stays APPROVED, retryable,
 *   on issuance failure)
 *
 * `POLICY_DENIED`, `REJECTED_VALIDATION`, and `APPROVAL_REJECTED` are
 * terminal — none of them can ever reach `AUTHORIZED`. There is
 * deliberately no `EXECUTED`/`VERIFIED` value yet: PART 05 stops at
 * authorization, and adding states for a stage that doesn't exist yet
 * would misrepresent what is actually implemented (PART 00 §50).
 */
export const GROWTH_PROPOSAL_STATUSES = [
  "PROPOSED",
  "REJECTED_VALIDATION",
  "POLICY_DENIED",
  "ALLOWED",
  "PENDING_APPROVAL",
  "APPROVED",
  "APPROVAL_REJECTED",
  "AUTHORIZED",
] as const;
export type GrowthProposalStatus = (typeof GROWTH_PROPOSAL_STATUSES)[number];

/** PART 05 §28 — the only legal transitions out of each status. Centralized
 * here so both the API layer and tests share one authority for what is a
 * valid state change, rather than re-deriving it ad hoc at each call site. */
export const GROWTH_PROPOSAL_TRANSITIONS: Record<GrowthProposalStatus, readonly GrowthProposalStatus[]> = {
  PROPOSED: ["POLICY_DENIED", "ALLOWED", "PENDING_APPROVAL"],
  REJECTED_VALIDATION: [],
  POLICY_DENIED: [],
  ALLOWED: ["AUTHORIZED"],
  PENDING_APPROVAL: ["APPROVED", "APPROVAL_REJECTED"],
  APPROVED: ["AUTHORIZED"],
  APPROVAL_REJECTED: [],
  AUTHORIZED: [],
};

export function isValidProposalTransition(from: GrowthProposalStatus, to: GrowthProposalStatus): boolean {
  return GROWTH_PROPOSAL_TRANSITIONS[from].includes(to);
}

/** PART 04 §61 — never presented as if a mode it isn't; a mode is a
 * factual record of HOW the proposal was produced. */
export const GROWTH_PROPOSAL_MODES = [
  "AI_PROPOSED",
  "DETERMINISTIC_RELATIONSHIP",
  "DETERMINISTIC_FALLBACK",
  "NO_OPPORTUNITY",
  "BLOCKED_BY_DATA",
] as const;
export type GrowthProposalMode = (typeof GROWTH_PROPOSAL_MODES)[number];

/** PART 04 §37 — a model may only ever propose from this fixed allowlist. */
export const GROWTH_REASON_CODES = [
  "COMPLEMENTARY_PRODUCT",
  "BUYER_PREFERENCE_MATCH",
  "UPGRADE_WITHIN_BUDGET",
  "UPGRADE_WITHIN_ALLOWED_UPLIFT",
  "BUNDLE_RELEVANCE",
  "PRICE_HESITATION",
  "NO_EXACT_MATCH_RECOVERY",
  "MERCHANT_CONFIGURED_RELATIONSHIP",
  "READINESS_SUPPORTED",
  /** PART 08 §16 — payment-failure recovery proposals (as opposed to the
   * PART 04 buyer-budget `RECOVERY` variant above). */
  "RETRYABLE_PAYMENT_FAILURE",
  "RECOVERY_ATTEMPT_AVAILABLE",
] as const;
export type GrowthReasonCode = (typeof GROWTH_REASON_CODES)[number];

export function isKnownGrowthReasonCode(value: string): value is GrowthReasonCode {
  return (GROWTH_REASON_CODES as readonly string[]).includes(value);
}

export function isKnownGrowthActionType(value: string): value is GrowthActionType {
  return (GROWTH_ACTION_TYPES as readonly string[]).includes(value);
}

/** PART 04 §24 — deterministic product-relationship model. */
export const PRODUCT_RELATIONSHIP_TYPES = ["COMPLEMENTARY", "UPSELL_ALTERNATIVE", "SIMILAR", "BUNDLE_COMPATIBLE"] as const;
export type ProductRelationshipType = (typeof PRODUCT_RELATIONSHIP_TYPES)[number];

/** PART 04 §25 — relationship provenance; AI-suggested relationships are
 * never treated as merchant truth. */
export const RELATIONSHIP_PROVENANCES = ["MERCHANT_CONFIGURED", "CATALOG_METADATA", "SYSTEM_DERIVED", "DEMO_SEED"] as const;
export type RelationshipProvenance = (typeof RELATIONSHIP_PROVENANCES)[number];

/** PART 04 §50 — structured, evidence-backed blockers, mirroring the
 * readiness engine's own blocker model (PART 02). */
export const GROWTH_BLOCKER_CODES = [
  "UNKNOWN_INVENTORY",
  "MISSING_PRICE",
  "MISSING_VARIANT_ATTRIBUTE",
  "MISSING_POLICY_DATA",
  "PRODUCT_NOT_AGENT_VISIBLE",
] as const;
export type GrowthBlockerCode = (typeof GROWTH_BLOCKER_CODES)[number];

/** PART 04 §11-§14 — the relationship a candidate has to the primary
 * product deterministically decides the CANDIDATE action type; the
 * Merchant Agent (or the deterministic fallback) still chooses WHICH
 * candidate to propose, but never invents the mapping. */
export const RELATIONSHIP_ACTION_TYPE: Record<ProductRelationshipType, GrowthActionType> = {
  COMPLEMENTARY: "CROSS_SELL",
  UPSELL_ALTERNATIVE: "UPSELL",
  BUNDLE_COMPATIBLE: "BUNDLE",
  SIMILAR: "CROSS_SELL",
};

const GROWTH_REASON_CODE_TEXT: Record<GrowthReasonCode, string> = {
  COMPLEMENTARY_PRODUCT: "configured as complementary to your selection",
  BUYER_PREFERENCE_MATCH: "matches your stated preference",
  UPGRADE_WITHIN_BUDGET: "within your budget",
  UPGRADE_WITHIN_ALLOWED_UPLIFT: "within the merchant's allowed upgrade range",
  BUNDLE_RELEVANCE: "a relevant bundle pairing",
  PRICE_HESITATION: "offered to help close a budget gap",
  NO_EXACT_MATCH_RECOVERY: "the closest alternative since no exact match was found",
  MERCHANT_CONFIGURED_RELATIONSHIP: "a merchant-configured relationship",
  READINESS_SUPPORTED: "backed by complete price, inventory, and policy information",
  RETRYABLE_PAYMENT_FAILURE: "the prior payment attempt failed for a retryable reason",
  RECOVERY_ATTEMPT_AVAILABLE: "a recovery attempt remains available under merchant policy",
};

/** PART 04 §39, §47 — a template-rendered explanation from deterministic
 * reason codes, never free AI prose standing in for a commerce fact. */
export function renderGrowthExplanation(reasonCodes: GrowthReasonCode[]): string {
  const clauses = reasonCodes.map((c) => GROWTH_REASON_CODE_TEXT[c]);
  if (clauses.length === 0) return "Proposed based on merchant configuration.";
  const [first, ...rest] = clauses;
  const capitalized = first!.charAt(0).toUpperCase() + first!.slice(1);
  return rest.length === 0 ? `${capitalized}.` : `${capitalized}, ${rest.join(", ")}.`;
}
