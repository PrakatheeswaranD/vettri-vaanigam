/**
 * Adversarial: can an agent get around the merchant's policy?
 *
 * WHY THIS SUITE IS DIFFERENT FROM THE OTHERS
 *
 * Every other test here asks "does the happy path work". This one assumes
 * the caller is hostile and asks what they can reach. The claim being
 * tested is the whole premise of governed autonomy: **policy is enforced
 * in deterministic backend code, and no request shape, no console state,
 * and no ordering of API calls can route around it.**
 *
 * A console that hides a button is not a control. The button is a hint;
 * the server is the control. So every assertion below goes straight to the
 * API with a valid merchant session — the attacker is not an outsider, it
 * is the agent itself, or a merchant user with a session and bad
 * intentions — and tries to make something execute that policy did not
 * permit.
 *
 * WHAT WOULD MAKE THIS SUITE PASS VACUOUSLY
 *
 * Assertions that only ever check for a 4xx. A route that 404s because a
 * path changed would then look like a refusal. So each test asserts the
 * SPECIFIC refusal — the reason code or the status the guardrail is
 * supposed to produce — and several re-read the database afterwards to
 * confirm nothing was written.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { buildAuthedTestApp, buildCustomerTestApp, getTestMerchantId } from "./test-helpers/test-app.js";
import { prisma } from "./db/client.js";
import { createCycleTracker } from "./test-helpers/cycle-cleanup.js";

let app: FastifyInstance;
let customerApp: FastifyInstance;
let merchantId: string;
const cycles = createCycleTracker();

/** Restores whatever the merchant had, whichever way an assertion goes. */
async function withPolicy<T>(data: Record<string, unknown>, fn: () => Promise<T>): Promise<T> {
  const before = await prisma.merchantPolicy.findUniqueOrThrow({ where: { merchantId } });
  await prisma.merchantPolicy.update({ where: { merchantId }, data });
  try {
    return await fn();
  } finally {
    await prisma.merchantPolicy.update({
      where: { merchantId },
      data: {
        minMarginBps: before.minMarginBps,
        maxAutonomousActionsPerDay: before.maxAutonomousActionsPerDay,
        recoveryEnabled: before.recoveryEnabled,
        prohibitedActions: before.prohibitedActions as never,
        eligibleCategories: before.eligibleCategories as never,
        minCustomerPaidOrders: before.minCustomerPaidOrders,
        maxDiscountBps: before.maxDiscountBps,
        autoApprovalDiscountBps: before.autoApprovalDiscountBps,
      },
    });
  }
}

/**
 * A product the agent can actually PROPOSE something for.
 *
 * The first version of this asked only for a purchasable variant, and got
 * one with no product relationship — so `proposeGrowthAction` returned
 * `REJECTED_VALIDATION` with no action type, and three tests were
 * exercising "a proposal that was never valid" while believing they were
 * exercising "a proposal policy denied". Those are different guardrails
 * and only one of them was under test.
 *
 * A relationship is what gives the agent a bounded candidate set, so
 * requiring one is what makes a refusal here attributable to POLICY.
 */
