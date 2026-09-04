/**
 * PART 07 — Razorpay Test Mode payment integration tests. Follows the
 * same real-seeded-catalog + real Policy Engine + real `CommerceExecution
 * Service` pattern established in `commerce.test.ts` (PART 06): a
 * proposal is carried all the way through to a real `READY_FOR_PAYMENT`
 * checkout, and only then handed to the payment endpoints under test —
 * exactly the chain PART 07 must consume, never a shortcut around it.
 *
 * Every provider interaction goes through `MockPaymentGateway` — no real
 * network call, no live Razorpay Test Mode credentials required to run
 * this suite (PART 07 §9, §115).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildAuthedTestApp, getTestMerchantId } from "./test-helpers/test-app.js";
import { prisma } from "./db/client.js";
import { proposeGrowthAction } from "./modules/merchant-agent/service.js";
import { createFixtureProvider } from "./modules/agents/providers/fixture-provider.js";
import { getMockPaymentGatewayForTests, getPaymentGateway } from "./modules/payments/gateway-factory.js";
import { MOCK_KEY_SECRET, MOCK_WEBHOOK_SECRET } from "./modules/payments/mock-gateway.js";
import { ProviderGatewayError, type ProviderPaymentInfo } from "./modules/payments/gateway.js";
import { computeClientCompletionSignature, computeWebhookSignature } from "./modules/payments/razorpay-signature.js";

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
  app = await buildAuthedTestApp();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

beforeEach(() => {
  // Fresh mock gateway state per test — no leftover queued errors from a
  // previous test bleeding into the next.
  const gateway = getPaymentGateway();
  expect(gateway?.provider).toBe("MOCK");
});

async function proposeCrossSell() {
  const merchantId = await getTestMerchantId(prisma);
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

/** Builds a real, authorized, READY_FOR_PAYMENT checkout — the exact
 * handoff PART 07 must consume. Returns the checkout id and the
 * workflowId (the proposal's own traceId) for ledger assertions. */
async function readyCheckout(): Promise<{ checkoutId: string; orderId: string; workflowId: string; amountMinor: number; currency: string }> {
  const proposal = await proposeCrossSell();
  const evalRes = await app.inject({ method: "POST", url: "/api/v1/policy/evaluate", payload: { proposalId: proposal.id } });
  const authorizationId = evalRes.json().authorization.id as string;
  const variantId = await cheapestActiveVariant(proposal.primaryProductId);
  const checkoutRes = await app.inject({
    method: "POST",
    url: "/api/v1/commerce/checkout",
    payload: { authorizationId, selection: { productId: proposal.primaryProductId, variantId, quantity: 1 }, idempotencyKey: randomUUID() },
  });
  expect(checkoutRes.statusCode).toBe(200);
  const body = checkoutRes.json();
  return { checkoutId: body.checkoutId, orderId: body.orderId, workflowId: proposal.traceId, amountMinor: body.totals.totalMinor, currency: body.totals.currency };
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

describe("Payments — golden path via webhook (PART 07 §180)", () => {
  it("captures a payment from a verified webhook and marks the order PAID", async () => {
    const { checkoutId, orderId, workflowId, amountMinor, currency } = await readyCheckout();
    const initRes = await initiate(checkoutId);
    expect(initRes.statusCode).toBe(200);
    const init = initRes.json();
    expect(init.testMode).toBe(true);
    expect(init.provider).toBe("MOCK");
    expect(typeof init.keyId).toBe("string");

    const webhookRes = await deliverWebhook(
      "payment.captured",
      paymentEntity({ order_id: init.providerOrderId, amount: amountMinor, currency, status: "captured" }),
    );
    expect(webhookRes.statusCode).toBe(200);

    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: init.paymentId } });
    expect(payment.state).toBe("CAPTURED");
    expect(payment.capturedAt).not.toBeNull();

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe("PAID");

    const checkout = await prisma.checkoutSession.findUniqueOrThrow({ where: { id: checkoutId } });
    expect(checkout.status).toBe("COMPLETED");

    const verifyRes = await app.inject({ method: "GET", url: `/api/v1/action-ledger/workflows/${workflowId}/verify` });
    expect(verifyRes.json().valid).toBe(true);
    const events = await prisma.agentAction.findMany({ where: { workflowId }, orderBy: { sequence: "asc" } });
    expect(events.map((e) => e.actionType)).toEqual(
      expect.arrayContaining(["PAYMENT_INITIATION_REQUESTED", "PROVIDER_ORDER_CREATED", "WEBHOOK_RECEIVED", "WEBHOOK_SIGNATURE_VERIFIED", "PAYMENT_CAPTURED"]),
    );
  });
});

