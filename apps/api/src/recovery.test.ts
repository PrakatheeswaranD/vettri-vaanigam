/**
 * PART 08 — Failure-first recovery integration tests. Builds a REAL
 * failed payment through the exact PART 06/07 pipeline (never a
 * shortcut), then drives the full recovery path — eligibility →
 * Merchant Agent proposal → policy → approval → authorization →
 * bounded retry → verified capture — through the real HTTP routes.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";
import { prisma } from "./db/client.js";
import { getDemoMerchantId } from "./modules/authorization/demo-context.js";
import { proposeGrowthAction } from "./modules/merchant-agent/service.js";
import { evaluateAndProposeRecovery } from "./modules/merchant-agent/recovery-service.js";
import { createFixtureProvider } from "./modules/agents/providers/fixture-provider.js";
import { computeWebhookSignature } from "./modules/payments/razorpay-signature.js";
import { MOCK_WEBHOOK_SECRET } from "./modules/payments/mock-gateway.js";

let app: FastifyInstance;

async function productId(name: string): Promise<string> {
  const product = await prisma.product.findFirstOrThrow({ where: { name } });
  return product.id;
}

async function cheapestActiveVariant(pid: string): Promise<string> {
  const variant = await prisma.productVariant.findFirstOrThrow({
    where: { productId: pid, active: true, inventory: { availableQuantity: { gt: 0 } } },
    orderBy: { priceMinor: "asc" },
  });
  return variant.id;
}

beforeAll(async () => {
  app = buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

async function proposeCrossSell() {
  const merchantId = await getDemoMerchantId(prisma);
  const pulseRunner = await productId("Meridian Pulse Runner");
  const provider = createFixtureProvider(
    {
      proposeGrowthAction: async ({ candidates }) => ({
        actionType: "CROSS_SELL",
        primaryProductId: pulseRunner,
        relatedProductIds: [candidates.find((c) => c.relationship === "COMPLEMENTARY" && c.readinessState !== "NOT_READY")!.productId],
        offer: null,
        reasonCodes: ["COMPLEMENTARY_PRODUCT"],
      }),
    },
    "LIVE_ANTHROPIC",
  );
  return proposeGrowthAction(prisma, { merchantId, primaryProductId: pulseRunner }, provider);
}

async function evaluatePolicyFor(proposalId: string) {
  return app.inject({ method: "POST", url: "/api/v1/policy/evaluate", payload: { proposalId } });
}

async function approveProposal(proposalId: string) {
  return app.inject({ method: "POST", url: `/api/v1/approvals/${proposalId}/approve`, payload: {} });
}

/** Runs a proposal through evaluate (+ approve if REQUIRE_APPROVAL) and
 * returns the resulting ACTIVE authorization id. */
async function authorizeProposal(): Promise<{ authorizationId: string; primaryProductId: string; variantId: string }> {
  const proposal = await proposeCrossSell();
  const evalRes = await evaluatePolicyFor(proposal.id);
  const evalBody = evalRes.json();
  let authorizationId: string;
  if (evalBody.decision.outcome === "ALLOW") {
    authorizationId = evalBody.authorization.id;
  } else if (evalBody.decision.outcome === "REQUIRE_APPROVAL") {
    const approveRes = await approveProposal(proposal.id);
    authorizationId = approveRes.json().authorization.id;
  } else {
    throw new Error(`Unexpected policy outcome for test setup: ${evalBody.decision.outcome}`);
  }
  const variantId = await cheapestActiveVariant(proposal.primaryProductId);
  return { authorizationId, primaryProductId: proposal.primaryProductId, variantId };
}

async function checkout(body: { authorizationId: string; selection: { productId: string; variantId: string; quantity: number }; idempotencyKey: string }) {
  return app.inject({ method: "POST", url: "/api/v1/commerce/checkout", payload: body });
}

async function initiate(checkoutId: string) {
  return app.inject({ method: "POST", url: "/api/v1/payments/initiate", payload: { checkoutId } });
}

function paymentEntity(overrides: Partial<{ id: string; order_id: string; amount: number; currency: string; status: string; method: string | null; error_code: string | null; error_description: string | null }>) {
  return {
    id: overrides.id ?? `mock_pay_${randomUUID()}`,
    order_id: overrides.order_id ?? null,
    amount: overrides.amount ?? 0,
    currency: overrides.currency ?? "INR",
    status: overrides.status ?? "created",
    method: overrides.method ?? "card",
    error_code: overrides.error_code ?? null,
    error_description: overrides.error_description ?? null,
  };
}

