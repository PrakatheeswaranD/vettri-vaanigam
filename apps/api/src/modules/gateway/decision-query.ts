/**
 * The Decision Log and the four numbers the console shows.
 *
 * HONESTY RULES BAKED IN HERE
 *
 * - Every figure is COMPUTED from Decision Records, never estimated and
 *   never a constant. If there is no data, the value is null and the UI
 *   says so rather than rendering a flattering zero.
 * - "Decisions with a written reason" is measured by actually counting
 *   non-empty explanations, not asserted as 100%. The column is non-null
 *   at the database level, so the honest expectation is 100% — but a
 *   metric that cannot fail proves nothing, and if it ever drops the
 *   console should be able to say so.
 * - Median latency is a real median over recorded latencies, not a mean:
 *   one slow provider call should not flatter or distort the figure.
 * - AOV lift compares APPROVED baskets the negotiator touched against
 *   approved baskets it did not, and returns null when either side is
 *   empty. Declines are excluded deliberately — a basket that was never
 *   sold says nothing about whether upselling raises order value, and
 *   including one large refusal is enough to invert the figure entirely.
 *   There is no control group in a seeded demo, so this is an observed
 *   difference between two sets, never a causal claim.
 */
import type { PrismaClient } from "@prisma/client";

export interface DecisionMetrics {
  totalDecisions: number;
  autoApprovalRatePct: number | null;
  medianDecisionLatencyMs: number | null;
  decisionsWithWrittenReasonPct: number | null;
  negotiatorAovLiftPct: number | null;
  /** Stated plainly so a reader never mistakes these for production stats. */
  basis: string;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1]! + sorted[mid]!) / 2) : sorted[mid]!;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export async function buildDecisionMetrics(prisma: PrismaClient, merchantId: string): Promise<DecisionMetrics> {
  const records = await prisma.decisionRecord.findMany({
    where: { merchantId },
    select: {
      outcome: true,
      explanation: true,
      decisionLatencyMs: true,
      computedTotalMinor: true,
      negotiatedDiscountBps: true,
    },
  });

  if (records.length === 0) {
    return {
      totalDecisions: 0,
      autoApprovalRatePct: null,
      medianDecisionLatencyMs: null,
      decisionsWithWrittenReasonPct: null,
      negotiatorAovLiftPct: null,
      basis: "No agent purchase intents have been received yet.",
    };
  }

  const autoApproved = records.filter((r) => r.outcome === "AUTO_APPROVE").length;
  const withReason = records.filter((r) => r.explanation.trim().length > 0).length;

  // Compare like with like: ONLY approved baskets. An earlier version
  // included declines in the untouched set, which produced a wildly
  // negative "lift" because a single refused ₹51,689 order dwarfed every
  // approved basket. A basket that was never sold says nothing about
  // whether upselling raises order value.
  const approved = records.filter((r) => r.outcome === "AUTO_APPROVE" && r.computedTotalMinor !== null);
  const negotiated = approved.filter((r) => (r.negotiatedDiscountBps ?? 0) > 0).map((r) => r.computedTotalMinor!);
  const untouched = approved.filter((r) => (r.negotiatedDiscountBps ?? 0) === 0).map((r) => r.computedTotalMinor!);

  const negotiatedAov = mean(negotiated);
  const untouchedAov = mean(untouched);
  const aovLift =
    negotiatedAov !== null && untouchedAov !== null && untouchedAov > 0
      ? Number((((negotiatedAov - untouchedAov) / untouchedAov) * 100).toFixed(1))
      : null;

  return {
    totalDecisions: records.length,
    autoApprovalRatePct: Number(((autoApproved / records.length) * 100).toFixed(1)),
    medianDecisionLatencyMs: median(records.map((r) => r.decisionLatencyMs)),
    decisionsWithWrittenReasonPct: Number(((withReason / records.length) * 100).toFixed(1)),
    negotiatorAovLiftPct: aovLift,
    basis:
      "Computed from this merchant's own Decision Records in a seeded test environment. Illustrative of the mechanism, not production performance.",
  };
}

export interface DecisionLogEntry {
  id: string;
  outcome: string;
  reasonCode: string;
  explanation: string;
  protocol: string | null;
  externalAgentId: string | null;
  agentTrust: string | null;
  computedTotalMinor: number | null;
  claimedTotalMinor: number | null;
  appliedCeilingMinor: number | null;
  currency: string | null;
  stepUpPaymentLinkUrl: string | null;
  providerOrderId: string | null;
  negotiatedDiscountBps: number | null;
  rawProtocolPayload: unknown;
  protocolActorRef: string | null;
  permissionType: string | null;
  buyerEmail: string | null;
  decisionLatencyMs: number;
  createdAt: string;
}

export async function listDecisionRecords(
  prisma: PrismaClient,
  merchantId: string,
  params: { limit: number; outcome?: "AUTO_APPROVE" | "STEP_UP" | "DECLINE" },
): Promise<{ items: DecisionLogEntry[] }> {
  const rows = await prisma.decisionRecord.findMany({
    where: { merchantId, ...(params.outcome ? { outcome: params.outcome } : {}) },
    orderBy: { createdAt: "desc" },
    take: params.limit,
  });

  return {
    items: rows.map((r) => ({
      id: r.id,
      outcome: r.outcome,
      reasonCode: r.reasonCode,
      explanation: r.explanation,
      protocol: r.protocol,
      externalAgentId: r.externalAgentId,
      agentTrust: r.agentTrust,
      computedTotalMinor: r.computedTotalMinor,
      claimedTotalMinor: r.claimedTotalMinor,
      appliedCeilingMinor: r.appliedCeilingMinor,
      currency: r.currency,
      stepUpPaymentLinkUrl: r.stepUpPaymentLinkUrl,
      providerOrderId: r.providerOrderId,
      negotiatedDiscountBps: r.negotiatedDiscountBps,
      rawProtocolPayload: r.rawProtocolPayload,
      protocolActorRef: r.protocolActorRef,
      permissionType: r.permissionType,
      buyerEmail: r.buyerEmail,
      decisionLatencyMs: r.decisionLatencyMs,
      createdAt: r.createdAt.toISOString(),
    })),
  };
}