describe("Payments — golden path via client verification + provider fetch (PART 07 §36-§41)", () => {
  it("verifies a signed client completion and resolves state from a real provider fetch", async () => {
    const { checkoutId, amountMinor, currency } = await readyCheckout();
    const init = (await initiate(checkoutId)).json();

    const providerPaymentId = `mock_pay_${randomUUID()}`;
    getMockPaymentGatewayForTests().seedPayment({
      providerPaymentId,
      providerOrderId: init.providerOrderId,
      amountMinor,
      currency,
      providerStatus: "captured",
      method: "card",
      errorCode: null,
      errorDescription: null,
      capturedAt: new Date(),
    });
    const signature = computeClientCompletionSignature(init.providerOrderId, providerPaymentId, MOCK_KEY_SECRET);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/payments/razorpay/verify",
      payload: { paymentId: init.paymentId, razorpayOrderId: init.providerOrderId, razorpayPaymentId: providerPaymentId, razorpaySignature: signature },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().state).toBe("CAPTURED");
  });

  it("rejects an invalid client completion signature without mutating payment state", async () => {
    const { checkoutId } = await readyCheckout();
    const init = (await initiate(checkoutId)).json();

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/payments/razorpay/verify",
      payload: { paymentId: init.paymentId, razorpayOrderId: init.providerOrderId, razorpayPaymentId: "mock_pay_forged", razorpaySignature: "not-a-real-signature" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("PAYMENT_VERIFICATION_FAILED");

    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: init.paymentId } });
    expect(payment.state).toBe("CREATED");
  });

  it("rejects a valid-looking signature that references a different provider order than this payment's own", async () => {
    const { checkoutId } = await readyCheckout();
    const init = (await initiate(checkoutId)).json();
    const foreignOrderId = `mock_order_${randomUUID()}`;
    const foreignPaymentId = `mock_pay_${randomUUID()}`;
    // A genuinely valid HMAC signature — just for the WRONG order.
    const signature = computeClientCompletionSignature(foreignOrderId, foreignPaymentId, MOCK_KEY_SECRET);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/payments/razorpay/verify",
      payload: { paymentId: init.paymentId, razorpayOrderId: foreignOrderId, razorpayPaymentId: foreignPaymentId, razorpaySignature: signature },
    });
    expect(res.statusCode).toBe(400);
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: init.paymentId } });
    expect(payment.state).toBe("CREATED");
  });
});

describe("Payments — webhook security (PART 07 §117, §129, §178)", () => {
  it("rejects a tampered payload even with the original signature header, causing no state mutation", async () => {
    const { checkoutId, amountMinor, currency } = await readyCheckout();
    const init = (await initiate(checkoutId)).json();

    const originalBody = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: paymentEntity({ order_id: init.providerOrderId, amount: amountMinor, currency, status: "captured" }) } } });
    const signature = computeWebhookSignature(originalBody, MOCK_WEBHOOK_SECRET);
    const tamperedBody = originalBody.replace(`"amount":${amountMinor}`, `"amount":1`);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/payments/webhooks/razorpay",
      payload: tamperedBody,
      headers: { "content-type": "application/json", "x-razorpay-signature": signature },
    });
    expect(res.statusCode).toBe(400);

    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: init.paymentId } });
    expect(payment.state).toBe("CREATED");
  });

  it("rejects a missing/invalid signature header", async () => {
    const body = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: paymentEntity({}) } } });
    const res = await app.inject({ method: "POST", url: "/api/v1/payments/webhooks/razorpay", payload: body, headers: { "content-type": "application/json" } });
    expect(res.statusCode).toBe(400);
  });
});

