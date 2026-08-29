import { z } from "zod";
import { moneySchema, valueClassificationSchema } from "./common.js";

export const opportunityCategorySchema = z.enum([
  "CROSS_SELL",
  "UPSELL",
  "CATALOG_GAP",
  "READINESS_GAP",
  "PAYMENT_RECOVERY",
]);

/**
 * Signal → Opportunity → Recommendation (PART 00 §19). PART 01 seeds a
 * small number of these deterministically from real seed-data conditions
 * (PART 01 §79); the full Revenue Opportunity Engine is a later part.
 */
export const growthOpportunitySchema = z.object({
  id: z.string().uuid(),
  merchantId: z.string().uuid(),
  category: opportunityCategorySchema,
  signal: z.string(),
  recommendation: z.string(),
  estimatedValue: moneySchema.nullable(),
  valueClassification: valueClassificationSchema,
  status: z.enum(["IDENTIFIED", "PROPOSED", "ACTED_ON"]),
  isSyntheticDemo: z.boolean(),
  createdAt: z.string().datetime(),
});
export type GrowthOpportunityDTO = z.infer<typeof growthOpportunitySchema>;

/**
 * Merchant growth outcome summary (Part 11 §22-§23) — a READ MODEL over
 * data that already exists (`GrowthActionProposal`, `Order`, `Payment`),
 * never a second source of financial truth and never a fabricated
 * historical metric.
 *
 * Every money field carries an explicit `valueClassification`
 * (PART 00 §19): `OPPORTUNITY` values are potential and unrealized;
 * `OBSERVED` values require a real provider-verified `CAPTURED` payment.
 * There is deliberately no "revenue uplift %" or ROI field — this build
 * has no control group, so any such number would be a causal claim the
 * data cannot support.
 */
export const growthSummarySchema = z.object({
  /** Proposals the Merchant Agent actually produced (any status). */
  growthOpportunities: z.number().int().min(0),
  /** Reached `AUTHORIZED` — governance completed, execution permitted. */
  crossSellsAuthorized: z.number().int().min(0),
  upsellsAuthorized: z.number().int().min(0),
  bundlesAuthorized: z.number().int().min(0),
  /** Orders whose payment succeeded only on a later bounded retry. */
  recoveredOrders: z.number().int().min(0),
  /** Sum of `opportunity.opportunityDeltaMinor` across open proposals. */
  opportunityValue: moneySchema,
  /** Sum of CAPTURED payments on orders traceable to an authorized
   * agentic proposal — provider-verified only. */
  observedCapturedValue: moneySchema,
  /** Proposals blocked by deterministic validation or policy — shown so
   * the summary never reads as "AI succeeded every time". */
  blockedByGovernance: z.number().int().min(0),
});
export type GrowthSummaryDTO = z.infer<typeof growthSummarySchema>;
