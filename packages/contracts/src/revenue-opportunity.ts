/**
 * Wire contract for the Revenue Opportunity Engine.
 *
 * The schema is deliberately strict about the money shape. Every monetary
 * value on the wire carries its own `classification`, so a client
 * physically cannot render an OPPORTUNITY ceiling in the slot where an
 * OBSERVED amount belongs without saying which it is — the mislabelling
 * that turns an honest engine into a dishonest dashboard.
 */
import { z } from "zod";
import { currencySchema } from "./common.js";

export const opportunityValueClassificationSchema = z.enum(["OBSERVED", "ESTIMATED", "OPPORTUNITY"]);

export const opportunityMoneySchema = z.object({
  amountMinor: z.number().int(),
  currency: currencySchema,
  classification: opportunityValueClassificationSchema,
});

export const evidenceBasisSchema = z.enum(["DIRECT_OBSERVATION", "OBSERVED_HISTORY", "INSUFFICIENT_EVIDENCE"]);

export const revenueOpportunityTypeSchema = z.enum([
  "FAILED_PAYMENT_RECOVERY",
  /** A payment whose outcome nobody has asked the provider about. Its own
   * type because the action differs: it must be RECONCILED, never
   * retried — retrying an attempt that may already have succeeded is how
   * a double charge happens. */
  "UNVERIFIED_PAYMENT",
  "ABANDONED_CHECKOUT_RECOVERY",
  "REPEAT_PURCHASE",
  "CUSTOMER_REACTIVATION",
  "CROSS_SELL",
  "UPSELL",
  "UNDERPERFORMING_PRODUCT",
  "AI_BUYER_READINESS",
  "PRODUCT_DISCOVERY",
  "ELIGIBLE_OFFER",
]);

export const opportunityActionSchema = z.enum([
  "RECOVER_FAILED_PAYMENT",
  "RECONCILE_PAYMENT",
  "RECOVER_ABANDONED_CHECKOUT",
  "RECOMMEND_COMPLEMENTARY_PRODUCT",
  "OFFER_TARGETED_UPSELL",
  "IMPROVE_AI_DISCOVERABILITY",
  "REACTIVATE_CUSTOMER",
  "PROMPT_REPEAT_PURCHASE",
  "IMPROVE_PRODUCT_CONVERSION",
  "PUBLISH_PRODUCT_FOR_DISCOVERY",
  "PROPOSE_BOUNDED_OFFER",
]);

export const opportunityEvidenceSchema = z.object({
  label: z.string(),
  value: z.string(),
  /** Present when the fact is an amount, so the client formats it rather
   * than the domain guessing at a locale. */
  money: z.object({ amountMinor: z.number().int(), currency: currencySchema }).optional(),
  source: z.string(),
});

export const opportunityExpectedEffectSchema = z.object({
  atRiskValue: opportunityMoneySchema.nullable(),
  addressableValue: opportunityMoneySchema.nullable(),
  /** Null whenever `basis` is INSUFFICIENT_EVIDENCE. */
  expectedIncrementalValue: opportunityMoneySchema.nullable(),
  basis: evidenceBasisSchema,
  method: z.string(),
  sampleSize: z.number().int().min(0),
});

export const opportunityScoreSchema = z.object({
  value: z.number().int().min(0).max(100),
  confidence: z.number().int().min(0).max(100),
  urgency: z.number().int().min(0).max(100),
  customerImpact: z.number().int().min(0).max(100),
  effort: z.number().int().min(0).max(100),
  policy: z.number().int().min(0).max(100),
  priority: z.number().int().min(0).max(100),
});

export const revenueOpportunitySchema = z.object({
  id: z.string(),
  type: revenueOpportunityTypeSchema,
  title: z.string(),
  whyDetected: z.string(),
  proposedAction: opportunityActionSchema,
  actionLabel: z.string(),
  expectedEffect: opportunityExpectedEffectSchema,
  evidence: z.array(opportunityEvidenceSchema),
  risk: z.string(),
  policy: z.object({
    outcome: z.enum(["ELIGIBLE", "REQUIRES_APPROVAL", "BLOCKED"]),
    reasons: z.array(z.string()),
  }),
  effort: z.enum(["AGENT_AUTOMATIC", "ONE_APPROVAL", "MERCHANT_WORK"]),
  score: opportunityScoreSchema,
  subjectIds: z.array(z.string()),
  customersAffected: z.number().int().min(0),

  /**
   * Whether a human must sign this off before anything executes.
   *
   * On the wire as its own field rather than left to be inferred from
   * `policy.outcome` and `effort` together — a client that has to combine
   * two fields to answer "will this interrupt me" will eventually combine
   * them differently from the console.
   */
  approvalRequired: z.boolean(),
  /** Lifted out of `score` because they are the two components a merchant
   * actually argues with. The full breakdown stays in `score`. */
  confidence: z.number().int().min(0).max(100),
  urgency: z.number().int().min(0).max(100),
  /** Derived from proposals the agent has already made, so the same card
   * cannot reappear as new after it has been acted on. */
  status: z.enum(["DETECTED", "PARTIALLY_ACTIONED", "ACTIONED"]),
  /** What came of it, or null while nothing has. Never a monetary claim —
   * verified money lives on the payment rows. */
  result: z.string().nullable(),
});
export type RevenueOpportunityDTO = z.infer<typeof revenueOpportunitySchema>;

export const scoreComponentSchema = z.object({
  key: z.string(),
  label: z.string(),
  earned: z.number().int().min(0),
  max: z.number().int().min(0),
  evidence: z.string(),
  toImprove: z.string().nullable(),
});

export const compositeScoreSchema = z.object({
  score: z.number().int().min(0).max(100),
  components: z.array(scoreComponentSchema),
});
export type CompositeScoreDTO = z.infer<typeof compositeScoreSchema>;

export const revenueOpportunityReportSchema = z.object({
  opportunities: z.array(revenueOpportunitySchema),
  totals: z.object({
    currency: currencySchema,
    opportunityCount: z.number().int().min(0),
    blockedCount: z.number().int().min(0),
    totalAtRiskMinor: z.number().int().min(0),
    totalAddressableMinor: z.number().int().min(0),
    totalExpectedIncrementalMinor: z.number().int().min(0),
    withheldEstimateCount: z.number().int().min(0),
  }),
  growthScore: compositeScoreSchema,
  aiBuyerScore: compositeScoreSchema,
  observed: z.object({
    currency: currencySchema,
    capturedRevenueMinor: z.number().int().min(0),
    averageOrderValueMinor: z.number().int().min(0),
    paidOrderCount: z.number().int().min(0),
    ordersWithPaymentAttempt: z.number().int().min(0),
    failedPaymentCount: z.number().int().min(0),
    recoveredPaymentCount: z.number().int().min(0),
    customerCount: z.number().int().min(0),
    repeatCustomerCount: z.number().int().min(0),
    agentVisibleProductCount: z.number().int().min(0),
    transactableProductCount: z.number().int().min(0),
  }),
  generatedAt: z.string().datetime(),
});
export type RevenueOpportunityReportDTO = z.infer<typeof revenueOpportunityReportSchema>;
