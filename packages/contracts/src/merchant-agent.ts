import { z } from "zod";
import { SUPPORTED_CURRENCIES } from "@razorgrowth/domain";
import { moneySchema } from "./common.js";

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
  "EXECUTED",
  "VERIFIED",
  "FAILED",
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
  /** Whether the agent may run cycles without the merchant present. */
  autonomousRunsEnabled: z.boolean(),
  crossSellEnabled: z.boolean(),
  upsellEnabled: z.boolean(),
  bundleEnabled: z.boolean(),
  boundedOffersEnabled: z.boolean(),
  maxUpsellIncreaseBps: z.number().int().min(0),
  maxProposedDiscountBps: z.number().int().min(0),
  maxCrossSellItems: z.number().int().min(1),
  maxBundleItems: z.number().int().min(1),
  dailyDiscountBudgetMinor: z.number().int().min(0),
  weeklyCampaignBudgetMinor: z.number().int().min(0),
  maxCustomersContactedPerDay: z.number().int().min(0),
  maxContactsPerCustomerPerWeek: z.number().int().min(0),
  minCampaignMarginBps: z.number().int().min(0).max(10_000),
  campaignCooldownHours: z.number().int().min(0),
  automaticStopLossBps: z.number().int().min(0).max(10_000),
  defaultShippingCostMinor: z.number().int().min(0).max(100_000_000),
  paymentFeeBps: z.number().int().min(0).max(10_000),
  expectedReturnRateBps: z.number().int().min(0).max(10_000),
  quietHoursStart: z.number().int().min(0).max(23),
  quietHoursEnd: z.number().int().min(0).max(23),
  consentRequired: z.boolean(),
  outboundChannels: z.array(z.enum(["EMAIL", "WHATSAPP", "SMS", "PUSH", "BUYER_AGENT"])),
  categoryDiscountLimits: z.record(z.number().int().min(0).max(5_000)),
  excludedProductIds: z.array(z.string().uuid()),
  excludedCustomerIds: z.array(z.string().uuid()),
  currency: z.enum(SUPPORTED_CURRENCIES),
});
export type MerchantGrowthConfigDTO = z.infer<typeof merchantGrowthConfigSchema>;

/* ═══════════════════════════════════════════════════════════════════════
 * The autonomous cycle
 *
 * The Merchant Agent's loop, and the state it leaves behind. Both shapes
 * below are READ MODELS over rows that already exist — proposals, ledger
 * events, payments. Neither introduces a new source of financial truth.
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * How far one opportunity got down the pipeline.
 *
 * Stages are appended as they complete, so a step that stopped at
 * `POLICY_CHECKED` visibly did not reach `AUTHORIZED` — the shape itself
 * makes a skipped guardrail impossible to hide.
 */
export const agentRunStageSchema = z.enum([
  "DETECTED",
  "PROPOSED",
  "POLICY_CHECKED",
  "AUTHORIZED",
  "EXECUTED",
  "VERIFIED",
]);
export type AgentRunStageDTO = z.infer<typeof agentRunStageSchema>;

/**
 * What became of one opportunity.
 *
 * `REFUSED` and `BLOCKED` are deliberately not `FAILED`. The agent
 * declining to retry an unreconciled payment, and the policy engine
 * refusing an action outside its bounds, are both the system working as
 * designed. Collapsing them into a failure count would make correct
 * behaviour look like breakage — and would hide real breakage among it.
 */
export const agentRunOutcomeSchema = z.enum([
  "EXECUTED",
  "AWAITING_APPROVAL",
  "BLOCKED",
  "REFUSED",
  "SKIPPED",
  "FAILED",
]);
export type AgentRunOutcomeDTO = z.infer<typeof agentRunOutcomeSchema>;

export const agentRunStepSchema = z.object({
  opportunityId: z.string(),
  opportunityType: z.string(),
  title: z.string(),
  /** The observed fact that triggered this, carried through so the run
   * log answers "why did you do it?" without a second lookup. */
  whyDetected: z.string(),
  outcome: agentRunOutcomeSchema,
  detail: z.string(),
  proposalId: z.string().uuid().nullable(),
  policyOutcome: z.string().nullable(),
  authorizationId: z.string().uuid().nullable(),
  stages: z.array(agentRunStageSchema),
});
export type AgentRunStepDTO = z.infer<typeof agentRunStepSchema>;

export const agentRunResultSchema = z.object({
  /** The ledger workflow this run wrote under, so the whole cycle is
   * one verifiable chain in the audit trail. */
  workflowId: z.string().uuid(),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
  detectedCount: z.number().int().min(0),
  actionableCount: z.number().int().min(0),
  consideredCount: z.number().int().min(0),
  /** Actionable opportunities this cycle deliberately left for the next
   * one. Stated so a bounded run never reads as an empty backlog. */
  deferredCount: z.number().int().min(0),
  counts: z.object({
    executed: z.number().int().min(0),
    awaitingApproval: z.number().int().min(0),
    blocked: z.number().int().min(0),
    refused: z.number().int().min(0),
    failed: z.number().int().min(0),
  }),
  steps: z.array(agentRunStepSchema),
});
export type AgentRunResultDTO = z.infer<typeof agentRunResultSchema>;