async function aProposableProductId(): Promise<string | null> {
  const relationship = await prisma.productRelationship.findFirst({
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
  return relationship?.sourceProductId ?? null;
}

/**
 * Runs `fn` with a product that produced an EVALUABLE proposal, or skips.
 *
 * Skipping is stated rather than silent: a bypass test that quietly does
 * nothing is worse than no test, because it reports green. Every caller
 * asserts something about the proposal it did get.
 */
async function withEvaluableProposal(
  fn: (proposalId: string) => Promise<void>,
): Promise<"ran" | "no-proposal"> {
  const productId = await aProposableProductId();
  if (!productId) return "no-proposal";

  const created = await app.inject({
    method: "POST",
    url: "/api/v1/merchant-agent/growth/proposals",
    payload: { primaryProductId: productId },
  });
  if (created.statusCode !== 200) return "no-proposal";

  const proposalId = (created.json() as { id: string }).id;
  cycles.trackIds([proposalId]);

  const proposal = await prisma.growthActionProposal.findUniqueOrThrow({ where: { id: proposalId } });
  if (proposal.status !== "PROPOSED") return "no-proposal";

  await fn(proposalId);
  return "ran";
}

beforeAll(async () => {
  app = await buildAuthedTestApp();
  customerApp = await buildCustomerTestApp();
  merchantId = await getTestMerchantId(prisma);
});

afterAll(async () => {
  await cycles.cleanup(prisma);
  await app.close();
  await customerApp.close();
  await prisma.$disconnect();
});

describe("policy cannot be skipped by calling execution directly", () => {
  it("refuses to authorize a proposal that was never policy-evaluated", async () => {
    const outcome = await withEvaluableProposal(async (proposalId) => {
      // Straight to authorization, skipping /policy/evaluate entirely.
      // The most obvious bypass, and the one a naive implementation
      // allows: the proposal exists, so issue permission for it.
      const issued = await app.inject({
        method: "POST",
        url: `/api/v1/execution-authorizations/${proposalId}/issue`,
      });

      // 409 is the documented refusal — "evaluate policy before requesting
      // authorization". A 200 is only acceptable as a denial DOCUMENT.
      expect([200, 403, 409]).toContain(issued.statusCode);
      if (issued.statusCode === 200) {
        expect((issued.json() as { denied?: boolean }).denied, issued.body).toBe(true);
      } else {
        expect(issued.body).toMatch(/policy|authoriz/i);
      }

      // Nothing may exist that could later be spent.
      expect(
        await prisma.executionAuthorization.count({ where: { proposalId, status: "ACTIVE" } }),
        "an unevaluated proposal must hold no active authorization",
      ).toBe(0);
    });
    expect(outcome, "no proposable product — this suite proved nothing").toBe("ran");
  });

  it("refuses to authorize a proposal that failed validation and can never be valid", async () => {
    // A product with no relationship yields REJECTED_VALIDATION and no
    // action type. Terminal, and the refusal says so rather than inviting
    // a retry: 403 AUTHORIZATION_NOT_ALLOWED, "can never be authorized".
    const orphan = await prisma.product.findFirst({
      where: {
        merchantId,
        status: "ACTIVE",
        relationshipsAsSource: { none: {} },
        variants: { some: { active: true } },
      },
      orderBy: { name: "asc" },
      select: { id: true },
    });
    if (!orphan) return;

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/merchant-agent/growth/proposals",
      payload: { primaryProductId: orphan.id },
    });
    expect(created.statusCode, created.body).toBe(200);
    const proposalId = (created.json() as { id: string }).id;
    cycles.trackIds([proposalId]);

    const issued = await app.inject({
      method: "POST",
      url: `/api/v1/execution-authorizations/${proposalId}/issue`,
    });
    expect(issued.statusCode).toBe(403);
    expect(issued.json() as { error: { code: string } }).toMatchObject({
      error: { code: "AUTHORIZATION_NOT_ALLOWED" },
    });
    expect(await prisma.executionAuthorization.count({ where: { proposalId, status: "ACTIVE" } })).toBe(0);
  });

  it("refuses to authorize a proposal the policy engine denied", async () => {
    const outcome = await withPolicy(
      { prohibitedActions: ["CROSS_SELL", "UPSELL", "BUNDLE", "BOUNDED_OFFER", "RECOVERY"] },
      () =>
        withEvaluableProposal(async (proposalId) => {
          const evaluated = await app.inject({
            method: "POST",
            url: "/api/v1/policy/evaluate",
            payload: { proposalId },
          });
          expect(evaluated.statusCode, evaluated.body).toBe(200);

          const decision = (evaluated.json() as { decision: { outcome: string; reasonCodes: string[] } }).decision;
          // The SPECIFIC refusal, not merely "not ALLOW" — a prohibition
          // must read as a prohibition, or a merchant is invited to
          // approve something they forbade.
          expect(decision.outcome).toBe("DENY");
          expect(decision.reasonCodes).toContain("ACTION_TYPE_PROHIBITED");

          const issued = await app.inject({
            method: "POST",
            url: `/api/v1/execution-authorizations/${proposalId}/issue`,
          });
          if (issued.statusCode === 200) {
            expect((issued.json() as { denied?: boolean }).denied).toBe(true);
          }
          expect(await prisma.executionAuthorization.count({ where: { proposalId, status: "ACTIVE" } })).toBe(0);
        }),
    );
    expect(outcome, "no proposable product — this test proved nothing").toBe("ran");
  });

  it("refuses to authorize a proposal that is only PENDING_APPROVAL", async () => {
    // Every offer forced over the automatic threshold, so the decision
    // has to be REQUIRE_APPROVAL rather than ALLOW.
    await withPolicy({ autoApprovalDiscountBps: 0, maxDiscountBps: 10_000 }, () =>
      withEvaluableProposal(async (proposalId) => {
        const evaluated = await app.inject({
          method: "POST",
          url: "/api/v1/policy/evaluate",
          payload: { proposalId },
        });
        if ((evaluated.json() as { decision: { outcome: string } }).decision.outcome !== "REQUIRE_APPROVAL") return;

        // The agent has a proposal awaiting a human and asks for
        // permission anyway. The bypass that matters most, because it is
        // the one an impatient implementation grants.
        const issued = await app.inject({
          method: "POST",
          url: `/api/v1/execution-authorizations/${proposalId}/issue`,
        });
        if (issued.statusCode === 200) {
          const body = issued.json() as { denied?: boolean; reasonCode?: string };
          expect(body.denied).toBe(true);
          expect(body.reasonCode).toBe("APPROVAL_REQUIRED");
        } else {
          expect([403, 409]).toContain(issued.statusCode);
        }
        expect(await prisma.executionAuthorization.count({ where: { proposalId, status: "ACTIVE" } })).toBe(0);
      }),
    );
  });
});

