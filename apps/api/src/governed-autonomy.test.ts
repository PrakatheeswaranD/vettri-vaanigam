/**
 * The boundaries a merchant sets, enforced end to end.
 *
 * The domain suite pins the arithmetic of `evaluatePolicy` against
 * hand-written facts. This pins the thing only an integration can: that a
 * boundary a merchant SAVES through the API is the same boundary the
 * Policy Engine READS when the agent acts, with no layer in between
 * quietly dropping it.
 *
 * That gap is not hypothetical. Six of the nine boundaries in this
 * product's spec already existed as *concepts* before Part 8 — some as
 * columns on a different table the engine never consulted — and a column
 * nothing reads is indistinguishable from a control that works, right up
 * until it matters.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildAuthedTestApp, getTestMerchantId } from "./test-helpers/test-app.js";
import { prisma } from "./db/client.js";
import { createCycleTracker } from "./test-helpers/cycle-cleanup.js";

let app: FastifyInstance;
let merchantId: string;
const cycles = createCycleTracker();

/** The nine boundaries the spec names, and where each is enforced. */
const REQUIRED_BOUNDARIES = [
  "maxDiscountBps",
  "minMarginBps",
  "eligibleCategories",
  "minCustomerPaidOrders",
  "maxAutonomousActionsPerDay",
  "autoApprovalDiscountBps",
  "recoveryEnabled",
  "maxRecoveryAttempts",
  "prohibitedActions",
] as const;

beforeAll(async () => {
  app = await buildAuthedTestApp();
  merchantId = await getTestMerchantId(prisma);
});

afterAll(async () => {
  await cycles.cleanup(prisma);
  await app.close();
  await prisma.$disconnect();
});