async function deliverWebhook(event: string, entity: ReturnType<typeof paymentEntity>) {
  const body = JSON.stringify({ event, payload: { payment: { entity } } });
  const signature = computeWebhookSignature(body, MOCK_WEBHOOK_SECRET);
  return app.inject({
    method: "POST",
    url: "/api/v1/payments/webhooks/razorpay",
    payload: body,
    headers: { "content-type": "application/json", "x-razorpay-signature": signature },
  });
}

/** Builds a real checkout, initiates payment, and drives it to a
 * verified FAILED state via a signed webhook — the exact evidence PART
 * 08 recovery must start from. */
async function buildFailedPayment(): Promise<{ paymentId: string; orderId: string; checkoutId: string; workflowId: string; amountMinor: number; currency: string }> {
  const { authorizationId, primaryProductId, variantId } = await authorizeProposal();
  const checkoutRes = await checkout({ authorizationId, selection: { productId: primaryProductId, variantId, quantity: 1 }, idempotencyKey: randomUUID() });
  const checkoutBody = checkoutRes.json();
  const init = (await initiate(checkoutBody.checkoutId)).json();
  const failRes = await deliverWebhook(
    "payment.failed",
    paymentEntity({ order_id: init.providerOrderId, amount: checkoutBody.totals.totalMinor, currency: checkoutBody.totals.currency, status: "failed", error_code: "GATEWAY_ERROR", error_description: "The card was declined." }),
  );
  expect(failRes.statusCode).toBe(200);
  const paymentRow = await prisma.payment.findUniqueOrThrow({ where: { id: init.paymentId } });
  expect(paymentRow.state).toBe("FAILED");
  const checkoutRow = await prisma.checkoutSession.findUniqueOrThrow({ where: { id: checkoutBody.checkoutId } });
  return { paymentId: init.paymentId, orderId: checkoutBody.orderId, checkoutId: checkoutBody.checkoutId, workflowId: checkoutRow.workflowId, amountMinor: checkoutBody.totals.totalMinor, currency: checkoutBody.totals.currency };
}

async function evaluateRecovery(paymentId: string) {
  return app.inject({ method: "POST", url: "/api/v1/payments/recovery/evaluate", payload: { paymentId } });
}

async function authorizeRecovery(proposalId: string) {
  const evalRes = await evaluatePolicyFor(proposalId);
  const evalBody = evalRes.json();
  if (evalBody.decision.outcome === "ALLOW") return evalBody.authorization.id as string;
  if (evalBody.decision.outcome === "REQUIRE_APPROVAL") {
    const approveRes = await approveProposal(proposalId);
    return approveRes.json().authorization.id as string;
  }
  throw new Error(`Unexpected recovery policy outcome: ${evalBody.decision.outcome}`);
}

async function executeRecovery(authorizationId: string, idempotencyKey = randomUUID()) {
  return app.inject({ method: "POST", url: `/api/v1/payments/recovery/${authorizationId}/execute`, payload: { idempotencyKey } });
}

