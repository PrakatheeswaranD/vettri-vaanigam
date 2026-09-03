/**
 * The Overview's data chain: DATABASE → BACKEND → API.
 *
 * The Merchant Overview tells a four-stage story — observed business
 * state, what the agent detected, what it did automatically, what was
 * verified. Every stage has to come from real rows, because the one
 * failure this page cannot survive is showing a merchant a revenue figure
 * that nothing in the database supports.
 *
 * So these tests do not assert that the endpoints respond. They assert
 * that each number the Overview prints is reproducible from Prisma by an
 * independent query, and that the classifications the page relies on —
 * OBSERVED vs ESTIMATED vs OPPORTUNITY vs VERIFIED — are not blurred by
 * the payloads that feed it.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildAuthedTestApp, getTestMerchantId } from "./test-helpers/test-app.js";
import { prisma } from "./db/client.js";
import type { GrowthSummaryDTO } from "@razorgrowth/contracts";

let app: FastifyInstance;
let merchantId: string;

beforeAll(async () => {
  app = await buildAuthedTestApp();
  merchantId = await getTestMerchantId(prisma);
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

async function summary(): Promise<GrowthSummaryDTO> {
  const res = await app.inject({ method: "GET", url: "/api/v1/growth/summary" });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as GrowthSummaryDTO;
}

interface RevenueReport {
  opportunities: Array<{
    id: string;
    type: string;
    whyDetected: string;
    proposedAction: string;
    actionLabel: string;
    evidence: unknown[];
    risk: string;
    policy: { outcome: string };
    expectedEffect: {
      atRiskValue: { amountMinor: number } | null;
      addressableValue: { amountMinor: number } | null;
      expectedIncrementalValue: { amountMinor: number } | null;
      basis: string;
    };
  }>;
  totals: {
    currency: string;
    opportunityCount: number;
    totalAtRiskMinor: number;
    totalAddressableMinor: number;
    totalExpectedIncrementalMinor: number;
    withheldEstimateCount: number;
  };
  growthScore: { score: number; components: unknown[] };
  aiBuyerScore: { score: number; components: unknown[] };
  observed: { currency: string; capturedRevenueMinor: number; paidOrderCount: number };
}

async function report(): Promise<RevenueReport> {
  const res = await app.inject({ method: "GET", url: "/api/v1/growth/revenue-opportunities" });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as RevenueReport;
}

describe("Overview — observed business state", () => {
  it("reports captured revenue that is reproducible from CAPTURED payments alone", async () => {
    const { observed } = await report();
    const captured = await prisma.payment.aggregate({
      where: { merchantId, state: "CAPTURED", currency: observed.currency as "INR" | "USD" },
      _sum: { amountMinor: true },
    });
    expect(observed.capturedRevenueMinor).toBe(captured._sum.amountMinor ?? 0);
  });

  it("counts paid orders from order status, not from payment attempts", async () => {
    const { observed } = await report();
    expect(observed.paidOrderCount).toBe(await prisma.order.count({ where: { merchantId, status: "PAID" } }));
  });
});

describe("Overview — agent-detected opportunities", () => {
  it("gives every opportunity the four things the page has to render", async () => {
    const { opportunities } = await report();
    for (const opportunity of opportunities) {
      // "What did the agent detect?" / "Why?" / "What should happen next?"
      expect(opportunity.whyDetected.length, opportunity.id).toBeGreaterThan(0);
      expect(opportunity.risk.length, opportunity.id).toBeGreaterThan(0);
      expect(opportunity.actionLabel.length, opportunity.id).toBeGreaterThan(0);
      // Every actionable opportunity connects to a real named action.
      expect(opportunity.proposedAction, opportunity.id).toBeTruthy();
    }
  });

  it("never states an incremental estimate without an evidence basis", async () => {
    const { opportunities } = await report();
    for (const opportunity of opportunities) {
      if (opportunity.expectedEffect.expectedIncrementalValue) {
        // An ESTIMATED figure is only allowed where the merchant's own
        // history supports a rate. Anything else would be a fabrication
        // dressed as a projection.
        expect(opportunity.expectedEffect.basis, opportunity.id).not.toBe("INSUFFICIENT_EVIDENCE");
      }
    }
  });

  it("keeps at-risk, addressable and estimated totals separate and never sums them", async () => {
    const { totals, opportunities } = await report();
    const atRisk = opportunities.reduce((sum, o) => sum + (o.expectedEffect.atRiskValue?.amountMinor ?? 0), 0);
    const addressable = opportunities.reduce((sum, o) => sum + (o.expectedEffect.addressableValue?.amountMinor ?? 0), 0);
    const incremental = opportunities.reduce((sum, o) => sum + (o.expectedEffect.expectedIncrementalValue?.amountMinor ?? 0), 0);

    expect(totals.totalAtRiskMinor).toBe(atRisk);
    expect(totals.totalAddressableMinor).toBe(addressable);
    expect(totals.totalExpectedIncrementalMinor).toBe(incremental);
    expect(totals.opportunityCount).toBe(opportunities.length);
    // The count of cards that had to withhold an estimate is stated, so
    // the console can say so rather than showing a quietly-low total.
    expect(totals.withheldEstimateCount).toBe(
      opportunities.filter((o) => !o.expectedEffect.expectedIncrementalValue).length,
    );
  });

  it("scores the merchant and their AI-buyer readiness with visible components", async () => {
    const { growthScore, aiBuyerScore } = await report();
    for (const score of [growthScore, aiBuyerScore]) {
      expect(score.score).toBeGreaterThanOrEqual(0);
      expect(score.score).toBeLessThanOrEqual(100);
      // A score with no components is a number a merchant cannot argue
      // with, which is the same as a number they cannot trust.
      expect(score.components.length).toBeGreaterThan(0);
    }
  });
});

describe("Overview — automated actions", () => {
  it("counts only what the Merchant Agent itself decided to do", async () => {
    const { automatedActions } = await summary();
    for (const action of automatedActions) {
      const real = await prisma.agentAction.count({
        where: { merchantId, actorType: "MERCHANT_AGENT", actionType: action.actionType },
      });
      expect(action.count, action.actionType).toBe(real);
    }
    // Nothing written by SYSTEM, COMMERCE or a human may appear here.
    const agentTypes = new Set(automatedActions.map((a) => a.actionType));
    const nonAgent = await prisma.agentAction.findMany({
      where: { merchantId, actorType: { not: "MERCHANT_AGENT" } },
      select: { actionType: true },
      distinct: ["actionType"],
    });
    for (const row of nonAgent) {
      const alsoAgent = await prisma.agentAction.count({
        where: { merchantId, actorType: "MERCHANT_AGENT", actionType: row.actionType },
      });
      if (alsoAgent === 0) expect(agentTypes.has(row.actionType), row.actionType).toBe(false);
    }
  });

  it("agrees with the approvals queue about how much is waiting on a human", async () => {
    const { pendingApprovals } = await summary();
    const queue = await app.inject({ method: "GET", url: "/api/v1/approvals/pending?limit=50" });
    expect(queue.statusCode).toBe(200);
    const items = (queue.json() as { items: unknown[] }).items;
    // The Overview says "N waiting"; the queue lists them. If those two
    // disagree, one of the screens is lying to the merchant.
    expect(pendingApprovals).toBe(items.length);
  });
});

describe("Overview — verified results", () => {
  it("only counts provider-verified captured money as observed", async () => {
    const { observedCapturedValue } = await summary();
    const captured = await prisma.payment.aggregate({
      where: {
        merchantId,
        state: "CAPTURED",
        currency: observedCapturedValue.currency,
        order: { growthProposalId: { not: null } },
      },
      _sum: { amountMinor: true },
    });
    expect(observedCapturedValue.amountMinor).toBe(captured._sum.amountMinor ?? 0);
  });

  it("reports recovered value from the same rows it reports recovered orders from", async () => {
    const { recoveredOrders, recoveredValue } = await summary();
    const rows = await prisma.payment.findMany({
      where: {
        merchantId,
        state: "CAPTURED",
        currency: recoveredValue.currency,
        order: { growthProposalId: { not: null } },
        attemptNumber: { gt: 1 },
      },
      select: { amountMinor: true },
    });
    expect(recoveredOrders).toBe(rows.length);
    expect(recoveredValue.amountMinor).toBe(rows.reduce((sum, p) => sum + p.amountMinor, 0));
    // Recovery cannot exceed the captured total it is a subset of.
    expect(recoveredValue.amountMinor).toBeLessThanOrEqual((await summary()).observedCapturedValue.amountMinor);
  });

  it("never reports captured value the payment table cannot account for", async () => {
    const { observedCapturedValue } = await summary();
    const allCaptured = await prisma.payment.aggregate({
      where: { merchantId, state: "CAPTURED", currency: observedCapturedValue.currency },
      _sum: { amountMinor: true },
    });
    // Agentic captured value is a subset of all captured value. A total
    // above it would mean revenue attributed to the agent that the
    // provider never confirmed.
    expect(observedCapturedValue.amountMinor).toBeLessThanOrEqual(allCaptured._sum.amountMinor ?? 0);
  });
});