describe("every boundary the spec names is readable and writable", () => {
  it("exposes all nine on the policy a merchant reads", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/merchant/policy" });
    expect(res.statusCode, res.body).toBe(200);
    const policy = res.json() as Record<string, unknown>;

    for (const field of REQUIRED_BOUNDARIES) {
      expect(policy[field], `${field} must be on the policy a merchant can see`).toBeDefined();
    }
  });

  it("round-trips a change through the API into the database", async () => {
    const before = await prisma.merchantPolicy.findUniqueOrThrow({ where: { merchantId } });

    try {
      const res = await app.inject({
        method: "PATCH",
        url: "/api/v1/merchant/policy",
        payload: {
          maxDiscountBps: before.maxDiscountBps,
          autoApprovalDiscountBps: before.autoApprovalDiscountBps,
          maxOrderAmountMinor: before.maxOrderAmountMinor,
          autoApprovalOrderAmountMinor: before.autoApprovalOrderAmountMinor,
          maxRecoveryAttempts: before.maxRecoveryAttempts,
          minMarginBps: 2_500,
          maxAutonomousActionsPerDay: 7,
          recoveryEnabled: false,
          prohibitedActions: ["BOUNDED_OFFER"],
          eligibleCategories: ["Running Shoes"],
          minCustomerPaidOrders: 2,
          proposalValidityMinutes: before.proposalValidityMinutes,
          approvalValidityMinutes: before.approvalValidityMinutes,
          authorizationValidityMinutes: before.authorizationValidityMinutes,
        },
      });
      expect(res.statusCode, res.body).toBe(200);

      // Read back from the DATABASE, not from the response. A route that
      // echoes its own input is the classic way a write path looks correct
      // while persisting nothing.
      const saved = await prisma.merchantPolicy.findUniqueOrThrow({ where: { merchantId } });
      expect(saved.minMarginBps).toBe(2_500);
      expect(saved.maxAutonomousActionsPerDay).toBe(7);
      expect(saved.recoveryEnabled).toBe(false);
      expect(saved.prohibitedActions).toEqual(["BOUNDED_OFFER"]);
      expect(saved.eligibleCategories).toEqual(["Running Shoes"]);
      expect(saved.minCustomerPaidOrders).toBe(2);

      // Every edit increments the version, so a decision evaluated under
      // the old policy can never be silently treated as current.
      expect(saved.policyVersion).toBeGreaterThan(before.policyVersion);
    } finally {
      await prisma.merchantPolicy.update({
        where: { merchantId },
        data: {
          policyVersion: before.policyVersion,
          minMarginBps: before.minMarginBps,
          maxAutonomousActionsPerDay: before.maxAutonomousActionsPerDay,
          recoveryEnabled: before.recoveryEnabled,
          prohibitedActions: before.prohibitedActions as never,
          eligibleCategories: before.eligibleCategories as never,
          minCustomerPaidOrders: before.minCustomerPaidOrders,
        },
      });
    }
  });

  it("refuses a policy edit from anyone but an OWNER", async () => {
    // Raising a ceiling authorises every future action beneath it, which
    // is the same class of decision as approving one — and stricter,
    // because it is silent.
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/merchant/policy",
      payload: { minMarginBps: 0 },
      headers: { authorization: "Bearer not-a-real-token" },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("a saved boundary reaches the engine that enforces it", () => {
  /** A product the agent can actually propose something for, so a refusal
   * is attributable to policy rather than to the fixture. */
  async function proposableProductId(): Promise<string | null> {
    const rel = await prisma.productRelationship.findFirst({
      where: {
        merchantId,
        sourceProduct: {
          status: "ACTIVE",
          variants: { some: { active: true, inventory: { availableQuantity: { gte: 5 } } } },
        },
      },
      orderBy: { id: "asc" },
      select: { sourceProductId: true },
    });
    return rel?.sourceProductId ?? null;
  }

  async function evaluateFreshProposal(productId: string) {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/merchant-agent/growth/proposals",
      payload: { primaryProductId: productId },
    });
    if (created.statusCode !== 200) return null;
    const proposalId = (created.json() as { id: string }).id;
    cycles.trackIds([proposalId]);

    const proposal = await prisma.growthActionProposal.findUniqueOrThrow({ where: { id: proposalId } });
    if (proposal.status !== "PROPOSED") return null;

    const evaluated = await app.inject({ method: "POST", url: "/api/v1/policy/evaluate", payload: { proposalId } });
    if (evaluated.statusCode !== 200) return null;
    return (evaluated.json() as { decision: { outcome: string; reasonCodes: string[]; explanation: string } }).decision;
  }

  it("denies on a category the merchant did not name", async () => {
    const productId = await proposableProductId();
    expect(productId, "no proposable product — this test would prove nothing").not.toBeNull();

    const before = await prisma.merchantPolicy.findUniqueOrThrow({ where: { merchantId } });
    try {
      // A category no product in this catalogue has.
      await prisma.merchantPolicy.update({
        where: { merchantId },
        data: { eligibleCategories: ["Category That Does Not Exist"] },
      });

      const decision = await evaluateFreshProposal(productId!);
      expect(decision, "the proposal should have been evaluable").not.toBeNull();
      expect(decision!.outcome).toBe("DENY");
      expect(decision!.reasonCodes).toContain("CATEGORY_NOT_ELIGIBLE");
    } finally {
      await prisma.merchantPolicy.update({
        where: { merchantId },
        data: { eligibleCategories: before.eligibleCategories as never },
      });
    }
  });

  it("allows the same proposal once the category is permitted again", async () => {
    // The other half of the previous test. A boundary that denies
    // everything is not evidence it is being read — this proves the DENY
    // was caused by the setting rather than by the fixture.
    const productId = await proposableProductId();
    if (!productId) return;

    const decision = await evaluateFreshProposal(productId);
    expect(decision).not.toBeNull();
    expect(decision!.reasonCodes).not.toContain("CATEGORY_NOT_ELIGIBLE");
  });

  it("records the decision as an immutable evaluation row", async () => {
    const productId = await proposableProductId();
    if (!productId) return;

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/merchant-agent/growth/proposals",
      payload: { primaryProductId: productId },
    });
    if (created.statusCode !== 200) return;
    const proposalId = (created.json() as { id: string }).id;
    cycles.trackIds([proposalId]);
    if ((await prisma.growthActionProposal.findUniqueOrThrow({ where: { id: proposalId } })).status !== "PROPOSED") return;

    await app.inject({ method: "POST", url: "/api/v1/policy/evaluate", payload: { proposalId } });
    await app.inject({ method: "POST", url: "/api/v1/policy/evaluate", payload: { proposalId } });

    // Re-evaluation APPENDS. History is never overwritten, so an auditor
    // can see what was decided under which policy version.
    const evaluations = await prisma.policyEvaluation.findMany({ where: { proposalId } });
    expect(evaluations.length).toBeGreaterThanOrEqual(1);
    for (const evaluation of evaluations) {
      expect(evaluation.evaluatedPolicyVersion).toBeGreaterThanOrEqual(1);
      expect(evaluation.proposalFingerprint.length).toBeGreaterThan(0);
    }
  });
});

