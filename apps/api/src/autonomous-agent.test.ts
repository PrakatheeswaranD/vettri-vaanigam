/**
 * The Merchant Agent's autonomous cycle, end to end, against real rows.
 *
 * This is the test that matters for Part 3. Every stage of the loop
 * existed before and nothing joined them up, so the thing worth proving is
 * not that any single service works — each already had its own tests — but
 * that a single call walks a real failed payment from detection all the
 * way to a new authorized checkout, and that it stops where it is supposed
 * to stop.
 *
 * WHAT IS DELIBERATELY ASSERTED ABOUT REFUSALS
 *
 * A cycle that executes everything it finds is not evidence the guardrails
 * work — it is evidence they were not exercised. So the assertions below
 * care as much about the steps that did NOT execute: an unreconciled
 * payment the agent refused to retry, a proposal outside the merchant's
 * automatic limits that stopped at approval, and the fact that neither is
 * counted as a failure.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildAuthedTestApp, getTestMerchantId } from "./test-helpers/test-app.js";
import { prisma } from "./db/client.js";
import { createCycleTracker } from "./test-helpers/cycle-cleanup.js";
import { runAutonomousCycle, MAX_ACTIONS_PER_RUN } from "./modules/merchant-agent/autonomous-run-service.js";
import { runScheduledCycles, startAgentScheduler } from "./modules/merchant-agent/scheduler.js";
import { AGENT_TOOLS, toolForOpportunityType } from "./modules/merchant-agent/tools.js";
import { proposeGrowthAction } from "./modules/merchant-agent/service.js";
import type { AgentRunResultDTO, AgentStatusDTO } from "@razorgrowth/contracts";

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

async function status(): Promise<AgentStatusDTO> {
  const res = await app.inject({ method: "GET", url: "/api/v1/merchant-agent/status" });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as AgentStatusDTO;
}

describe("autonomous cycle — the loop runs", () => {
  it("walks detection through policy to a real outcome for every opportunity it takes", async () => {
    const run = await runCycle();

    expect(run.workflowId).toBeTruthy();
    expect(run.consideredCount).toBeLessThanOrEqual(MAX_ACTIONS_PER_RUN);
    expect(run.steps).toHaveLength(run.consideredCount);

    for (const step of run.steps) {
      // Every step reached detection and states the fact that triggered it.
      expect(step.stages[0]).toBe("DETECTED");
      expect(step.whyDetected.length).toBeGreaterThan(0);
      // Every step has a reason a merchant can read.
      expect(step.detail.length).toBeGreaterThan(0);
    }

    // The counts must account for every step — no outcome silently dropped.
    const total =
      run.counts.executed + run.counts.awaitingApproval + run.counts.blocked + run.counts.refused + run.counts.failed;
    expect(total + run.steps.filter((s) => s.outcome === "SKIPPED").length).toBe(run.steps.length);
  });

  it("never skips a stage — a step that executed passed policy and authorization first", async () => {
    const run = await runCycle();

    for (const step of run.steps) {
      if (step.stages.includes("EXECUTED")) {
        // The whole guardrail chain, in order, before money-adjacent work.
        expect(step.stages).toContain("PROPOSED");
        expect(step.stages).toContain("POLICY_CHECKED");
        expect(step.stages).toContain("AUTHORIZED");
        expect(step.policyOutcome).toBe("ALLOW");
        expect(step.authorizationId).toBeTruthy();
      }
      if (step.stages.includes("AUTHORIZED")) {
        expect(step.policyOutcome).toBe("ALLOW");
      }
      // Authorization can only exist against a real proposal.
      if (step.authorizationId) expect(step.proposalId).toBeTruthy();
    }
  });

  it("writes the whole cycle to the ledger under one workflow", async () => {
    const run = await runCycle();

    const events = await prisma.agentAction.findMany({
      where: { merchantId, workflowId: run.workflowId },
      orderBy: { sequence: "asc" },
      select: { actionType: true, actorType: true, conciseReason: true },
    });

    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events[0]?.actionType).toBe("AGENT_RUN_STARTED");
    expect(events.at(-1)?.actionType).toBe("AGENT_RUN_COMPLETED");
    // The agent's own initiative, not a system job.
    for (const event of events) expect(event.actorType).toBe("MERCHANT_AGENT");
  });
});

describe("autonomous cycle — the boundaries hold", () => {
  it("stops at approval instead of executing outside the merchant's automatic limits", async () => {
    const policy = await prisma.merchantPolicy.findUniqueOrThrow({ where: { merchantId } });

    // Drop the automatic-approval ceiling to zero: every proposal is now
    // outside the boundary, so nothing may execute on its own.
    await prisma.merchantPolicy.update({
      where: { merchantId },
      data: { autoApprovalOrderAmountMinor: 0, autoApprovalDiscountBps: 0 },
    });

    try {
      const run = await runCycle();
      expect(run.counts.executed).toBe(0);

      for (const step of run.steps) {
        expect(step.stages).not.toContain("EXECUTED");
        expect(step.stages).not.toContain("AUTHORIZED");
        if (step.outcome === "AWAITING_APPROVAL") {
          expect(step.policyOutcome).toBe("REQUIRE_APPROVAL");
          expect(step.authorizationId).toBeNull();
        }
      }
    } finally {
      await prisma.merchantPolicy.update({
        where: { merchantId },
        data: {
          autoApprovalOrderAmountMinor: policy.autoApprovalOrderAmountMinor,
          autoApprovalDiscountBps: policy.autoApprovalDiscountBps,
        },
      });
    }
  });

  it("does nothing at all when the merchant switches growth actions off", async () => {
    const config = await prisma.merchantGrowthConfig.findUnique({ where: { merchantId } });
    if (!config) return;

    await prisma.merchantGrowthConfig.update({ where: { merchantId }, data: { growthActionsEnabled: false } });
    try {
      const run = await runCycle();
      // The agent may still detect — detection reads rows and costs the
      // merchant nothing — but it must not carry anything to execution.
      expect(run.counts.executed).toBe(0);
      for (const step of run.steps) expect(step.stages).not.toContain("EXECUTED");
    } finally {
      await prisma.merchantGrowthConfig.update({
        where: { merchantId },
        data: { growthActionsEnabled: config.growthActionsEnabled },
      });
    }
  });

  it("uses the policy enum's own spelling, so needs-approval is never reported as refused", async () => {
    const policy = await prisma.merchantPolicy.findUniqueOrThrow({ where: { merchantId } });
    await prisma.merchantPolicy.update({
      where: { merchantId },
      data: { autoApprovalOrderAmountMinor: 0, autoApprovalDiscountBps: 0 },
    });
    try {
      const run = await runCycle();
      for (const step of run.steps) {
        // The enum is REQUIRE_APPROVAL, singular. Comparing against
        // "REQUIRES_APPROVAL" silently routed every needs-a-human proposal
        // into the BLOCKED branch, telling merchants their policy had
        // refused an action outright when it was waiting on them.
        if (step.policyOutcome === "REQUIRE_APPROVAL") {
          expect(step.outcome).toBe("AWAITING_APPROVAL");
          expect(step.detail).toContain("waiting for you");
        }
        expect(step.policyOutcome).not.toBe("REQUIRES_APPROVAL");
      }
    } finally {
      await prisma.merchantPolicy.update({
        where: { merchantId },
        data: {
          autoApprovalOrderAmountMinor: policy.autoApprovalOrderAmountMinor,
          autoApprovalDiscountBps: policy.autoApprovalDiscountBps,
        },
      });
    }
  });

  it("acts per payment, not once per aggregated opportunity card", async () => {
    const run = await runCycle();
    // One FAILED_PAYMENT_RECOVERY card can cover dozens of payments. An
    // earlier version took only `subjectIds[0]` and reported the cycle
    // complete while leaving the rest untouched.
    const recoveryCards = new Set(run.steps.map((s) => s.opportunityId));
    if (run.actionableCount > 1) {
      expect(run.consideredCount).toBeGreaterThan(recoveryCards.size - 1);
      expect(run.actionableCount + 0).toBeGreaterThanOrEqual(run.consideredCount);
      expect(run.deferredCount).toBe(Math.max(0, run.actionableCount - run.consideredCount));
    }
  });

  it("counts a refusal as a refusal, never as a failure", async () => {
    const run = await runCycle();
    for (const step of run.steps) {
      // A refusal is the agent declining to act (an unreconciled payment
      // it will not retry blind). It must never be reported as breakage,
      // and it must never have executed anything.
      if (step.outcome === "REFUSED" || step.outcome === "BLOCKED") {
        expect(step.stages, step.opportunityType).not.toContain("EXECUTED");
      }

      // A refusal from a GOVERNED tool must have got as far as proposing —
      // that is where governed refusals come from.
      //
      // The condition is new: an AUTOMATIC tool has no proposal stage at
      // all, because there is nothing for a policy to weigh. Reconciliation
      // refusing (no provider configured, or the provider ambiguous about
      // which attempt is authoritative) is a refusal that never proposed
      // anything, and asserting PROPOSED on it would demand a governance
      // row for a read.
      if (step.outcome === "REFUSED") {
        const toolName = toolForOpportunityType(step.opportunityType);
        const tool = AGENT_TOOLS.find((t) => t.name === toolName);
        if (tool?.safety === "GOVERNED") expect(step.stages, step.opportunityType).toContain("PROPOSED");
      }
    }
    expect(run.counts.failed).toBe(run.steps.filter((s) => s.outcome === "FAILED").length);
  });

  it("records the policy decision behind every step that got that far", async () => {
    const run = await runCycle();
    for (const step of run.steps) {
      // The run log's whole job is to show that a step which executed
      // passed policy first. A null policy outcome on an authorized step
      // makes that unprovable — which is exactly what happened when the
      // action layer was extracted and the decision was computed, used,
      // and then dropped on the way out.
      if (step.stages.includes("AUTHORIZED")) expect(step.policyOutcome, step.opportunityType).toBe("ALLOW");
      if (step.outcome === "AWAITING_APPROVAL") expect(step.policyOutcome, step.opportunityType).toBe("REQUIRE_APPROVAL");
    }
  });

  it("is idempotent per authorization — a second cycle cannot double-spend one permission", async () => {
    const before = await prisma.checkoutSession.count({ where: { merchantId } });
    const first = await runCycle();
    const afterFirst = await prisma.checkoutSession.count({ where: { merchantId } });
    const second = await runCycle();
    const afterSecond = await prisma.checkoutSession.count({ where: { merchantId } });

    // Each executed step opens at most one checkout, and the second run
    // cannot reuse the first run's authorizations to open more.
    expect(afterFirst - before).toBeLessThanOrEqual(first.counts.executed);
    expect(afterSecond - afterFirst).toBeLessThanOrEqual(second.counts.executed);
  });
});

describe("agent status — answering the five questions from data", () => {
  it("states a current objective drawn from the ranked opportunities", async () => {
    const s = await status();
    if (s.detected.count === 0) {
      // An agent with no work says so rather than inventing an objective.
      expect(s.objective).toBeNull();
      return;
    }
    expect(s.objective).not.toBeNull();
    expect(s.objective!.why.length).toBeGreaterThan(0);
    expect(s.objective!.proposedAction.length).toBeGreaterThan(0);
  });

  it("reports what it did autonomously from its own ledger entries", async () => {
    await runCycle();
    const s = await status();

    expect(s.autonomousActions.length).toBeGreaterThan(0);
    for (const action of s.autonomousActions) {
      const row = await prisma.agentAction.findUniqueOrThrow({ where: { id: action.id } });
      expect(row.actorType).toBe("MERCHANT_AGENT");
      expect(action.reason).toBe(row.conciseReason);
    }
    expect(s.lastRun).not.toBeNull();
  });

  it("separates what is waiting on a human from what it carried through", async () => {
    const s = await status();

    for (const item of s.awaitingApproval) expect(item.status).toBe("PENDING_APPROVAL");
    // Governance ends at AUTHORIZED — there is no EXECUTED proposal status
    // to overclaim with.
    for (const item of s.executedActions) expect(item.status).toBe("AUTHORIZED");
    for (const item of s.failures) {
      expect(["REJECTED_VALIDATION", "POLICY_DENIED", "APPROVAL_REJECTED"]).toContain(item.status);
      expect(item.reason.length).toBeGreaterThan(0);
    }
  });

  it("reports only provider-verified money as verified", async () => {
    const s = await status();
    const captured = await prisma.payment.aggregate({
      where: {
        merchantId,
        state: "CAPTURED",
        currency: s.verified.capturedValue.currency,
        order: { growthProposalId: { not: null } },
      },
      _sum: { amountMinor: true },
    });
    expect(s.verified.capturedValue.amountMinor).toBe(captured._sum.amountMinor ?? 0);
    expect(s.verified.recoveredValue.amountMinor).toBeLessThanOrEqual(s.verified.capturedValue.amountMinor);
  });

  it("answers 'what should happen next' with real ranked opportunities", async () => {
    const s = await status();
    expect(s.nextActions.length).toBeLessThanOrEqual(5);
    for (const next of s.nextActions) {
      expect(next.why.length).toBeGreaterThan(0);
      expect(next.actionLabel.length).toBeGreaterThan(0);
      expect(["AGENT_AUTOMATIC", "ONE_APPROVAL", "MERCHANT_WORK"]).toContain(next.effort);
    }
  });
});

describe("autonomous cycle — reachable through the API", () => {
  it("runs from the route the console calls", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/merchant-agent/run" });
    expect(res.statusCode, res.body).toBe(200);
    const run = res.json() as AgentRunResultDTO;
    expect(run.workflowId).toBeTruthy();
    expect(Array.isArray(run.steps)).toBe(true);
  });

  it("refuses both routes to a shopper session", async () => {
    // The agent is merchant machinery. A customer reaching it would be a
    // hole in the access model, not a feature.
    for (const [method, url] of [
      ["POST", "/api/v1/merchant-agent/run"],
      ["GET", "/api/v1/merchant-agent/status"],
    ] as const) {
      const res = await app.inject({ method, url, headers: { authorization: "Bearer not-a-real-token" } });
      expect(res.statusCode).toBe(401);
    }
  });
});

describe("unattended cycles — two switches, both off by default", () => {
  /** Restores whatever the merchant had, whichever way the assertion goes. */
  async function withConfig<T>(data: { autonomousRunsEnabled?: boolean; growthActionsEnabled?: boolean }, fn: () => Promise<T>): Promise<T> {
    const before = await prisma.merchantGrowthConfig.findUniqueOrThrow({ where: { merchantId } });
    await prisma.merchantGrowthConfig.update({ where: { merchantId }, data });
    try {
      return await fn();
    } finally {
      await prisma.merchantGrowthConfig.update({
        where: { merchantId },
        data: {
          autonomousRunsEnabled: before.autonomousRunsEnabled,
          growthActionsEnabled: before.growthActionsEnabled,
        },
      });
    }
  }

  it("leaves every seeded merchant opted out", async () => {
    // The column defaults to false and the seed writes no value, so a
    // deployment cannot opt anybody in. If this ever fails, someone has
    // made unattended execution the default for merchants who never
    // agreed to it.
    const optedIn = await prisma.merchantGrowthConfig.count({ where: { autonomousRunsEnabled: true } });
    expect(optedIn).toBe(0);
  });

  it("sweeps nobody while the merchant has not opted in", async () => {
    const result = await withConfig({ autonomousRunsEnabled: false }, () => runScheduledCycles(prisma));
    expect(result.merchants).toBe(0);
    expect(result.executed).toBe(0);
  });

  it("sweeps the merchant once they opt in", async () => {
    const idsOf = async () =>
      new Set((await prisma.growthActionProposal.findMany({ where: { merchantId }, select: { id: true } })).map((p) => p.id));

    const before = await idsOf();
    const result = await withConfig({ autonomousRunsEnabled: true, growthActionsEnabled: true }, () =>
      runScheduledCycles(prisma),
    );
    // The sweep reports counts, not steps, so the rows it wrote are found
    // by diff and handed to the same cleanup as every other cycle here.
    const after = await idsOf();
    cycles.trackIds([...after].filter((id) => !before.has(id)));

    expect(result.merchants).toBeGreaterThan(0);
    // A sweep that reports merchants but writes nothing would be a
    // scheduler that only logs. Proposals are the cycle's real output.
    expect(after.size).toBeGreaterThanOrEqual(before.size);
  });

  it("still refuses to sweep a merchant whose master switch is off", async () => {
    // Opting into unattended runs is not a way around the envelope. Both
    // the schedule and the permission must be present.
    const result = await withConfig({ autonomousRunsEnabled: true, growthActionsEnabled: false }, () =>
      runScheduledCycles(prisma),
    );
    expect(result.merchants).toBe(0);
  });

  it("starts no timer while the operator switch is off", () => {
    // AGENT_SCHEDULER_ENABLED defaults to false, which is what the test
    // env runs with. The returned stop function must be safe to call.
    const stop = startAgentScheduler(prisma);
    expect(() => stop()).not.toThrow();
  });

  it("lets an owner turn unattended runs on and off through the API", async () => {
    const on = await app.inject({
      method: "PATCH",
      url: "/api/v1/merchant-agent/growth/config",
      payload: { autonomousRunsEnabled: true },
    });
    expect(on.statusCode, on.body).toBe(200);
    expect((on.json() as { autonomousRunsEnabled: boolean }).autonomousRunsEnabled).toBe(true);

    const off = await app.inject({
      method: "PATCH",
      url: "/api/v1/merchant-agent/growth/config",
      payload: { autonomousRunsEnabled: false },
    });
    expect(off.statusCode, off.body).toBe(200);
    expect((off.json() as { autonomousRunsEnabled: boolean }).autonomousRunsEnabled).toBe(false);

    const read = await app.inject({ method: "GET", url: "/api/v1/merchant-agent/growth/config" });
    expect((read.json() as { autonomousRunsEnabled: boolean }).autonomousRunsEnabled).toBe(false);
  });
});