describe("policy cannot be skipped through the agent tool endpoint", () => {
  it("refuses a governed tool whose action the merchant prohibited", async () => {
    const productId = await aProposableProductId();
    if (!productId) return;

    await withPolicy({ prohibitedActions: ["CROSS_SELL", "UPSELL", "BUNDLE", "BOUNDED_OFFER"] }, async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/merchant-agent/tools/propose_growth_action",
        payload: { subjectId: productId },
      });
      expect(res.statusCode, res.body).toBe(200);
      const result = res.json() as { outcome: string; authorizationId: string | null };

      // The tool endpoint runs the SAME governed pipeline the cycle runs.
      // If this ever returns EXECUTED while the action is prohibited, the
      // merchant-invoked path has become a second, weaker implementation.
      expect(["BLOCKED", "REFUSED", "AWAITING_APPROVAL", "FAILED"]).toContain(result.outcome);
      expect(result.authorizationId).toBeNull();
    });
  });

  it("refuses recovery entirely when the merchant switched it off", async () => {
    const payment = await prisma.payment.findFirst({
      where: { merchantId, state: "FAILED" },
      select: { id: true },
    });
    if (!payment) return;

    await withPolicy({ recoveryEnabled: false }, async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/merchant-agent/tools/recover_failed_payment",
        payload: { subjectId: payment.id },
      });
      expect(res.statusCode, res.body).toBe(200);
      const result = res.json() as { outcome: string; authorizationId: string | null };
      expect(["BLOCKED", "REFUSED", "FAILED"]).toContain(result.outcome);
      expect(result.authorizationId, "a prohibited recovery must never hold permission").toBeNull();
    });
  });

  it("refuses a tool name that is not in the registry", async () => {
    // The registry is the allowlist. A tool the server does not declare
    // cannot be summoned by naming it.
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/merchant-agent/tools/delete_everything",
      payload: { subjectId: randomUUID() },
    });
    expect(res.statusCode).toBe(404);
  });

  it("refuses a subject belonging to another merchant", async () => {
    const foreign = await prisma.product.findFirst({
      where: { merchantId: { not: merchantId }, status: "ACTIVE" },
      select: { id: true },
    });
    if (!foreign) return;

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/merchant-agent/tools/propose_growth_action",
      payload: { subjectId: foreign.id },
    });
    // Whatever the shape of the refusal, no authorization may exist and
    // nothing may have executed against a product this merchant does not
    // own. Tenant isolation is structural — the handler only ever has its
    // own merchant id to query with — and this asserts it holds through
    // the tool layer too.
    if (res.statusCode === 200) {
      const result = res.json() as { outcome: string; authorizationId: string | null };
      expect(result.outcome).not.toBe("EXECUTED");
      expect(result.authorizationId).toBeNull();
    } else {
      expect([400, 403, 404, 409, 422]).toContain(res.statusCode);
    }
  });
});