const agentProposalRefSchema = z.object({
  proposalId: z.string().uuid(),
  actionType: z.string().nullable(),
  status: z.string(),
  at: z.string().datetime(),
});

export const agentStatusSchema = z.object({
  /** The top-ranked opportunity, as the agent's current objective. Null
   * when the engine found nothing — an agent with no work says so rather
   * than inventing an objective. */
  objective: z
    .object({
      opportunityId: z.string(),
      headline: z.string(),
      why: z.string(),
      proposedAction: z.string(),
      effort: z.string(),
      policyOutcome: z.string(),
    })
    .nullable(),

  lastRun: z
    .object({
      workflowId: z.string(),
      summary: z.string(),
      status: z.string(),
      completedAt: z.string().datetime(),
    })
    .nullable(),

  detected: z.object({
    count: z.number().int().min(0),
    blockedByPolicy: z.number().int().min(0),
    /** Opportunities the agent can act on with no buyer present. Reported
     * apart from the total so the console never implies it can execute a
     * cross-sell nobody is currently buying. */
    directlyActionable: z.number().int().min(0),
  }),

  nextActions: z.array(
    z.object({
      opportunityId: z.string(),
      type: z.string(),
      title: z.string(),
      why: z.string(),
      actionLabel: z.string(),
      effort: z.string(),
      policyOutcome: z.string(),
    }),
  ),

  /** Ledger entries the agent itself wrote. */
  autonomousActions: z.array(
    z.object({
      id: z.string().uuid(),
      actionType: z.string(),
      reason: z.string(),
      status: z.string(),
      workflowId: z.string(),
      at: z.string().datetime(),
    }),
  ),

  executedActions: z.array(agentProposalRefSchema.extend({ explanation: z.string() })),
  awaitingApproval: z.array(agentProposalRefSchema.extend({ explanation: z.string() })),
  failures: z.array(agentProposalRefSchema.extend({ reason: z.string() })),

  operations: z.object({
    queuedJobs: z.number().int().min(0),
    retryingJobs: z.number().int().min(0),
    deadLetterJobs: z.number().int().min(0),
    stalledJobs: z.number().int().min(0),
  }),

  /** Provider-verified only. Nothing merely attempted appears here. */
  verified: z.object({
    capturedValue: moneySchema,
    recoveredValue: moneySchema,
    recoveredOrders: z.number().int().min(0),
  }),

  generatedAt: z.string().datetime(),
});
export type AgentStatusDTO = z.infer<typeof agentStatusSchema>;

/**
 * The growth boundaries a merchant may change.
 *
 * Deliberately a subset of `merchantGrowthConfigSchema`: `currency` is the
 * merchant's own and is not an agent boundary, so it is not editable here.
 * Every field is optional — a merchant flipping one switch should not have
 * to resend their whole envelope and risk clobbering a ceiling they never
 * opened the form to change.
 */
export const merchantGrowthConfigUpdateSchema = z
  .object({
    growthActionsEnabled: z.boolean(),
    autonomousRunsEnabled: z.boolean(),
    crossSellEnabled: z.boolean(),
    upsellEnabled: z.boolean(),
    bundleEnabled: z.boolean(),
    boundedOffersEnabled: z.boolean(),
    /** Capped at 100% and 50% respectively — not because the schema knows
     * what is wise, but because a typo that adds a zero should be refused
     * at the edge rather than authorising every future offer under it. */
    maxUpsellIncreaseBps: z.number().int().min(0).max(10_000),
    maxProposedDiscountBps: z.number().int().min(0).max(5_000),
    maxCrossSellItems: z.number().int().min(1).max(10),
    maxBundleItems: z.number().int().min(1).max(10),
    dailyDiscountBudgetMinor: z.number().int().min(0).max(1_000_000_000),
    weeklyCampaignBudgetMinor: z.number().int().min(0).max(2_147_483_647),
    maxCustomersContactedPerDay: z.number().int().min(0).max(100_000),
    maxContactsPerCustomerPerWeek: z.number().int().min(0).max(50),
    minCampaignMarginBps: z.number().int().min(0).max(10_000),
    campaignCooldownHours: z.number().int().min(0).max(8_760),
    automaticStopLossBps: z.number().int().min(0).max(10_000),
    defaultShippingCostMinor: z.number().int().min(0).max(100_000_000),
    paymentFeeBps: z.number().int().min(0).max(10_000),
    expectedReturnRateBps: z.number().int().min(0).max(10_000),
    quietHoursStart: z.number().int().min(0).max(23),
    quietHoursEnd: z.number().int().min(0).max(23),
    consentRequired: z.boolean(),
    outboundChannels: z.array(z.enum(["EMAIL", "WHATSAPP", "SMS", "PUSH", "BUYER_AGENT"])).min(1),
    categoryDiscountLimits: z.record(z.number().int().min(0).max(5_000)),
    excludedProductIds: z.array(z.string().uuid()).max(10_000),
    excludedCustomerIds: z.array(z.string().uuid()).max(100_000),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: "No growth boundary was supplied to change." });
export type MerchantGrowthConfigUpdateDTO = z.infer<typeof merchantGrowthConfigUpdateSchema>;