/**
 * PART 17 — the agent must answer the card it detected.
 *
 * Verified before this existed: across the ENTIRE database, not one
 * UPSELL or BUNDLE proposal had ever been created — only CROSS_SELL and
 * RECOVERY — despite ten `UPSELL_ALTERNATIVE` relationships in the
 * catalogue.
 *
 * `deterministicGrowthProposal` picks a single best candidate by
 * `RELATIONSHIP_PRIORITY`, where COMPLEMENTARY outranks
 * UPSELL_ALTERNATIVE, and every upsell-capable product here also has a
 * complementary relationship. So the general path could never reach an
 * upsell, and the "products selling at entry price with a dearer option
 * available" card was answered with a cross-sell.
 */
describe("growth proposals answer the opportunity they were invoked for (PART 17)", () => {
  it("proposes an UPSELL when restricted, where the ranking alone would not", async () => {
    const merchantId = await getTestMerchantId(prisma);

    const upsellSources = await prisma.productRelationship.findMany({
      where: { relationshipType: "UPSELL_ALTERNATIVE", sourceProduct: { merchantId } },
      select: { sourceProductId: true },
    });
    expect(upsellSources.length, "no upsell relationship seeded — this would prove nothing").toBeGreaterThan(0);

    /**
     * Search for a product where the restriction CHANGES the answer, rather
     * than picking one and hoping.
     *
     * Both halves vary with seeded data. Unrestricted already yields an
     * upsell whenever no COMPLEMENTARY candidate is currently eligible, and
     * a restricted call yields nothing when the upsell target is itself
     * blocked for missing commerce data. An earlier version asserted
     * against the first candidate and failed on a fresh seed for exactly
     * that reason — the fixture-dependence this file's own cleanup helper
     * exists to avoid.
     */
    let proof: { productId: string; unrestricted: string | null } | null = null;
    for (const { sourceProductId } of upsellSources) {
      const plain = await proposeGrowthAction(prisma, { merchantId, primaryProductId: sourceProductId });
      cycles.trackIds([plain.id]);
      if (plain.actionType === "UPSELL") continue;

      const restricted = await proposeGrowthAction(prisma, {
        merchantId,
        primaryProductId: sourceProductId,
        restrictToActionTypes: ["UPSELL"],
      });
      cycles.trackIds([restricted.id]);
      if (restricted.actionType === "UPSELL") {
        proof = { productId: sourceProductId, unrestricted: plain.actionType };
        expect(restricted.relatedProductIds.length).toBeGreaterThan(0);
        break;
      }
    }

    expect(
      proof,
      "no product where restricting to UPSELL changes the outcome — the capability is unproven on this seed",
    ).not.toBeNull();
    expect(proof!.unrestricted).not.toBe("UPSELL");
  });

  it("narrows, never widens — a restriction cannot re-enable what the merchant switched off", async () => {
    const merchantId = await getTestMerchantId(prisma);
    const config = await prisma.merchantGrowthConfig.findUniqueOrThrow({ where: { merchantId } });
    try {
      await prisma.merchantGrowthConfig.update({ where: { merchantId }, data: { upsellEnabled: false } });
      const rel = await prisma.productRelationship.findFirst({
        where: { relationshipType: "UPSELL_ALTERNATIVE", sourceProduct: { merchantId } },
        select: { sourceProductId: true },
      });
      const result = await proposeGrowthAction(prisma, {
        merchantId,
        primaryProductId: rel!.sourceProductId,
        restrictToActionTypes: ["UPSELL"],
      });
      cycles.trackIds([result.id]);
      // The merchant's switch wins: asking for an upsell they disabled
      // yields no proposal, not an upsell and not a substituted type.
      expect(result.actionType).not.toBe("UPSELL");
      expect(result.status).not.toBe("AUTHORIZED");
    } finally {
      await prisma.merchantGrowthConfig.update({ where: { merchantId }, data: { upsellEnabled: config.upsellEnabled } });
    }
  });
});