describe("Payments — duplicate and out-of-order webhook events (PART 07 §118-§119, §177, §179)", () => {
  it("processes the identical event exactly once on redelivery", async () => {
    const { checkoutId, orderId, amountMinor, currency } = await readyCheckout();
    const init = (await initiate(checkoutId)).json();
    const entity = paymentEntity({ order_id: init.providerOrderId, amount: amountMinor, currency, status: "captured" });

    const first = await deliverWebhook("payment.captured", entity);
    const second = await deliverWebhook("payment.captured", entity);
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe("PAID");

    const events = await prisma.paymentProviderEvent.findMany({ where: { providerOrderId: init.providerOrderId } });
    expect(events).toHaveLength(1); // the identical redelivery never created a second row

    const capturedLedgerEvents = await prisma.agentAction.findMany({ where: { relatedEntityId: init.paymentId, actionType: "PAYMENT_CAPTURED" } });
    expect(capturedLedgerEvents).toHaveLength(1); // no duplicate observed-revenue effect
  });

  it("does not regress a captured payment when a stale authorized event arrives afterward", async () => {
    const { checkoutId, amountMinor, currency } = await readyCheckout();
    const init = (await initiate(checkoutId)).json();
    const providerPaymentId = `mock_pay_${randomUUID()}`;

    const capturedRes = await deliverWebhook("payment.captured", paymentEntity({ id: providerPaymentId, order_id: init.providerOrderId, amount: amountMinor, currency, status: "captured" }));
    expect(capturedRes.statusCode).toBe(200);

    const staleRes = await deliverWebhook("payment.authorized", paymentEntity({ id: providerPaymentId, order_id: init.providerOrderId, amount: amountMinor, currency, status: "authorized" }));
    expect(staleRes.statusCode).toBe(200); // accepted (valid signature) but the transition itself is rejected

    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: init.paymentId } });
    expect(payment.state).toBe("CAPTURED"); // never regressed

    const rejected = await prisma.agentAction.findMany({ where: { relatedEntityId: init.paymentId, actionType: "PAYMENT_STATE_TRANSITION_REJECTED" } });
    expect(rejected.length).toBeGreaterThan(0);
  });
});

describe("Payments — financial integrity (PART 07 §55-§57, §121-§124)", () => {
  it("refuses to capture on an amount mismatch and leaves the payment UNKNOWN", async () => {
    const { checkoutId, currency } = await readyCheckout();
    const init = (await initiate(checkoutId)).json();

    const res = await deliverWebhook("payment.captured", paymentEntity({ order_id: init.providerOrderId, amount: 1, currency, status: "captured" }));
    expect(res.statusCode).toBe(200);

    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: init.paymentId } });
    expect(payment.state).toBe("UNKNOWN");
    expect(payment.capturedAt).toBeNull();

    const integrityEvents = await prisma.agentAction.findMany({ where: { relatedEntityId: init.paymentId, actionType: "PAYMENT_FINANCIAL_INTEGRITY_ERROR" } });
    expect(integrityEvents.length).toBeGreaterThan(0);
  });

  it("refuses to capture on a currency mismatch", async () => {
    const { checkoutId, amountMinor } = await readyCheckout();
    const init = (await initiate(checkoutId)).json();

    const res = await deliverWebhook("payment.captured", paymentEntity({ order_id: init.providerOrderId, amount: amountMinor, currency: "USD", status: "captured" }));
    expect(res.statusCode).toBe(200);

    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: init.paymentId } });
    expect(payment.state).toBe("UNKNOWN");
  });

  it("does not resolve a webhook referencing an unknown provider order", async () => {
    const res = await deliverWebhook("payment.captured", paymentEntity({ order_id: `mock_order_${randomUUID()}`, amount: 100, status: "captured" }));
    expect(res.statusCode).toBe(200); // acknowledged (valid signature) but nothing to apply it to

    const event = await prisma.paymentProviderEvent.findFirstOrThrow({ where: { eventType: "payment.captured" }, orderBy: { receivedAt: "desc" } });
    expect(event.processingStatus).toBe("UNRESOLVED");
  });
});