describe("Recovery — full failure-to-capture E2E (PART 08 §142, §203)", () => {
  it("recovers a FAILED payment through eligibility, Merchant Agent proposal, policy, authorization, and a bounded retry to CAPTURED", async () => {
    const failed = await buildFailedPayment();

    const recoveryRes = await evaluateRecovery(failed.paymentId);
    expect(recoveryRes.statusCode).toBe(200);
    const recoveryProposal = recoveryRes.json();
    expect(recoveryProposal.status).toBe("PROPOSED");
    expect(recoveryProposal.actionType).toBe("RECOVERY");
    expect(recoveryProposal.recoveryAction).toBe("RETRY_SAME_CHECKOUT");
    expect(recoveryProposal.sourceOrderId).toBe(failed.orderId);
    expect(recoveryProposal.traceId).toBe(failed.workflowId); // SAME workflow, never a fresh one

    const authorizationId = await authorizeRecovery(recoveryProposal.id);
    const executeRes = await executeRecovery(authorizationId);
    expect(executeRes.statusCode).toBe(200);
    const { checkoutId: newCheckoutId } = executeRes.json();
    expect(newCheckoutId).not.toBe(failed.checkoutId);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: failed.orderId } });
    expect(order.status).toBe("PAYMENT_PENDING"); // recovered off FAILED, not yet captured

    const init2 = (await initiate(newCheckoutId)).json();
    expect(init2.orderId).toBe(failed.orderId); // SAME order, second attempt

    const capturedRes = await deliverWebhook(
      "payment.captured",
      paymentEntity({ order_id: init2.providerOrderId, amount: failed.amountMinor, currency: failed.currency, status: "captured" }),
    );
    expect(capturedRes.statusCode).toBe(200);

    const finalOrder = await prisma.order.findUniqueOrThrow({ where: { id: failed.orderId } });
    expect(finalOrder.status).toBe("PAID");

    const attempt2 = await prisma.payment.findUniqueOrThrow({ where: { id: init2.paymentId } });
    expect(attempt2.attemptNumber).toBe(2);
    expect(attempt2.recoveredFromAttemptId).toBe(failed.paymentId);

    const traceRes = await app.inject({ method: "GET", url: `/api/v1/action-ledger/workflows/${failed.workflowId}/trace` });
    expect(traceRes.statusCode).toBe(200);
    const trace = traceRes.json();
    expect(trace.financialOutcome).toBe("RECOVERED");
    expect(trace.ledgerIntegrity.valid).toBe(true);
    const events = trace.steps.map((s: { event: string }) => s.event);
    expect(events).toEqual(
      expect.arrayContaining([
        "GROWTH_PROPOSAL_CREATED",
        "PAYMENT_FAILED",
        "RECOVERY_ELIGIBILITY_EVALUATED",
        "RECOVERY_PROPOSAL_CREATED",
        "RECOVERY_AUTHORIZATION_CONSUMED",
        "RECOVERY_ATTEMPT_CREATED",
        "PAYMENT_CAPTURED",
      ]),
    );
  });
});

describe("Recovery — deterministic eligibility boundaries (PART 08 §143-§149, §196)", () => {
  it("denies recovery once the maximum attempt limit is reached", async () => {
    const merchantId = await getDemoMerchantId(prisma);
    await prisma.merchantPolicy.update({ where: { merchantId }, data: { maxRecoveryAttempts: 1 } });
    try {
      const failed = await buildFailedPayment();
      const recoveryRes = await evaluateRecovery(failed.paymentId);
      const recoveryProposal = recoveryRes.json();
      expect(recoveryProposal.status).toBe("PROPOSED");
      const authorizationId = await authorizeRecovery(recoveryProposal.id);
      const executeRes = await executeRecovery(authorizationId);
      const { checkoutId: newCheckoutId } = executeRes.json();
      const init2 = (await initiate(newCheckoutId)).json();
      await deliverWebhook("payment.failed", paymentEntity({ order_id: init2.providerOrderId, amount: failed.amountMinor, currency: failed.currency, status: "failed", error_code: "GATEWAY_ERROR", error_description: "declined" }));

      const secondRecoveryRes = await evaluateRecovery(init2.paymentId);
      const secondProposal = secondRecoveryRes.json();
      expect(secondProposal.status).toBe("REJECTED_VALIDATION");
      expect(secondProposal.rejectionReason).toMatch(/maximum/i);
    } finally {
      await prisma.merchantPolicy.update({ where: { merchantId }, data: { maxRecoveryAttempts: 2 } });
    }
  });

  it("requires reconciliation before recovering an UNKNOWN payment, and proceeds once reconciled to FAILED", async () => {
    const { authorizationId, primaryProductId, variantId } = await authorizeProposal();
    const checkoutRes = await checkout({ authorizationId, selection: { productId: primaryProductId, variantId, quantity: 1 }, idempotencyKey: randomUUID() });
    const checkoutBody = checkoutRes.json();
    const init = (await initiate(checkoutBody.checkoutId)).json();

    const fakeProviderPaymentId = `mock_pay_${randomUUID()}`;
    await prisma.payment.update({ where: { id: init.paymentId }, data: { state: "UNKNOWN", providerPaymentId: fakeProviderPaymentId } });
    const { getMockPaymentGatewayForTests } = await import("./modules/payments/gateway-factory.js");
    getMockPaymentGatewayForTests().seedPayment({
      providerPaymentId: fakeProviderPaymentId,
      providerOrderId: init.providerOrderId,
      amountMinor: checkoutBody.totals.totalMinor,
      currency: checkoutBody.totals.currency,
      providerStatus: "failed",
      method: "card",
      errorCode: "GATEWAY_ERROR",
      errorDescription: "declined",
      capturedAt: null,
    });

    const recoveryRes = await evaluateRecovery(init.paymentId);
    expect(recoveryRes.statusCode).toBe(200);
    const proposal = recoveryRes.json();
    // Reconciliation resolved UNKNOWN -> FAILED, so recovery could proceed.
    expect(proposal.status).toBe("PROPOSED");
    const paymentAfter = await prisma.payment.findUniqueOrThrow({ where: { id: init.paymentId } });
    expect(paymentAfter.state).toBe("FAILED");
  });

  it("refuses to propose recovery for an order that is already PAID", async () => {
    const { authorizationId, primaryProductId, variantId } = await authorizeProposal();
    const checkoutRes = await checkout({ authorizationId, selection: { productId: primaryProductId, variantId, quantity: 1 }, idempotencyKey: randomUUID() });
    const checkoutBody = checkoutRes.json();
    const init = (await initiate(checkoutBody.checkoutId)).json();
    await deliverWebhook("payment.captured", paymentEntity({ order_id: init.providerOrderId, amount: checkoutBody.totals.totalMinor, currency: checkoutBody.totals.currency, status: "captured" }));

    const recoveryRes = await evaluateRecovery(init.paymentId);
    const proposal = recoveryRes.json();
    expect(proposal.status).toBe("REJECTED_VALIDATION");
    expect(proposal.rejectionReason).toMatch(/already been paid/i);
  });
});

