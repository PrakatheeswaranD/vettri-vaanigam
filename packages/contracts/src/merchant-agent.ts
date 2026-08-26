import { z } from "zod";
import { SUPPORTED_CURRENCIES } from "@razorgrowth/domain";

/**
 * Merchant Agent wire contracts (PART 04 §16-§20, §35-§38, §80-§81).
 *
 * `GrowthActionProposalDTO` is the response shape returned after
 * deterministic validation — the model's raw output never crosses the
 * wire directly. `policyStatus` is always `"NOT_EVALUATED"` in PART 04;
 * PART 05 owns the real policy/approval lifecycle.
 */

export const MERCHANT_GROWTH_SCHEMA_VERSION = "1.0" as const;

export const growthActionTypeSchema = z.enum(["CROSS_SELL", "UPSELL", "BUNDLE", "BOUNDED_OFFER", "RECOVERY"]);
export type GrowthActionTypeDTO = z.infer<typeof growthActionTypeSchema>;

/** PART 05 §26-§28 — the governance lifecycle a validated proposal moves
 * through after creation. See `@razorgrowth/domain`
 * `GROWTH_PROPOSAL_TRANSITIONS` for the authoritative transition table. */
export const growthProposalStatusSchema = z.enum([
  "PROPOSED",
  "REJECTED_VALIDATION",
  "POLICY_DENIED",
  "ALLOWED",
  "PENDING_APPROVAL",
  "APPROVED",
  "APPROVAL_REJECTED",
  "AUTHORIZED",
]);

export const growthProposalModeSchema = z.enum([
  "AI_PROPOSED",
  "DETERMINISTIC_RELATIONSHIP",
  "DETERMINISTIC_FALLBACK",
  "NO_OPPORTUNITY",
  "BLOCKED_BY_DATA",
]);

/** PART 04 §37 — fixed allowlist; a model may only propose from this set. */
export const growthReasonCodeSchema = z.enum([
  "COMPLEMENTARY_PRODUCT",
  "BUYER_PREFERENCE_MATCH",
  "UPGRADE_WITHIN_BUDGET",
  "UPGRADE_WITHIN_ALLOWED_UPLIFT",
  "BUNDLE_RELEVANCE",
  "PRICE_HESITATION",
  "NO_EXACT_MATCH_RECOVERY",
  "MERCHANT_CONFIGURED_RELATIONSHIP",
  "READINESS_SUPPORTED",
  "RETRYABLE_PAYMENT_FAILURE",
  "RECOVERY_ATTEMPT_AVAILABLE",
]);
export type GrowthReasonCodeDTO = z.infer<typeof growthReasonCodeSchema>;

/** PART 08 §18 — deliberately small: only `RETRY_SAME_CHECKOUT` is
 * actually implemented. */
export const recoveryActionSchema = z.enum(["RETRY_SAME_CHECKOUT", "NO_RECOVERY"]);
export type RecoveryActionDTO = z.infer<typeof recoveryActionSchema>;

export const productRelationshipTypeSchema = z.enum(["COMPLEMENTARY", "UPSELL_ALTERNATIVE", "SIMILAR", "BUNDLE_COMPATIBLE"]);

export const relationshipProvenanceSchema = z.enum(["MERCHANT_CONFIGURED", "CATALOG_METADATA", "SYSTEM_DERIVED", "DEMO_SEED"]);

export const growthBlockerCodeSchema = z.enum([
  "UNKNOWN_INVENTORY",
  "MISSING_PRICE",
  "MISSING_VARIANT_ATTRIBUTE",
  "MISSING_POLICY_DATA",
  "PRODUCT_NOT_AGENT_VISIBLE",
]);
export type GrowthBlockerCodeDTO = z.infer<typeof growthBlockerCodeSchema>;

export const offerKindSchema = z.enum(["PERCENTAGE", "FIXED_AMOUNT"]);

export const offerTermsSchema = z.object({
  kind: offerKindSchema,
  percentageBps: z.number().int().min(0).max(10_000).nullable(),
  amountMinor: z.number().int().min(0).nullable(),
});
export type OfferTermsDTO = z.infer<typeof offerTermsSchema>;

/** PART 04 §34 — always application-calculated, never model-computed. */
export const offerCalculationSchema = z.object({
  baseAmountMinor: z.number().int(),
  discountMinor: z.number().int().min(0),
  finalAmountMinor: z.number().int().min(0),
  currency: z.enum(SUPPORTED_CURRENCIES),
});

/** PART 04 §44-§45 — a potential upside, never a claim of realized
 * revenue. Always paired with the OPPORTUNITY label in the UI. */
export const opportunityCalculationSchema = z.object({
  currentBasketMinor: z.number().int().min(0),
  potentialBasketMinor: z.number().int().min(0),
  opportunityDeltaMinor: z.number().int(),
  currency: z.enum(SUPPORTED_CURRENCIES),
});

/** PART 04 §38 — structured, factual evidence only; never free AI prose
 * standing in for a commerce fact. */
