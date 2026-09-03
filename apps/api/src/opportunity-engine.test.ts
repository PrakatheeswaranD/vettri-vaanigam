/**
 * REAL DATA → DETECTION → EVIDENCE → OPPORTUNITY → PRIORITIZATION → AGENT ACTION.
 *
 * The domain tests pin the arithmetic of each detector against hand-written
 * facts. These pin the thing only an integration can: that opportunities
 * detected from this merchant's actual rows are the same opportunities the
 * Merchant Agent then acts on, and that acting on one changes what the
 * engine reports next time.
 *
 * WHY THAT LAST PART MATTERS
 *
 * An engine whose output never changes after the agent works is an engine
 * nobody is consuming. Before this suite existed, eight of the nine
 * detectors produced cards that no code path anywhere could act on — they
 * were computed, ranked, rendered, and left for a merchant to find by hand.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildAuthedTestApp, getTestMerchantId } from "./test-helpers/test-app.js";
import { prisma } from "./db/client.js";
import type { AgentRunResultDTO } from "@razorgrowth/contracts";
import { createCycleTracker } from "./test-helpers/cycle-cleanup.js";
import { getRevenueOpportunityReport } from "./modules/growth/revenue-evidence-service.js";
import { runAutonomousCycle } from "./modules/merchant-agent/autonomous-run-service.js";

let app: FastifyInstance;
let merchantId: string;
/** Cycles create real governance rows and consume the per-order recovery
 * ceiling. Tracked here and removed in `afterAll` so this file cannot
 * starve `recovery.test.ts`, which runs later and needs a recoverable
 * order. See `cycle-cleanup.ts`. */
const cycles = createCycleTracker();
const runCycle = async (): Promise<AgentRunResultDTO> => cycles.track(await runAutonomousCycle(prisma, merchantId));

beforeAll(async () => {
  app = await buildAuthedTestApp();
  merchantId = await getTestMerchantId(prisma);
});

afterAll(async () => {
  await cycles.cleanup(prisma);
  await app.close();
  await prisma.$disconnect();
});

describe("detection runs on real merchant rows", () => {
  it("produces opportunities whose subjects are rows that actually exist", async () => {
    const { opportunities } = await getRevenueOpportunityReport(prisma, merchantId);
    expect(opportunities.length).toBeGreaterThan(0);

    for (const o of opportunities) {
      if (o.subjectIds.length === 0) continue;
      const [first] = o.subjectIds;
      // Every subject is a payment, an order, a product or a customer —
      // never an id the engine made up. Customer-subject cards
      // (REPEAT_PURCHASE, CUSTOMER_REACTIVATION) are the reason the agent
      // treats them as SURFACE: there is no proposal keyed by customer, so
      // they are reported for a human rather than actioned.
      const exists =
        (await prisma.payment.count({ where: { id: first, merchantId } })) +
        (await prisma.order.count({ where: { id: first, merchantId } })) +
        (await prisma.product.count({ where: { id: first, merchantId } })) +
        (await prisma.customer.count({ where: { id: first, merchantId } }));
      expect(exists, `${o.type} subject ${first}`).toBeGreaterThan(0);
    }
  });

  it("gives every opportunity the full field set a merchant is promised", async () => {
    const { opportunities } = await getRevenueOpportunityReport(prisma, merchantId);

    for (const o of opportunities) {
      expect(o.id.length, o.type).toBeGreaterThan(0);
      expect(o.evidence.length, o.type).toBeGreaterThan(0);
      expect(o.whyDetected.length, o.type).toBeGreaterThan(0);
      expect(o.risk.length, o.type).toBeGreaterThan(0);
      expect(o.actionLabel.length, o.type).toBeGreaterThan(0);
      expect(o.confidence, o.type).toBeGreaterThanOrEqual(0);
      expect(o.urgency, o.type).toBeGreaterThanOrEqual(0);
      expect(typeof o.approvalRequired, o.type).toBe("boolean");
      expect(["DETECTED", "PARTIALLY_ACTIONED", "ACTIONED"], o.type).toContain(o.status);
      expect(o.result === null || typeof o.result === "string", o.type).toBe(true);
      expect(["ELIGIBLE", "REQUIRES_APPROVAL", "BLOCKED"], o.type).toContain(o.policy.outcome);
    }
  });

  it("never states an incremental estimate it has no observed rate for", async () => {
    const { opportunities } = await getRevenueOpportunityReport(prisma, merchantId);

    for (const o of opportunities) {
      const effect = o.expectedEffect;
      if (effect.basis === "INSUFFICIENT_EVIDENCE") {
        // The single rule the whole engine exists to enforce.
        expect(effect.expectedIncrementalValue, o.type).toBeNull();
        expect(effect.method.length, o.type).toBeGreaterThan(0);
      } else {
        expect(effect.expectedIncrementalValue, o.type).not.toBeNull();
        expect(effect.sampleSize, o.type).toBeGreaterThan(0);
      }
    }
  });

  it("ranks by priority, with policy-blocked work sorted below everything eligible", async () => {
    const { opportunities } = await getRevenueOpportunityReport(prisma, merchantId);
    const blockedIndex = opportunities.findIndex((o) => o.policy.outcome === "BLOCKED");
    if (blockedIndex >= 0) {
      for (let i = blockedIndex; i < opportunities.length; i += 1) {
        expect(opportunities[i]!.policy.outcome).toBe("BLOCKED");
      }
    }
    const eligible = opportunities.filter((o) => o.policy.outcome !== "BLOCKED");
    for (let i = 1; i < eligible.length; i += 1) {
      expect(eligible[i - 1]!.score.priority).toBeGreaterThanOrEqual(eligible[i]!.score.priority);
    }
  });

  it("never contradicts itself about whether a human is needed", async () => {
    const { opportunities } = await getRevenueOpportunityReport(prisma, merchantId);
    for (const o of opportunities) {
      if (o.policy.outcome === "REQUIRES_APPROVAL") expect(o.approvalRequired, o.type).toBe(true);
      if (o.effort !== "AGENT_AUTOMATIC") expect(o.approvalRequired, o.type).toBe(true);
      if (!o.approvalRequired) {
        expect(o.effort, o.type).toBe("AGENT_AUTOMATIC");
        expect(o.policy.outcome, o.type).not.toBe("REQUIRES_APPROVAL");
      }
    }
  });
});