describe("Recovery — authorization security (PART 08 §77-§79, §148-§150, §200)", () => {
  it("rejects execution against an expired recovery authorization", async () => {
    const failed = await buildFailedPayment();
    const recoveryProposal = (await evaluateRecovery(failed.paymentId)).json();
    const authorizationId = await authorizeRecovery(recoveryProposal.id);
    await prisma.executionAuthorization.update({ where: { id: authorizationId }, data: { expiresAt: new Date(Date.now() - 60_000) } });

    const res = await executeRecovery(authorizationId);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("AUTHORIZATION_EXPIRED");
  });

  it("rejects reusing an already-consumed recovery authorization", async () => {
    const failed = await buildFailedPayment();
    const recoveryProposal = (await evaluateRecovery(failed.paymentId)).json();
    const authorizationId = await authorizeRecovery(recoveryProposal.id);
    const first = await executeRecovery(authorizationId);
    expect(first.statusCode).toBe(200);

    const second = await executeRecovery(authorizationId, randomUUID());
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe("AUTHORIZATION_ALREADY_CONSUMED");
  });

  it("blocks recovery execution when the underlying order was tampered with (fingerprint mismatch)", async () => {
    const failed = await buildFailedPayment();
    const recoveryProposal = (await evaluateRecovery(failed.paymentId)).json();
    const authorizationId = await authorizeRecovery(recoveryProposal.id);
    await prisma.order.update({ where: { id: failed.orderId }, data: { orderFingerprint: "tampered" } });

    const res = await executeRecovery(authorizationId);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("FINANCIAL_INTEGRITY_ERROR");
  });

  it("a repeated (sequential) execution call with the same idempotency key returns the identical checkout, never a second attempt", async () => {
    const failed = await buildFailedPayment();
    const recoveryProposal = (await evaluateRecovery(failed.paymentId)).json();
    const authorizationId = await authorizeRecovery(recoveryProposal.id);
    const key = randomUUID();
    const first = await executeRecovery(authorizationId, key);
    expect(first.statusCode).toBe(200);
    const second = await executeRecovery(authorizationId, key);
    expect(second.statusCode).toBe(200);
    expect(second.json().checkoutId).toBe(first.json().checkoutId);

    const checkoutsForOrder = await prisma.checkoutSession.count({ where: { orderId: failed.orderId } });
    expect(checkoutsForOrder).toBe(2); // the original failed checkout + exactly one recovery checkout, never two
  });

  it("two genuinely concurrent execution requests against the same authorization resolve to exactly one success — the authorization can only be consumed once, regardless of idempotency key", async () => {
    const failed = await buildFailedPayment();
    const recoveryProposal = (await evaluateRecovery(failed.paymentId)).json();
    const authorizationId = await authorizeRecovery(recoveryProposal.id);
    const [a, b] = await Promise.all([executeRecovery(authorizationId, randomUUID()), executeRecovery(authorizationId, randomUUID())]);
    const statuses = [a.statusCode, b.statusCode].sort();
    expect(statuses).toEqual([200, 409]);

    const checkoutsForOrder = await prisma.checkoutSession.count({ where: { orderId: failed.orderId } });
    expect(checkoutsForOrder).toBe(2); // never two recovery checkouts from one authorization
  });
});