export const growthEvidenceSchema = z.object({
  type: z.enum(["BUYER_PREFERENCE", "PRODUCT_RELATIONSHIP", "PRICE_DELTA", "READINESS_STATE", "AVAILABILITY"]),
  detail: z.string(),
});
export type GrowthEvidenceDTO = z.infer<typeof growthEvidenceSchema>;

/** PART 04 §50 — a real relationship exists, but missing machine-readable
 * commerce data blocks it from becoming a safe proposal. This is the
 * readiness → growth economic connection, made concrete: `
 * relatedReadinessDimension` / `currentReadinessDimensionScore` are the
 * ACTUAL current values from the merchant's latest `ReadinessSnapshot`
 * (PART 02) — never a fabricated "fix this and gain N points" estimate —
 * null when no snapshot has been calculated yet. */
export const blockedGrowthOpportunitySchema = z.object({
  productId: z.string().uuid(),
  actionType: growthActionTypeSchema,
  blockerCode: growthBlockerCodeSchema,
  remediation: z.string(),
  relatedReadinessDimension: z.string().nullable(),
  currentReadinessDimensionScore: z.number().int().min(0).max(100).nullable(),
});
export type BlockedGrowthOpportunityDTO = z.infer<typeof blockedGrowthOpportunitySchema>;

export const growthActionProposalSchema = z.object({
  id: z.string().uuid(),
  schemaVersion: z.literal(MERCHANT_GROWTH_SCHEMA_VERSION),
  merchantId: z.string().uuid(),
  conversationId: z.string().uuid().nullable(),
  recommendationId: z.string().uuid().nullable(),
  primaryProductId: z.string().uuid(),
  actionType: growthActionTypeSchema.nullable(),
  relatedProductIds: z.array(z.string().uuid()),
  offer: offerTermsSchema.nullable(),
  offerCalculation: offerCalculationSchema.nullable(),
  opportunity: opportunityCalculationSchema.nullable(),
  evidence: z.array(growthEvidenceSchema),
  reasonCodes: z.array(growthReasonCodeSchema),
  explanation: z.string(),
  mode: growthProposalModeSchema,
  status: growthProposalStatusSchema,
  /** `"NOT_EVALUATED"` until a real `POST /policy/evaluate` call runs
   * (PART 05); after that it mirrors `status`'s governance outcome
   * (`ALLOW` / `DENY` / `REQUIRE_APPROVAL`) so a client never has to
   * cross-reference `status` to know the policy outcome. Never
   * `APPROVED` here — approval is a distinct, separately-modeled concept
   * (PART 04 §81, PART 05 §23-§25: ALLOW/AUTHORIZED are not "approved"). */
  policyStatus: z.enum(["NOT_EVALUATED", "ALLOW", "DENY", "REQUIRE_APPROVAL"]),
  /** The latest policy decision for this proposal, if one has been
   * evaluated — `null` until `POST /policy/evaluate` runs. */
  latestPolicyDecisionId: z.string().uuid().nullable(),
  /** Set once a merchant has decided on a `PENDING_APPROVAL` proposal. */
  approvalId: z.string().uuid().nullable(),
  /** Set once execution authorization has been issued (`status ===
   * "AUTHORIZED"`). PART 06 must load and revalidate this by ID — this
   * DTO field is a pointer for the UI, never itself proof of authority. */
  executionAuthorizationId: z.string().uuid().nullable(),
  rejectionReason: z.string().nullable(),
  blockedOpportunities: z.array(blockedGrowthOpportunitySchema),
  traceId: z.string().uuid(),
  createdAt: z.string().datetime(),
  /** PART 08 §19 — set only for a payment-failure recovery proposal;
   * `null` for every ordinary growth proposal and for the PART 04
   * buyer-budget `RECOVERY` variant. */
  recoveryAction: recoveryActionSchema.nullable(),
  sourceOrderId: z.string().uuid().nullable(),
  sourcePaymentId: z.string().uuid().nullable(),
  sourceCheckoutId: z.string().uuid().nullable(),
});
export type GrowthActionProposalDTO = z.infer<typeof growthActionProposalSchema>;

export const growthProposalRequestSchema = z.object({
  conversationId: z.string().uuid().optional(),
  recommendationId: z.string().uuid().optional(),
  primaryProductId: z.string().uuid(),
});
export type GrowthProposalRequestDTO = z.infer<typeof growthProposalRequestSchema>;

/** Non-secret merchant growth boundary configuration (PART 04 §21, §86). */
export const merchantGrowthConfigSchema = z.object({
  growthActionsEnabled: z.boolean(),
  crossSellEnabled: z.boolean(),
  upsellEnabled: z.boolean(),
  bundleEnabled: z.boolean(),
  boundedOffersEnabled: z.boolean(),
  maxUpsellIncreaseBps: z.number().int().min(0),
  maxProposedDiscountBps: z.number().int().min(0),
  maxCrossSellItems: z.number().int().min(1),
  maxBundleItems: z.number().int().min(1),
  currency: z.enum(SUPPORTED_CURRENCIES),
});
export type MerchantGrowthConfigDTO = z.infer<typeof merchantGrowthConfigSchema>;