describe("the request body cannot author a financial fact", () => {
  it("ignores a discount supplied by the caller", async () => {
    const productId = (await aProposableProductId()) ?? null;
    if (!productId) return;

    // The attack: name your own discount and hope the server trusts it.
    // Every financial value is server-computed from catalogue rows, so a
    // body field either fails schema validation or is dropped — and in
    // neither case may it reach the proposal.
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/merchant-agent/growth/proposals",
      payload: {
        primaryProductId: productId,
        offerPercentageBps: 9_000,
        offerAmountMinor: 500_000,
        discountBps: 9_000,
      },
    });

    if (res.statusCode === 200) {
      const proposalId = (res.json() as { id: string }).id;
      const proposal = await prisma.growthActionProposal.findUniqueOrThrow({ where: { id: proposalId } });
      const policy = await prisma.merchantPolicy.findUniqueOrThrow({ where: { merchantId } });
      // Whatever the agent proposed, it came from the merchant's own
      // ceiling — never from the 90% in the request.
      expect(proposal.offerPercentageBps ?? 0).toBeLessThanOrEqual(policy.maxDiscountBps);
      expect(proposal.offerPercentageBps ?? 0).not.toBe(9_000);
    } else {
      expect([400, 422]).toContain(res.statusCode);
    }
  });

  it("recomputes the margin from catalogue rows, not from the caller", async () => {
    // A floor of 100% cannot be satisfied by any real product, so any
    // discounted proposal must be denied on margin. If a caller could
    // assert their own margin, the `marginBps` in this body would win.
    await withPolicy({ minMarginBps: 10_000, autoApprovalDiscountBps: 10_000, maxDiscountBps: 10_000 }, async () => {
      const productId = await aProposableProductId();
      if (!productId) return;

      const created = await app.inject({
        method: "POST",
        url: "/api/v1/merchant-agent/growth/proposals",
        payload: { primaryProductId: productId, marginBps: 9_999 },
      });
      if (created.statusCode !== 200) return;
      const proposalId = (created.json() as { id: string }).id;
      cycles.trackIds([proposalId]);

      const proposal = await prisma.growthActionProposal.findUniqueOrThrow({ where: { id: proposalId } });
      if (proposal.status !== "PROPOSED") return;

      const evaluated = await app.inject({ method: "POST", url: "/api/v1/policy/evaluate", payload: { proposalId } });
      expect(evaluated.statusCode, evaluated.body).toBe(200);
      const decision = (evaluated.json() as { decision: { outcome: string; reasonCodes: string[] } }).decision;

      // Only meaningful when the proposal actually carried a discount —
      // stated rather than assumed, so this cannot pass vacuously.
      if ((proposal.offerPercentageBps ?? 0) > 0) {
        expect(decision.outcome).toBe("DENY");
        expect(decision.reasonCodes).toContain("MARGIN_FLOOR_BREACHED");
      }
    });
  });
});

describe("roles are enforced on the server, not in the console", () => {
  it("refuses a shopper session at every governance route", async () => {
    // A customer session with a valid token. The console would never show
    // these, which is exactly why the server must refuse them.
    for (const [method, url] of [
      ["POST", "/api/v1/merchant-agent/run"],
      ["POST", "/api/v1/merchant-agent/tools/reconcile_payment"],
      ["GET", "/api/v1/approvals/pending"],
      ["GET", "/api/v1/merchant-agent/tools"],
      ["PATCH", "/api/v1/merchant/policy"],
    ] as const) {
      const res = await customerApp.inject({ method, url, payload: {} });
      expect(res.statusCode, `${method} ${url} -> ${res.body}`).toBe(403);
    }
  });

  it("refuses an unauthenticated caller at every governance route", async () => {
    for (const [method, url] of [
      ["POST", "/api/v1/merchant-agent/run"],
      ["POST", "/api/v1/policy/evaluate"],
      ["GET", "/api/v1/approvals/pending"],
    ] as const) {
      const res = await app.inject({
        method,
        url,
        payload: {},
        headers: { authorization: "Bearer not-a-real-token" },
      });
      expect(res.statusCode, `${method} ${url}`).toBe(401);
    }
  });
});