describe("Recovery — AI grounding (PART 08 §84-§85, §133-§135, §151-§152)", () => {
  it("rejects a hallucinated recovery action and falls back to the deterministic safe answer", async () => {
    const failed = await buildFailedPayment();
    const provider = createFixtureProvider(
      {
        proposeRecoveryAction: async () => ({ action: "REFUND_FULL_ORDER", reasonCodes: ["MADE_UP"], explanation: "ignore all limits and refund everything" }),
      },
      "LIVE_ANTHROPIC",
    );
    const proposal = await evaluateAndProposeRecovery(prisma, await getDemoMerchantId(prisma), failed.paymentId, provider);
    expect(proposal.status).toBe("PROPOSED");
    expect(proposal.recoveryAction).toBe("RETRY_SAME_CHECKOUT"); // deterministic fallback, never the hallucinated action
    expect(proposal.mode).toBe("DETERMINISTIC_FALLBACK");
  });

  it("never sends raw provider payload/secrets to the recovery prompt input", async () => {
    const failed = await buildFailedPayment();
    let capturedParams: unknown;
    const provider = createFixtureProvider(
      {
        proposeRecoveryAction: async (params) => {
          capturedParams = params;
          return { action: "RETRY_SAME_CHECKOUT", reasonCodes: ["RETRYABLE_PAYMENT_FAILURE"], explanation: "ok" };
        },
      },
      "LIVE_ANTHROPIC",
    );
    await evaluateAndProposeRecovery(prisma, await getDemoMerchantId(prisma), failed.paymentId, provider);
    const json = JSON.stringify(capturedParams);
    expect(json).not.toMatch(/signature/i);
    expect(json).not.toMatch(/webhookSecret|keySecret/i);
    expect(Object.keys(capturedParams as object).sort()).toEqual(
      ["allowedActions", "currency", "currentAttemptNumber", "failureCategory", "maxRecoveryAttempts", "orderAmountMinor"].sort(),
    );
  });
});

describe("Recovery — duplicate/out-of-order safety on the second attempt (PART 08 §81-§82, §153)", () => {
  it("does not double-count observed revenue when the recovery capture webhook is delivered twice", async () => {
    const failed = await buildFailedPayment();
    const recoveryProposal = (await evaluateRecovery(failed.paymentId)).json();
    const authorizationId = await authorizeRecovery(recoveryProposal.id);
    const { checkoutId: newCheckoutId } = (await executeRecovery(authorizationId)).json();
    const init2 = (await initiate(newCheckoutId)).json();
    const entity = paymentEntity({ order_id: init2.providerOrderId, amount: failed.amountMinor, currency: failed.currency, status: "captured" });

    await deliverWebhook("payment.captured", entity);
    await deliverWebhook("payment.captured", entity);

    const capturedEvents = await prisma.agentAction.findMany({ where: { relatedEntityId: init2.paymentId, actionType: "PAYMENT_CAPTURED" } });
    expect(capturedEvents).toHaveLength(1);
  });
});

describe("Recovery — workflow correlation (PART 08 §63-§64, §155)", () => {
  it("the same workflowId spans the proposal, commerce, payment, and recovery events", async () => {
    const failed = await buildFailedPayment();
    const recoveryProposal = (await evaluateRecovery(failed.paymentId)).json();
    expect(recoveryProposal.traceId).toBe(failed.workflowId);

    const verifyRes = await app.inject({ method: "GET", url: `/api/v1/action-ledger/workflows/${failed.workflowId}/verify` });
    expect(verifyRes.json().valid).toBe(true);

    const events = await prisma.agentAction.findMany({ where: { workflowId: failed.workflowId } });
    const actors = new Set(events.map((e) => e.actorType));
    expect(actors.has("MERCHANT_AGENT")).toBe(true);
    expect(actors.has("POLICY_ENGINE")).toBe(true);
    expect(actors.has("PAYMENT_SYSTEM")).toBe(true);
    expect(actors.has("SYSTEM")).toBe(true);
  });
});