describe("detected opportunities reach the agent", () => {
  it("works more than one kind of opportunity in a single cycle", async () => {
    const run = await runCycle();
    const kinds = new Set(run.steps.map((s) => s.opportunityType));

    // The regression this guards: a flat slice of a priority-ordered list
    // spent every cycle inside the highest-ranked card, so the other
    // detected types were never acted on in any cycle at all.
    if (run.actionableCount > run.consideredCount) {
      expect(kinds.size).toBeGreaterThan(1);
    }
  });

  it("acts only on opportunities the engine actually detected", async () => {
    const { opportunities } = await getRevenueOpportunityReport(prisma, merchantId);
    const detectedIds = new Set(opportunities.map((o) => o.id));

    const run = await runCycle();
    for (const step of run.steps) {
      expect(detectedIds, step.opportunityType).toContain(step.opportunityId);
    }
  });

  it("carries the detection's own reason into the action it takes", async () => {
    const run = await runCycle();
    const { opportunities } = await getRevenueOpportunityReport(prisma, merchantId);

    for (const step of run.steps) {
      const source = opportunities.find((o) => o.id === step.opportunityId);
      if (!source) continue;
      // "Why did you do it?" must be answerable from the run log alone,
      // in the engine's own words rather than a restatement.
      expect(step.whyDetected).toBe(source.whyDetected);
    }
  });

  it("turns detection into real governance rows, not just log lines", async () => {
    const run = await runCycle();
    const withProposals = run.steps.filter((s) => s.proposalId);

    for (const step of withProposals) {
      const proposal = await prisma.growthActionProposal.findUnique({ where: { id: step.proposalId! } });
      expect(proposal, step.proposalId!).not.toBeNull();
      expect(proposal!.merchantId).toBe(merchantId);
    }
    if (run.consideredCount > 0) expect(withProposals.length).toBeGreaterThan(0);
  });
});

describe("acting on an opportunity changes what the engine reports", () => {
  it("moves a card off DETECTED once its subjects carry proposals", async () => {
    await runCycle();
    const { opportunities } = await getRevenueOpportunityReport(prisma, merchantId);

    // At least one card must reflect the work. An engine whose output is
    // identical before and after the agent runs is an engine nothing is
    // consuming.
    const touched = opportunities.filter((o) => o.status !== "DETECTED");
    expect(touched.length).toBeGreaterThan(0);
    for (const o of touched) {
      expect(o.result, o.type).not.toBeNull();
    }
  });

  it("derives status from the same proposal rows governance reads", async () => {
    const { opportunities } = await getRevenueOpportunityReport(prisma, merchantId);
    const actioned = opportunities.filter((o) => o.status !== "DETECTED");

    for (const o of actioned) {
      const proposalCount = await prisma.growthActionProposal.count({
        where: {
          merchantId,
          OR: [
            { primaryProductId: { in: o.subjectIds } },
            { sourcePaymentId: { in: o.subjectIds } },
            { sourceOrderId: { in: o.subjectIds } },
          ],
        },
      });
      // Status is never asserted independently of the table it claims to
      // reflect.
      expect(proposalCount, o.type).toBeGreaterThan(0);
    }
  });
});

describe("the retired catalogue scanner is gone", () => {
  it("no longer serves its endpoint", async () => {
    // Its four categories are all covered by the revenue engine now —
    // CROSS_SELL, UPSELL, PRODUCT_DISCOVERY and AI_BUYER_READINESS — so
    // keeping a second feed would be two answers to one question.
    const res = await app.inject({ method: "GET", url: "/api/v1/growth/opportunities" });
    expect(res.statusCode).toBe(404);
  });

  it("still serves the engine that replaced it", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/growth/revenue-opportunities" });
    expect(res.statusCode).toBe(200);
  });
});
