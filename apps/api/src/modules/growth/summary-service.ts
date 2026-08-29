/**
 * Growth outcome summary (Part 11 §22-§23).
 *
 * A READ MODEL over data that already exists — `GrowthActionProposal`,
 * `Order`, `Payment`. It creates no new financial truth and persists
 * nothing. Two rules govern every number here:
 *
 *  1. OPPORTUNITY vs OBSERVED is never blurred. An opportunity value is
 *     the Merchant Agent's own `opportunityDeltaMinor` on a proposal that
 *     has NOT yet produced a captured payment. An observed value requires
 *     a real `Payment` row in state `CAPTURED` — i.e. provider-verified
 *     money, per the same invariant the payment state machine enforces.
 *
 *  2. No causal claim. There is deliberately no "uplift %" or ROI: this
 *     build has no control group, so attributing captured revenue TO the
 *     agent would be a fabrication. `observedCapturedValue` is scoped to
 *     orders traceable to an authorized proposal and is described as
 *     exactly that — provenance, not attribution.
 */
import type { PrismaClient } from "@prisma/client";
import type { GrowthSummaryDTO } from "@razorgrowth/contracts";

/** Statuses where governance stopped the proposal (Part 11 §23 — the
 * summary must never read as "the AI succeeded every time"). */
const BLOCKED_STATUSES = ["REJECTED_VALIDATION", "POLICY_DENIED", "APPROVAL_REJECTED"] as const;

/** Still live: proposed or mid-governance, no captured money yet. */
const OPEN_STATUSES = ["PROPOSED", "ALLOWED", "PENDING_APPROVAL", "APPROVED", "AUTHORIZED"] as const;

interface OpportunityJson {
  opportunityDeltaMinor?: number;
  currency?: string;
}

export async function getGrowthSummary(prisma: PrismaClient, merchantId: string): Promise<GrowthSummaryDTO> {
  const merchant = await prisma.merchant.findUniqueOrThrow({
    where: { id: merchantId },
    select: { defaultCurrency: true },
  });
  const currency = merchant.defaultCurrency;

  const [
    growthOpportunities,
    crossSellsAuthorized,
    upsellsAuthorized,
    bundlesAuthorized,
    blockedByGovernance,
    openProposals,
  ] = await Promise.all([
    prisma.growthActionProposal.count({ where: { merchantId } }),
    prisma.growthActionProposal.count({ where: { merchantId, actionType: "CROSS_SELL", status: "AUTHORIZED" } }),
    prisma.growthActionProposal.count({ where: { merchantId, actionType: "UPSELL", status: "AUTHORIZED" } }),
    prisma.growthActionProposal.count({ where: { merchantId, actionType: "BUNDLE", status: "AUTHORIZED" } }),
    prisma.growthActionProposal.count({ where: { merchantId, status: { in: [...BLOCKED_STATUSES] } } }),
    // No `opportunity: { not: null }` filter here — Prisma's JSON-null
    // filtering needs `Prisma.DbNull`, and the reducer below already
    // skips rows without a usable delta, so filtering twice adds nothing.
    prisma.growthActionProposal.findMany({
      where: { merchantId, status: { in: [...OPEN_STATUSES] } },
      select: { opportunity: true },
    }),
  ]);

  const opportunityValueMinor = openProposals.reduce((sum, p) => {
    const opp = p.opportunity as OpportunityJson | null;
    // Only same-currency deltas are summed — a mixed-currency total would
    // be a meaningless number, so a foreign-currency proposal is skipped
    // rather than silently added at a 1:1 rate.
    if (!opp || typeof opp.opportunityDeltaMinor !== "number") return sum;
    if (opp.currency && opp.currency !== currency) return sum;
    return sum + opp.opportunityDeltaMinor;
  }, 0);

  // OBSERVED: provider-verified captured money only, on orders that carry
  // provenance back to an authorized agentic proposal.
  const capturedAgenticPayments = await prisma.payment.findMany({
    where: { merchantId, state: "CAPTURED", currency, order: { growthProposalId: { not: null } } },
    select: { amountMinor: true, attemptNumber: true },
  });
  const observedCapturedMinor = capturedAgenticPayments.reduce((sum, p) => sum + p.amountMinor, 0);

  // A "recovered" order is one whose money only arrived on a later
  // bounded retry — the failure-first path actually working.
  const recoveredOrders = capturedAgenticPayments.filter((p) => p.attemptNumber > 1).length;

  return {
    growthOpportunities,
    crossSellsAuthorized,
    upsellsAuthorized,
    bundlesAuthorized,
    recoveredOrders,
    opportunityValue: { amountMinor: opportunityValueMinor, currency },
    observedCapturedValue: { amountMinor: observedCapturedMinor, currency },
    blockedByGovernance,
  };
}