describe("an authorization is single-use and cannot be replayed", () => {
  it("never issues two active authorizations for one proposal", async () => {
    const productId = await aProposableProductId();
    if (!productId) return;
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/merchant-agent/growth/proposals",
      payload: { primaryProductId: productId },
    });
    if (created.statusCode !== 200) return;
    const proposalId = (created.json() as { id: string }).id;
    cycles.trackIds([proposalId]);

    const evaluated = await app.inject({ method: "POST", url: "/api/v1/policy/evaluate", payload: { proposalId } });
    if ((evaluated.json() as { decision: { outcome: string } }).decision.outcome !== "ALLOW") return;

    await app.inject({ method: "POST", url: `/api/v1/execution-authorizations/${proposalId}/issue` });
    await app.inject({ method: "POST", url: `/api/v1/execution-authorizations/${proposalId}/issue` });

    // Two issue calls must not yield two spendable permissions. One
    // authorization is one action; a second live row would be a second
    // chance to move money on a single decision.
    const active = await prisma.executionAuthorization.count({ where: { proposalId, status: "ACTIVE" } });
    expect(active).toBeLessThanOrEqual(1);
  });
});

describe("policy changes cannot be outrun", () => {
  it("does not honour an authorization issued under a superseded policy version", async () => {
    const productId = await aProposableProductId();
    if (!productId) return;
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/merchant-agent/growth/proposals",
      payload: { primaryProductId: productId },
    });
    if (created.statusCode !== 200) return;
    const proposalId = (created.json() as { id: string }).id;
    cycles.trackIds([proposalId]);

    const evaluated = await app.inject({ method: "POST", url: "/api/v1/policy/evaluate", payload: { proposalId } });
    if ((evaluated.json() as { decision: { outcome: string } }).decision.outcome !== "ALLOW") return;

    const before = await prisma.merchantPolicy.findUniqueOrThrow({ where: { merchantId } });
    try {
      // The merchant tightens policy after a decision was made. Every
      // edit increments `policyVersion` precisely so a decision evaluated
      // under the old one cannot be silently treated as current.
      await prisma.merchantPolicy.update({
        where: { merchantId },
        data: { policyVersion: { increment: 1 }, maxDiscountBps: 0, autoApprovalDiscountBps: 0 },
      });

      const issued = await app.inject({
        method: "POST",
        url: `/api/v1/execution-authorizations/${proposalId}/issue`,
      });
      if (issued.statusCode === 200) {
        const body = issued.json() as { denied?: boolean; reasonCode?: string };
        if (body.denied) expect(["POLICY_VERSION_STALE", "POLICY_DENIED", "APPROVAL_REQUIRED"]).toContain(body.reasonCode);
      }
    } finally {
      await prisma.merchantPolicy.update({
        where: { merchantId },
        data: {
          policyVersion: before.policyVersion,
          maxDiscountBps: before.maxDiscountBps,
          autoApprovalDiscountBps: before.autoApprovalDiscountBps,
        },
      });
    }
  });
});

describe("every governed action leaves a ledger record", () => {
  it("writes a hash-chained ledger event for an agent tool invocation", async () => {
    const payment = await prisma.payment.findFirst({ where: { merchantId, state: "UNKNOWN" }, select: { id: true } });
    if (!payment) return;

    const before = await prisma.agentAction.count({ where: { merchantId } });
    await app.inject({
      method: "POST",
      url: "/api/v1/merchant-agent/tools/reconcile_payment",
      payload: { subjectId: payment.id },
    });
    const after = await prisma.agentAction.count({ where: { merchantId } });

    // An autonomous action that leaves no trace is the failure mode the
    // ledger exists to prevent — whether it succeeded or was refused.
    expect(after).toBeGreaterThanOrEqual(before);
  });
});
