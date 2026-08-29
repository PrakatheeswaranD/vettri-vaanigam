/**
 * PART 05 — Deterministic Policy Engine, Approval Lifecycle, Execution
 * Authorization, and Agent Action Ledger integrity tests. Uses the same
 * real-seeded-catalog + `FixtureProvider` pattern as
 * `merchant-agent.test.ts` (PART 04) to construct proposals with an exact,
 * controlled discount so every policy tier (ALLOW / REQUIRE_APPROVAL /
 * DENY) is reachable deterministically, never by chance.
 *
 * Demo policy (see `prisma/seed.ts`): autoApprovalDiscountBps=300 (3%),
 * maxDiscountBps=800 (8%, POLICY hard max — deliberately below PART 04's
 * own `MerchantGrowthConfig.maxProposedDiscountBps`=1000/10%, so a 9%
 * proposal is a valid `PROPOSED` row that policy then legitimately DENIES).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildAuthedTestApp, getTestMerchantId, getTestMerchantUserId } from "./test-helpers/test-app.js";
import { prisma } from "./db/client.js";
import { proposeGrowthAction } from "./modules/merchant-agent/service.js";
import { createFixtureProvider } from "./modules/agents/providers/fixture-provider.js";

let app: FastifyInstance;

async function productId(name: string): Promise<string> {
  const product = await prisma.product.findFirstOrThrow({ where: { name } });
  return product.id;
}

beforeAll(async () => {
  app = await buildAuthedTestApp();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

async function proposeCrossSellWithDiscount(percentageBps: number) {
  const merchantId = await getTestMerchantId(prisma);
  const pulseRunner = await productId("Meridian Pulse Runner");
  const provider = createFixtureProvider(
    {
      proposeGrowthAction: async ({ candidates }) => ({
        actionType: "CROSS_SELL",
        primaryProductId: pulseRunner,
        relatedProductIds: [candidates.find((c) => c.relationship === "COMPLEMENTARY" && c.readinessState !== "NOT_READY")!.productId],
        offer: { kind: "PERCENTAGE", percentageBps, amountMinor: null },
        reasonCodes: ["COMPLEMENTARY_PRODUCT"],
      }),
    },
    "LIVE_ANTHROPIC",
  );
  return proposeGrowthAction(prisma, { merchantId, primaryProductId: pulseRunner }, provider);
}

async function evaluate(proposalId: string) {
  return app.inject({ method: "POST", url: "/api/v1/policy/evaluate", payload: { proposalId } });
}

async function approve(proposalId: string, reason?: string) {
  return app.inject({ method: "POST", url: `/api/v1/approvals/${proposalId}/approve`, payload: reason ? { reason } : {} });
}

async function reject(proposalId: string, reason?: string) {
  return app.inject({ method: "POST", url: `/api/v1/approvals/${proposalId}/reject`, payload: reason ? { reason } : {} });
}

async function issueAuthorization(proposalId: string) {
  return app.inject({ method: "POST", url: `/api/v1/execution-authorizations/${proposalId}/issue` });
}

describe("Policy Engine — Scenario A: ALLOW (PART 05 §115)", () => {
  it("auto-allows a 2% discount and immediately issues execution authorization", async () => {
    const proposal = await proposeCrossSellWithDiscount(200);
    expect(proposal.status).toBe("PROPOSED");

    const res = await evaluate(proposal.id);
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.decision.outcome).toBe("ALLOW");
    expect(body.decision.reasonCodes).toContain("WITHIN_AUTONOMOUS_LIMIT");
    expect(body.authorization.denied).toBeUndefined();
    expect(body.authorization.status).toBe("ACTIVE");
    expect(body.authorization.proposalId).toBe(proposal.id);

    const updated = await prisma.growthActionProposal.findUniqueOrThrow({ where: { id: proposal.id } });
    expect(updated.status).toBe("AUTHORIZED");
    expect(updated.executionAuthorizationId).toBe(body.authorization.id);
    expect(updated.approvalId).toBeNull(); // never went through human approval
  });

  it("never implies execution occurred — authorization is a gate, not a receipt", async () => {
    const proposal = await proposeCrossSellWithDiscount(150);
    const res = await evaluate(proposal.id);
    const body = res.json();
    expect(body.authorization).not.toHaveProperty("executedAt");
    expect(body.authorization).not.toHaveProperty("consumed");
  });
});

describe("Policy Engine — Scenario B: REQUIRE_APPROVAL (PART 05 §116)", () => {
  it("requires approval for a 5% discount, then issues authorization once approved", async () => {
    const proposal = await proposeCrossSellWithDiscount(500);
    const evalRes = await evaluate(proposal.id);
    const evalBody = evalRes.json();
    expect(evalBody.decision.outcome).toBe("REQUIRE_APPROVAL");
    expect(evalBody.decision.reasonCodes).toContain("DISCOUNT_REQUIRES_APPROVAL");
    expect(evalBody.authorization).toBeNull();

    const midway = await prisma.growthActionProposal.findUniqueOrThrow({ where: { id: proposal.id } });
    expect(midway.status).toBe("PENDING_APPROVAL");

    const pending = await app.inject({ method: "GET", url: "/api/v1/approvals/pending" });
    expect(pending.json().items.some((i: { proposal: { id: string } }) => i.proposal.id === proposal.id)).toBe(true);

    const approveRes = await approve(proposal.id, "Looks reasonable for a loyal customer.");
    expect(approveRes.statusCode).toBe(200);
    const approveBody = approveRes.json();
    expect(approveBody.approval.decision).toBe("APPROVED");
    expect(approveBody.approval.approverId).toBe(await getTestMerchantUserId(prisma)); // real authenticated identity, never client-supplied
    expect(approveBody.authorization.status).toBe("ACTIVE");

    const final = await prisma.growthActionProposal.findUniqueOrThrow({ where: { id: proposal.id } });
    expect(final.status).toBe("AUTHORIZED");
    expect(final.approvalId).toBe(approveBody.approval.id);
  });

  it("a rejected approval leaves the proposal un-authorizable", async () => {
    const proposal = await proposeCrossSellWithDiscount(450);
    await evaluate(proposal.id);
    const rejectRes = await reject(proposal.id, "Not this week.");
    expect(rejectRes.statusCode).toBe(200);
    expect(rejectRes.json().approval.decision).toBe("REJECTED");

    const final = await prisma.growthActionProposal.findUniqueOrThrow({ where: { id: proposal.id } });
    expect(final.status).toBe("APPROVAL_REJECTED");

    const authRes = await issueAuthorization(proposal.id);
    expect(authRes.statusCode).toBe(403);
    expect(authRes.json().error.code).toBe("AUTHORIZATION_NOT_ALLOWED");
  });
});

describe("Policy Engine — Scenario C: DENY (PART 05 §117)", () => {
  it("denies a 9% discount even though PART 04's own agent-shape ceiling (10%) already let it through", async () => {
    const proposal = await proposeCrossSellWithDiscount(900);
    expect(proposal.status).toBe("PROPOSED"); // PART 04 validation passed it

    const res = await evaluate(proposal.id);
    const body = res.json();
    expect(body.decision.outcome).toBe("DENY");
    expect(body.decision.reasonCodes).toContain("DISCOUNT_LIMIT_EXCEEDED");
    expect(body.authorization).toBeNull();

    const updated = await prisma.growthActionProposal.findUniqueOrThrow({ where: { id: proposal.id } });
    expect(updated.status).toBe("POLICY_DENIED");

    // No approval button is meaningful here — attempting one must fail.
    const approveRes = await approve(proposal.id);
    expect(approveRes.statusCode).toBe(409);
    expect(approveRes.json().error.code).toBe("INVALID_STATE_TRANSITION");

    const authRes = await issueAuthorization(proposal.id);
    expect(authRes.statusCode).toBe(403);
  });
});

describe("Policy Engine — Scenario D: proposal tamper invalidates approval (PART 05 §118)", () => {
  it("detects a fingerprint mismatch and refuses authorization after the proposal's stored offer changes underneath the approval", async () => {
    const proposal = await proposeCrossSellWithDiscount(500);
    await evaluate(proposal.id);
    const approveRes = await approve(proposal.id);
    expect(approveRes.json().authorization.status).toBe("ACTIVE"); // approved + auto-authorized

    // Simulate the proposal's financially meaningful content changing after
    // approval was granted — not a real user-facing edit path (none
    // exists; proposals are immutable by design), but a deliberate
    // demonstration that the fingerprint binding actually holds even if
    // something mutated the row directly.
    await prisma.growthActionProposal.update({ where: { id: proposal.id }, data: { offerPercentageBps: 800 } });

    // The authorization that was already issued remains on record (PART 05
    // does not retroactively revoke it), but a FRESH issuance attempt must
    // now detect the mismatch.
    const reissue = await issueAuthorization(proposal.id);
    const body = reissue.json();
    expect(body.denied).toBe(true);
    expect(body.reasonCode).toBe("PROPOSAL_CHANGED");
  });
});

describe("Policy Engine — Scenario E: approval expiry (PART 05 §119)", () => {
  it("refuses authorization once the merchant's approval has expired", async () => {
    const proposal = await proposeCrossSellWithDiscount(500);
    await evaluate(proposal.id);
    await approve(proposal.id);

    // The just-issued ACTIVE authorization already covers this proposal —
    // force it into the past too so the expiry path is actually exercised
    // instead of short-circuiting on the still-active authorization.
    await prisma.executionAuthorization.updateMany({ where: { proposalId: proposal.id }, data: { expiresAt: new Date(Date.now() - 60_000) } });
    await prisma.approval.update({ where: { proposalId: proposal.id }, data: { expiresAt: new Date(Date.now() - 60_000) } });

    const res = await issueAuthorization(proposal.id);
    const body = res.json();
    expect(body.denied).toBe(true);
    expect(body.reasonCode).toBe("APPROVAL_EXPIRED");
  });
});

describe("Policy Engine — Scenario F: policy version staleness (PART 05 §120)", () => {
  it("re-evaluates under the current policy version rather than trusting a stale decision", async () => {
    const proposal = await proposeCrossSellWithDiscount(500);
    await evaluate(proposal.id); // REQUIRE_APPROVAL under policyVersion 1
    await approve(proposal.id); // -> AUTHORIZED

    // Tighten the policy so a 5% discount would no longer even qualify for
    // approval-level autonomy — a real edit through the real endpoint,
    // incrementing policyVersion.
    const currentPolicy = await app.inject({ method: "GET", url: "/api/v1/merchant/policy" });
    const policyBody = currentPolicy.json();
    const tightened = await app.inject({
      method: "PATCH",
      url: "/api/v1/merchant/policy",
      payload: {
        maxDiscountBps: 100,
        autoApprovalDiscountBps: 50,
        maxOrderAmountMinor: policyBody.maxOrderAmount.amountMinor,
        autoApprovalOrderAmountMinor: policyBody.autoApprovalOrderAmount.amountMinor,
        maxRecoveryAttempts: policyBody.maxRecoveryAttempts,
        proposalValidityMinutes: policyBody.proposalValidityMinutes,
        approvalValidityMinutes: policyBody.approvalValidityMinutes,
        authorizationValidityMinutes: policyBody.authorizationValidityMinutes,
      },
    });
    expect(tightened.statusCode).toBe(200);
    expect(tightened.json().policyVersion).toBe(policyBody.policyVersion + 1);

    // The proposal was already AUTHORIZED before the policy changed — a
    // fresh, already-issued authorization is not retroactively revoked by
    // PART 05 (that would be a PART 06+ concern) — but re-requesting
    // authorization on a DIFFERENT still-pending proposal under the new
    // policy must re-evaluate rather than reuse the stale decision.
    const staleProposal = await proposeCrossSellWithDiscount(500);
    await evaluate(staleProposal.id); // now DENY under the tightened policy (5% > new 1% max)
    const stale = await prisma.growthActionProposal.findUniqueOrThrow({ where: { id: staleProposal.id } });
    expect(stale.status).toBe("POLICY_DENIED");

    // Restore the original thresholds so later tests / manual demo use
    // keep the intended values (the version number itself keeps climbing —
    // that is expected and correct, PART 05 §12).
    await app.inject({
      method: "PATCH",
      url: "/api/v1/merchant/policy",
      payload: {
        maxDiscountBps: policyBody.maxDiscountBps,
        autoApprovalDiscountBps: policyBody.autoApprovalDiscountBps,
        maxOrderAmountMinor: policyBody.maxOrderAmount.amountMinor,
        autoApprovalOrderAmountMinor: policyBody.autoApprovalOrderAmount.amountMinor,
        maxRecoveryAttempts: policyBody.maxRecoveryAttempts,
        proposalValidityMinutes: policyBody.proposalValidityMinutes,
        approvalValidityMinutes: policyBody.approvalValidityMinutes,
        authorizationValidityMinutes: policyBody.authorizationValidityMinutes,
      },
    });
  });
});

describe("Agent Action Ledger integrity (PART 05 §61-§63, §95)", () => {
  it("verifies a real workflow's hash chain and detects tampering", async () => {
    const proposal = await proposeCrossSellWithDiscount(200);
    await evaluate(proposal.id);

    const workflowId = proposal.traceId;
    const verifyRes = await app.inject({ method: "GET", url: `/api/v1/action-ledger/workflows/${workflowId}/verify` });
    expect(verifyRes.statusCode).toBe(200);
    const verifyBody = verifyRes.json();
    expect(verifyBody.valid).toBe(true);
    expect(verifyBody.eventCount).toBeGreaterThanOrEqual(2); // GROWTH_PROPOSAL_CREATED + POLICY_ALLOWED (+ authorization issued)

    // Tamper with one persisted event directly (never through application
    // code — there is no such route) and confirm verification now fails.
    const firstEvent = await prisma.agentAction.findFirstOrThrow({ where: { workflowId }, orderBy: { sequence: "asc" } });
    await prisma.agentAction.update({ where: { id: firstEvent.id }, data: { conciseReason: "TAMPERED" } });

    const afterTamper = await app.inject({ method: "GET", url: `/api/v1/action-ledger/workflows/${workflowId}/verify` });
    expect(afterTamper.json().valid).toBe(false);
    expect(afterTamper.json().brokenAtSequence).toBe(firstEvent.sequence);
  });

  it("keeps independent workflows on independent chains", async () => {
    const a = await proposeCrossSellWithDiscount(200);
    const b = await proposeCrossSellWithDiscount(200);
    expect(a.traceId).not.toBe(b.traceId);
    const [verifyA, verifyB] = await Promise.all([
      app.inject({ method: "GET", url: `/api/v1/action-ledger/workflows/${a.traceId}/verify` }),
      app.inject({ method: "GET", url: `/api/v1/action-ledger/workflows/${b.traceId}/verify` }),
    ]);
    expect(verifyA.json().valid).toBe(true);
    expect(verifyB.json().valid).toBe(true);
  });
});

describe("Approval concurrency and security (PART 05 §35-§36, §92, §98)", () => {
  it("two concurrent approve requests for the same proposal resolve to exactly one Approval row", async () => {
    const proposal = await proposeCrossSellWithDiscount(500);
    await evaluate(proposal.id);

    const [first, second] = await Promise.all([approve(proposal.id), approve(proposal.id)]);
    expect([first.statusCode, second.statusCode]).toEqual([200, 200]);
    expect(first.json().approval.id).toBe(second.json().approval.id); // idempotent, not duplicated

    const rows = await prisma.approval.findMany({ where: { proposalId: proposal.id } });
    expect(rows).toHaveLength(1);
  });

  it("a conflicting concurrent decision (approve vs reject) is rejected, not silently applied", async () => {
    const proposal = await proposeCrossSellWithDiscount(500);
    await evaluate(proposal.id);

    const [approveRes, rejectRes] = await Promise.all([approve(proposal.id), reject(proposal.id)]);
    const statuses = [approveRes.statusCode, rejectRes.statusCode].sort();
    // Exactly one succeeds; the other sees a real conflict — never both
    // silently "succeeding" with different decisions.
    expect(statuses).toEqual([200, 409]);

    const rows = await prisma.approval.findMany({ where: { proposalId: proposal.id } });
    expect(rows).toHaveLength(1);
  });

  it("cannot forge a policy outcome or approval state via the request body", async () => {
    const proposal = await proposeCrossSellWithDiscount(200); // would ALLOW
    // Client cannot pre-declare an outcome or steer evaluation — the
    // endpoint only ever accepts a proposalId.
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/policy/evaluate",
      payload: { proposalId: proposal.id, outcome: "DENY", forcedApproval: true },
    });
    expect(res.json().decision.outcome).toBe("ALLOW"); // still the real, computed outcome
  });

  it("rejects approving a proposal that never required approval (no PENDING_APPROVAL state)", async () => {
    const proposal = await proposeCrossSellWithDiscount(200);
    await evaluate(proposal.id); // ALLOW -> AUTHORIZED directly
    const res = await approve(proposal.id);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("INVALID_STATE_TRANSITION");
  });
});
