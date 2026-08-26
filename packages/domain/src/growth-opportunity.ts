/**
 * Deterministic growth-candidate evaluation (PART 04 §26-§27, §31-§32,
 * §49-§51).
 *
 * Turns a product's configured relationships into a bounded, eligible
 * candidate set the Merchant Agent may reason over — and separately
 * surfaces candidates that a real relationship exists for but that
 * missing machine-readable commerce data currently blocks from becoming
 * a safe proposal. This is the readiness → growth connection: a blocked
 * candidate here is the direct commercial cost of an incomplete
 * Agent-Readable Catalog entry (PART 02).
 */
import { isPurchasable, type AvailabilityState } from "./availability.js";
import type { ProductReadinessState } from "./product-readiness.js";
import { RELATIONSHIP_ACTION_TYPE, type GrowthActionType, type GrowthBlockerCode, type GrowthReasonCode, type ProductRelationshipType } from "./growth-action.js";

export interface GrowthCandidateEvidence {
  productId: string;
  relationshipType: ProductRelationshipType;
  priceMinor: number | null;
  availabilityState: AvailabilityState;
  attributes: Record<string, string>;
  readinessState: ProductReadinessState;
  hasStructuredAttributes: boolean;
  hasPolicyData: boolean;
  isAgentVisible: boolean;
}

export interface BlockedGrowthCandidate {
  productId: string;
  actionType: GrowthActionType;
  blockerCode: GrowthBlockerCode;
}

export interface EligibleGrowthCandidate extends GrowthCandidateEvidence {
  actionType: GrowthActionType;
}

export interface GrowthCandidateSet {
  eligible: EligibleGrowthCandidate[];
  blocked: BlockedGrowthCandidate[];
}

/** The FIRST applicable blocker only — evidence should point at the
 * single most fundamental gap, not overwhelm the merchant with every
 * secondary issue at once (mirrors the readiness engine's own
 * one-blocker-per-evidence-gap style, PART 02). */
export function detectGrowthBlocker(evidence: GrowthCandidateEvidence): GrowthBlockerCode | null {
  if (!evidence.isAgentVisible) return "PRODUCT_NOT_AGENT_VISIBLE";
  if (evidence.priceMinor === null) return "MISSING_PRICE";
  if (evidence.availabilityState === "UNKNOWN") return "UNKNOWN_INVENTORY";
  if (!evidence.hasStructuredAttributes) return "MISSING_VARIANT_ATTRIBUTE";
  if (!evidence.hasPolicyData) return "MISSING_POLICY_DATA";
  return null;
}

/**
 * Split relationship-derived candidates into ELIGIBLE (safe to propose)
 * and BLOCKED (a real relationship exists, but data quality prevents a
 * safe proposal). Candidates whose relationship maps to a disabled
 * action type, or that are simply out of stock (a normal commerce state,
 * not a data-quality gap), are neither — they're silently excluded, same
 * as PART 03's handling of a genuinely unavailable near-match.
 */
export function evaluateGrowthCandidates(
  candidates: GrowthCandidateEvidence[],
  allowedActionTypes: readonly GrowthActionType[],
): GrowthCandidateSet {
  const eligible: EligibleGrowthCandidate[] = [];
  const blocked: BlockedGrowthCandidate[] = [];

  for (const candidate of candidates) {
    const actionType = RELATIONSHIP_ACTION_TYPE[candidate.relationshipType];
    if (!allowedActionTypes.includes(actionType)) continue;

    const blockerCode = detectGrowthBlocker(candidate);
    if (blockerCode) {
      blocked.push({ productId: candidate.productId, actionType, blockerCode });
      continue;
    }

    if (!isPurchasable(candidate.availabilityState)) continue;

    eligible.push({ ...candidate, actionType });
  }

  return { eligible, blocked };
}

const RELATIONSHIP_PRIORITY: Record<ProductRelationshipType, number> = {
  COMPLEMENTARY: 0,
  UPSELL_ALTERNATIVE: 1,
  BUNDLE_COMPATIBLE: 2,
  SIMILAR: 3,
};

function matchesAnyPreference(candidate: GrowthCandidateEvidence, preferredAttributes: Record<string, string>): boolean {
  return Object.entries(preferredAttributes).some(
    ([key, value]) => candidate.attributes[key.toLowerCase()]?.toLowerCase() === value.toLowerCase(),
  );
}

export interface DeterministicGrowthProposal {
  actionType: GrowthActionType | null;
  relatedProductIds: string[];
  reasonCodes: GrowthReasonCode[];
}

/**
 * Deterministic candidate selection (PART 04 §60-§62, §108). Used both by
 * the demo rule-based provider AND as the Merchant Agent's fallback/
 * single-candidate/demo-mode path — one algorithm, never two copies that
 * could silently diverge. Priority: relationship type (complementary
 * first, matching PART 04 §11's framing that cross-sell is the most
 * ordinary, safest action) → buyer preference match → product ID for a
 * fully stable, reproducible order. Never proposes an offer of its own
 * accord (PART 04 §40, §46) — a bounded-offer proposal requires an
 * explicit signal this deterministic path doesn't fabricate.
 */
export function deterministicGrowthProposal(
  eligible: EligibleGrowthCandidate[],
  preferredAttributes: Record<string, string>,
): DeterministicGrowthProposal {
  if (eligible.length === 0) {
    return { actionType: null, relatedProductIds: [], reasonCodes: [] };
  }

  const best = [...eligible].sort((a, b) => {
    const priorityDelta = RELATIONSHIP_PRIORITY[a.relationshipType] - RELATIONSHIP_PRIORITY[b.relationshipType];
    if (priorityDelta !== 0) return priorityDelta;
    const aPref = matchesAnyPreference(a, preferredAttributes);
    const bPref = matchesAnyPreference(b, preferredAttributes);
    if (aPref !== bPref) return aPref ? -1 : 1;
    return a.productId.localeCompare(b.productId);
  })[0]!;

  const reasonCodes: GrowthReasonCode[] = ["MERCHANT_CONFIGURED_RELATIONSHIP"];
  if (matchesAnyPreference(best, preferredAttributes)) reasonCodes.push("BUYER_PREFERENCE_MATCH");
  if (best.relationshipType === "COMPLEMENTARY") reasonCodes.push("COMPLEMENTARY_PRODUCT");
  if (best.relationshipType === "BUNDLE_COMPATIBLE") reasonCodes.push("BUNDLE_RELEVANCE");
  if (best.relationshipType === "UPSELL_ALTERNATIVE") reasonCodes.push("UPGRADE_WITHIN_BUDGET");
  if (best.readinessState === "AGENT_READY") reasonCodes.push("READINESS_SUPPORTED");

  return { actionType: best.actionType, relatedProductIds: [best.productId], reasonCodes };
}