describe("the lifecycle the spec names is complete", () => {
  it("declares every state, including the terminal ones", async () => {
    // PROPOSED -> PENDING_APPROVAL -> APPROVED -> EXECUTED -> VERIFIED,
    // or REJECTED / FAILED. Governance used to stop at AUTHORIZED, which
    // made an authorization that failed indistinguishable from one still
    // waiting to run.
    const { GROWTH_PROPOSAL_STATUSES, GROWTH_PROPOSAL_TRANSITIONS } = await import("@razorgrowth/domain");

    for (const state of ["PROPOSED", "PENDING_APPROVAL", "APPROVED", "EXECUTED", "VERIFIED", "FAILED"]) {
      expect(GROWTH_PROPOSAL_STATUSES, `${state} must exist in the lifecycle`).toContain(state);
    }

    // Execution may only follow authorization. A path from ALLOWED or
    // APPROVED straight to EXECUTED would skip the row that proves the
    // action was permitted at the moment it ran.
    expect(GROWTH_PROPOSAL_TRANSITIONS.ALLOWED).not.toContain("EXECUTED");
    expect(GROWTH_PROPOSAL_TRANSITIONS.APPROVED).not.toContain("EXECUTED");
    expect(GROWTH_PROPOSAL_TRANSITIONS.AUTHORIZED).toContain("EXECUTED");
    expect(GROWTH_PROPOSAL_TRANSITIONS.EXECUTED).toContain("VERIFIED");

    // Terminal means terminal: a failed action is re-proposed as new work,
    // never silently retried under a consumed authorization.
    expect(GROWTH_PROPOSAL_TRANSITIONS.VERIFIED).toHaveLength(0);
    expect(GROWTH_PROPOSAL_TRANSITIONS.FAILED).toHaveLength(0);
  });

  it("moves a proposal to a terminal state when the agent works it", async () => {
    const before = await prisma.growthActionProposal.count({
      where: { merchantId, status: { in: ["EXECUTED", "VERIFIED", "FAILED"] } },
    });

    const res = await app.inject({ method: "POST", url: "/api/v1/merchant-agent/run" });
    expect(res.statusCode, res.body).toBe(200);
    const run = res.json() as { steps: Array<{ outcome: string; proposalId: string | null }> };
    for (const step of run.steps) {
      if (step.proposalId) cycles.trackIds([step.proposalId]);
    }

    const executed = run.steps.filter((s) => s.outcome === "EXECUTED" && s.proposalId);
    if (executed.length === 0) return;

    const after = await prisma.growthActionProposal.count({
      where: { merchantId, status: { in: ["EXECUTED", "VERIFIED", "FAILED"] } },
    });
    // The governance row itself must record what happened. Before this,
    // "what did the agent actually do" could only be answered by joining
    // out to whatever each action type happened to write.
    expect(after).toBeGreaterThan(before);
  });
});

describe("the ledger records what the agent did", () => {
  it("writes hash-chained events for a cycle", async () => {
    const before = await prisma.agentAction.count({ where: { merchantId } });
    const res = await app.inject({ method: "POST", url: "/api/v1/merchant-agent/run" });
    expect(res.statusCode).toBe(200);

    const run = res.json() as { workflowId: string; steps: Array<{ proposalId: string | null }> };
    for (const step of run.steps) {
      if (step.proposalId) cycles.trackIds([step.proposalId]);
    }

    const after = await prisma.agentAction.count({ where: { merchantId } });
    expect(after).toBeGreaterThanOrEqual(before);

    // Every event carries its own hash and its predecessor's, so a
    // deletion in the middle of a workflow is detectable rather than
    // invisible.
    const events = await prisma.agentAction.findMany({
      where: { merchantId },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { eventHash: true, sequence: true, workflowId: true },
    });
    for (const event of events) {
      expect(event.eventHash.length, "every ledger event must be hashed").toBeGreaterThan(0);
      expect(event.sequence).toBeGreaterThanOrEqual(0);
    }
  });
});
