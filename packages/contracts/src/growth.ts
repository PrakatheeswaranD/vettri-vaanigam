import { z } from "zod";
import { moneySchema } from "./common.js";

/**
 * The `GrowthOpportunity` feed and its catalogue scanner were retired in
 * Part 4: all four of its categories are covered by the Revenue
 * Opportunity Engine, which computes from live rows rather than from a
 * table something had to remember to write. Its schema is gone from here,
 * its route is gone from the API, and its table is dropped by
 * `20260902000000_drop_retired_growth_opportunity`.
 */

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

  /**
   * VERIFIED: money that arrived only because a bounded retry was made.
   *
   * `recoveredOrders` was already here as a count, which tells a merchant
   * that recovery happened but not whether it was worth anything. The
   * amount is the same provider-verified `CAPTURED` payments, summed —
   * never an estimate of what recovery "could" earn.
   */
  recoveredValue: moneySchema,

  /** Proposals the policy engine will not release without a human. This
   * is the one number on the Overview that is a request for action. */
  pendingApprovals: z.number().int().min(0),

  /**
   * What the Merchant Agent did on its own, from the ledger.
   *
   * Grouped rather than listed: the Overview answers "what has my agent
   * been doing" and a raw event feed answers "what happened at 14:32".
   * The ledger tab already does the second. Only events written with
   * `actorType: MERCHANT_AGENT` appear here — a deterministic readiness
   * recalculation is not something the agent decided to do.
   */
  automatedActions: z.array(
    z.object({
      actionType: z.string(),
      count: z.number().int().min(0),
      lastAt: z.string().datetime(),
    }),
  ),
});
export type GrowthSummaryDTO = z.infer<typeof growthSummarySchema>;