describe("Payments — checkout/authorization boundary (PART 07 §137-§139)", () => {
  it("refuses to initiate payment for a checkout that is not payable", async () => {
    const { checkoutId } = await readyCheckout();
    await prisma.checkoutSession.update({ where: { id: checkoutId }, data: { status: "CANCELLED" } });
    const res = await initiate(checkoutId);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("CHECKOUT_NOT_PAYABLE");
  });

  it("refuses to initiate payment for an expired checkout", async () => {
    const { checkoutId } = await readyCheckout();
    await prisma.checkoutSession.update({ where: { id: checkoutId }, data: { expiresAt: new Date(Date.now() - 60_000) } });
    const res = await initiate(checkoutId);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("CHECKOUT_EXPIRED");
  });

  it("ignores a client-submitted amount/currency in the initiation request — the schema has no such field", async () => {
    const { checkoutId, amountMinor } = await readyCheckout();
    const res = await app.inject({ method: "POST", url: "/api/v1/payments/initiate", payload: { checkoutId, amountMinor: 1, currency: "USD" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().amountMinor).toBe(amountMinor);
  });
});

describe("Payments — initiation idempotency and concurrency (PART 07 §90-§93, §125-§126)", () => {
  it("returns the same provider order on a repeated initiation call", async () => {
    const { checkoutId } = await readyCheckout();
    const first = await initiate(checkoutId);
    const second = await initiate(checkoutId);
    expect(first.json().providerOrderId).toBe(second.json().providerOrderId);
    expect(first.json().paymentId).toBe(second.json().paymentId);

    const payments = await prisma.payment.count({ where: { checkoutId } });
    expect(payments).toBe(1);
  });

  it("two concurrent initiation calls for the same checkout produce exactly one payment attempt", async () => {
    const { checkoutId } = await readyCheckout();
    const [a, b] = await Promise.all([initiate(checkoutId), initiate(checkoutId)]);
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    expect(a.json().providerOrderId).toBe(b.json().providerOrderId);

    const payments = await prisma.payment.count({ where: { checkoutId } });
    expect(payments).toBe(1);
  });

  it("does not create a second attempt after a definitive provider order-creation failure", async () => {
    const { checkoutId } = await readyCheckout();
    getMockPaymentGatewayForTests().queueOrderCreationError(new ProviderGatewayError("PROVIDER_VALIDATION_ERROR", "simulated bad request"));
    const first = await initiate(checkoutId);
    expect(first.statusCode).toBe(502);

    const second = await initiate(checkoutId);
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe("PAYMENT_ALREADY_ATTEMPTED");
  });

  it("a provider timeout leaves the payment recoverable via a subsequent initiation attempt", async () => {
    const { checkoutId } = await readyCheckout();
    getMockPaymentGatewayForTests().queueOrderCreationError(new ProviderGatewayError("PROVIDER_TIMEOUT", "simulated timeout"));
    const first = await initiate(checkoutId);
    expect(first.statusCode).toBe(502);

    const payment = await prisma.payment.findFirstOrThrow({ where: { checkoutId } });
    expect(payment.state).toBe("UNKNOWN");
    expect(payment.providerOrderId).toBeNull();

    const second = await initiate(checkoutId);
    expect(second.statusCode).toBe(200);
    expect(second.json().providerOrderId).toEqual(expect.any(String));
  });
});

describe("Payments — reconciliation (PART 07 §40, §111)", () => {
  it("resolves a payment's state from a direct provider fetch", async () => {
    const { checkoutId, amountMinor, currency } = await readyCheckout();
    const init = (await initiate(checkoutId)).json();
    const providerPaymentId = `mock_pay_${randomUUID()}`;

    // Simulate a lost webhook: the client never verified, but a real
    // payment was authorized on Razorpay's side.
    await prisma.payment.update({ where: { id: init.paymentId }, data: { providerPaymentId } });
    const providerInfo: ProviderPaymentInfo = {
      providerPaymentId,
      providerOrderId: init.providerOrderId,
      amountMinor,
      currency,
      providerStatus: "captured",
      method: "upi",
      errorCode: null,
      errorDescription: null,
      capturedAt: new Date(),
    };
    getMockPaymentGatewayForTests().seedPayment(providerInfo);

    const res = await app.inject({ method: "POST", url: `/api/v1/payments/${init.paymentId}/reconcile` });
    expect(res.statusCode).toBe(200);
    expect(res.json().state).toBe("CAPTURED");
  });

  it("recovers a stranded payment by provider order lookup when no payment reference is known", async () => {
    const { checkoutId, amountMinor, currency } = await readyCheckout();
    const init = (await initiate(checkoutId)).json();
    const providerPaymentId = `mock_pay_${randomUUID()}`;

    // The customer completed checkout, but the browser closed before the
    // callback and no webhook arrived: we hold a provider ORDER and no
    // provider PAYMENT id, so the row is stranded at CREATED.
    const before = await prisma.payment.findUniqueOrThrow({ where: { id: init.paymentId } });
    expect(before.providerPaymentId).toBeNull();

    getMockPaymentGatewayForTests().seedPayment({
      providerPaymentId,
      providerOrderId: init.providerOrderId,
      amountMinor,
      currency,
      providerStatus: "captured",
      method: "netbanking",
      errorCode: null,
      errorDescription: null,
      capturedAt: new Date(),
    });

    const res = await app.inject({ method: "POST", url: `/api/v1/payments/${init.paymentId}/reconcile` });
    expect(res.statusCode).toBe(200);
    expect(res.json().state).toBe("CAPTURED");
    expect(res.json().providerPaymentId).toBe(providerPaymentId);
  });

  it("records a recovered reference even when the provider reports no state change", async () => {
    const { checkoutId, amountMinor, currency } = await readyCheckout();
    const init = (await initiate(checkoutId)).json();
    const providerPaymentId = `mock_pay_${randomUUID()}`;

    // Provider still reports `created`, which maps to the state we are
    // already in. The state machine treats that as an idempotent no-op —
    // the reference must still be persisted, or the webhook that
    // eventually arrives for it can never be matched to this row.
    getMockPaymentGatewayForTests().seedPayment({
      providerPaymentId,
      providerOrderId: init.providerOrderId,
      amountMinor,
      currency,
      providerStatus: "created",
      method: "netbanking",
      errorCode: null,
      errorDescription: null,
      capturedAt: null,
    });

    const res = await app.inject({ method: "POST", url: `/api/v1/payments/${init.paymentId}/reconcile` });
    expect(res.statusCode).toBe(200);
    expect(res.json().state).toBe("CREATED");
    expect(res.json().providerPaymentId).toBe(providerPaymentId);
  });

  it("refuses to reconcile when the provider has no payment on the order yet", async () => {
    const { checkoutId } = await readyCheckout();
    const init = (await initiate(checkoutId)).json();

    const res = await app.inject({ method: "POST", url: `/api/v1/payments/${init.paymentId}/reconcile` });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.message).toMatch(/has not completed checkout/i);
  });

  it("refuses to guess between two settled payments on the same order", async () => {
    const { checkoutId, amountMinor, currency } = await readyCheckout();
    const init = (await initiate(checkoutId)).json();
    const gateway = getMockPaymentGatewayForTests();

    for (const status of ["captured", "authorized"]) {
      gateway.seedPayment({
        providerPaymentId: `mock_pay_${randomUUID()}`,
        providerOrderId: init.providerOrderId,
        amountMinor,
        currency,
        providerStatus: status,
        method: "netbanking",
        errorCode: null,
        errorDescription: null,
        capturedAt: null,
      });
    }

    const res = await app.inject({ method: "POST", url: `/api/v1/payments/${init.paymentId}/reconcile` });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.message).toMatch(/Refusing to guess/i);
  });

  it("enforces a short cooldown between reconciliation attempts", async () => {
    const { checkoutId, amountMinor, currency } = await readyCheckout();
    const init = (await initiate(checkoutId)).json();
    const providerPaymentId = `mock_pay_${randomUUID()}`;
    await prisma.payment.update({ where: { id: init.paymentId }, data: { providerPaymentId } });
    getMockPaymentGatewayForTests().seedPayment({ providerPaymentId, providerOrderId: init.providerOrderId, amountMinor, currency, providerStatus: "authorized", method: "card", errorCode: null, errorDescription: null, capturedAt: null });

    const first = await app.inject({ method: "POST", url: `/api/v1/payments/${init.paymentId}/reconcile` });
    expect(first.statusCode).toBe(200);
    const second = await app.inject({ method: "POST", url: `/api/v1/payments/${init.paymentId}/reconcile` });
    expect(second.statusCode).toBe(409);
  });
});

describe("Payments — failure taxonomy (PART 07 §49-§50, §181)", () => {
  it("normalizes a webhook-reported failure into the closed taxonomy and leaves the order unpaid", async () => {
    const { checkoutId, orderId, amountMinor, currency } = await readyCheckout();
    const init = (await initiate(checkoutId)).json();

    const res = await deliverWebhook(
      "payment.failed",
      paymentEntity({ order_id: init.providerOrderId, amount: amountMinor, currency, status: "failed", error_code: "BAD_REQUEST_ERROR", error_description: "Your card has insufficient funds." }),
    );
    expect(res.statusCode).toBe(200);

    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: init.paymentId } });
    expect(payment.state).toBe("FAILED");
    expect(payment.failureCategory).toBe("INSUFFICIENT_FUNDS");

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe("FAILED");

    const failedLedgerEvents = await prisma.agentAction.findMany({ where: { relatedEntityId: init.paymentId, actionType: "PAYMENT_FAILED" } });
    expect(failedLedgerEvents).toHaveLength(1);
    expect((failedLedgerEvents[0]!.metadata as { recoveryStatus: string }).recoveryStatus).toBe("NOT_EVALUATED");
  });
});

describe("Payments — read API (PART 07 §71)", () => {
  it("returns full payment detail via GET /payments/:id", async () => {
    const { checkoutId, amountMinor, currency } = await readyCheckout();
    const init = (await initiate(checkoutId)).json();
    const res = await app.inject({ method: "GET", url: `/api/v1/payments/${init.paymentId}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.amountMinor).toBe(amountMinor);
    expect(body.currency).toBe(currency);
    expect(body.state).toBe("CREATED");
  });

  it("404s for a payment that does not exist", async () => {
    const res = await app.inject({ method: "GET", url: `/api/v1/payments/${randomUUID()}` });
    expect(res.statusCode).toBe(404);
  });

  it("surfaces the current payment summary on the checkout read endpoint", async () => {
    const { checkoutId } = await readyCheckout();
    await initiate(checkoutId);
    const res = await app.inject({ method: "GET", url: `/api/v1/commerce/checkouts/${checkoutId}` });
    expect(res.json().payment).not.toBeNull();
    expect(res.json().payment.state).toBe("CREATED");
  });
});

/**
 * PART 14 — found by clicking "Let the agent reconcile payment" as a
 * merchant, and by watching the Merchant Agent's own headline objective
 * fail on every autonomous cycle.
 *
 * `Payment.provider` records who created the payment; `reconcilePayment`
 * never compared it to the gateway now configured. On a server holding
 * Razorpay credentials the agent dutifully asked Razorpay about
 * `mock_order_…` identifiers — a call that cannot succeed, once per
 * payment, every cycle, reported to the merchant as "an unexpected error
 * stopped this step" and logged nowhere.
 */
describe("Payments — reconciling across providers (PART 14)", () => {
  it("refuses to ask one provider about another provider's payment", async () => {
    const { checkoutId } = await readyCheckout();
    const init = (await initiate(checkoutId)).json();

    // The gateway under test is MOCK. Re-stamp the row as a payment some
    // other provider created — exactly the shape the seeded Razorpay data
    // has on a Razorpay-configured server.
    await prisma.payment.update({ where: { id: init.paymentId }, data: { provider: "X402" } });

    const res = await app.inject({ method: "POST", url: `/api/v1/payments/${init.paymentId}/reconcile` });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    const body = res.json();
    // The merchant must be able to read WHY, not just that it failed.
    expect(body.error.message).toMatch(/X402/);
    expect(body.error.message).toMatch(/MOCK/);

    // And it must be classified as a guardrail declining, not an outage —
    // CONFLICT is in `REFUSAL_CODES`, so the agent counts it as REFUSED.
    expect(body.error.code).toBe("CONFLICT");

    // Nothing was touched.
    const after = await prisma.payment.findUniqueOrThrow({ where: { id: init.paymentId } });
    expect(after.state).toBe("CREATED");
    expect(after.lastReconciledAt).toBeNull();
  });
});
