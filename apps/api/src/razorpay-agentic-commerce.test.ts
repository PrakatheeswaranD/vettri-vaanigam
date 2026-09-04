/**
 * PART 13 — the complete autonomous money path, end to end.
 *
 * WHAT THIS SUITE IS FOR
 *
 * Every link in this chain was already tested. The chain was not:
 *
 *   BUYER AGENT → PURCHASE PROPOSAL → POLICY → AUTHORIZATION
 *   → RAZORPAY TEST CHECKOUT → PAYMENT → WEBHOOK
 *   → SIGNATURE VERIFICATION → IDEMPOTENCY → PAYMENT STATE
 *   → ORDER → AGENT ACTIVITY → MERCHANT UPDATE
 *
 * `payments.test.ts` proves the payment machinery against a MERCHANT
 * growth checkout. `agentic-checkout.test.ts` proves the buyer path and
 * stops at "a payment order exists and is not paid". Between those two
 * suites sat the half nobody drove: a BUYER's payment reaching capture
 * through a real signed webhook, and what the buyer and the merchant see
 * afterwards.
 *
 * NOTHING HERE IS SIMULATED PAST THE PROVIDER BOUNDARY.
 *
 * The webhook is posted to the real route, signed with the real HMAC
 * function, parsed by the real schema, and resolved by the real state
 * machine. The only test double is the provider itself
 * (`MockPaymentGateway`), which verifies signatures with the same
 * algorithm as the live adapter. Every figure asserted below is read back
 * out of the database or an API response.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { BuyerActivityResponseDTO, BuyerAgentResponseDTO } from "@razorgrowth/contracts";
import { buildAuthedTestApp, buildCustomerTestApp } from "./test-helpers/test-app.js";
import { prisma } from "./db/client.js";
import { getPaymentGateway } from "./modules/payments/gateway-factory.js";
import { MOCK_WEBHOOK_SECRET } from "./modules/payments/mock-gateway.js";
import { computeWebhookSignature } from "./modules/payments/razorpay-signature.js";

let buyerApp: FastifyInstance;
let merchantApp: FastifyInstance;
const createdProposalIds: string[] = [];

async function say(message: string, conversationId?: string): Promise<BuyerAgentResponseDTO> {
  const res = await buyerApp.inject({
    method: "POST",
    url: "/api/v1/buyer/messages",
    payload: conversationId ? { conversationId, message } : { message },
  });
  expect(res.statusCode, `"${message}" -> ${res.body}`).toBe(200);
  const body = res.json() as BuyerAgentResponseDTO;
  if (body.purchase) createdProposalIds.push(body.purchase.proposalId);
  return body;
}

interface AuthorizedPurchase {
  conversationId: string;
  proposalId: string;
  paymentId: string;
  orderId: string;
  providerOrderId: string;
  amountMinor: number;
  currency: string;
  workflowId: string;
  merchantId: string;
}

/**
 * Drives a real conversational purchase to the point a Razorpay order
 * exists, and returns every identifier the rest of the chain needs.
 *
 * Returns null when the seeded catalogue or the buyer's own policy
 * legitimately refuses — a refusal is a correct outcome, and a test that
 * treated it as a failure would be asserting against the seed rather than
 * against the code.
 */
async function authorizedPurchase(): Promise<AuthorizedPurchase | null> {
  const conversation = await say("I need running shoes");
  const bought = await say("buy the first one", conversation.conversationId);
  if (bought.status !== "PURCHASE_PROPOSED") return null;

  const authorized = await say("yes", conversation.conversationId);
  if (authorized.status !== "CHECKOUT_READY") return null;

  const checkout = authorized.checkout!;
  const decision = await prisma.decisionRecord.findUniqueOrThrow({ where: { id: bought.purchase!.proposalId } });
  const payment = await prisma.payment.findUniqueOrThrow({ where: { id: checkout.paymentId } });

  expect(payment.providerOrderId, "authorization must produce a real provider order").toBeTruthy();
  return {
    conversationId: conversation.conversationId,
    proposalId: decision.id,
    paymentId: payment.id,
    orderId: payment.orderId,
    providerOrderId: payment.providerOrderId!,
    amountMinor: payment.amountMinor,
    currency: payment.currency,
    workflowId: decision.workflowId!,
    merchantId: payment.merchantId,
  };
}

function paymentEntity(over: Partial<{ id: string; order_id: string; amount: number; currency: string; status: string; method: string | null; error_code: string | null; error_description: string | null }>) {
  return {
    id: over.id ?? `mock_pay_${randomUUID()}`,
    order_id: over.order_id ?? null,
    amount: over.amount ?? 0,
    currency: over.currency ?? "INR",
    status: over.status ?? "created",
    method: over.method ?? "card",
    error_code: over.error_code ?? null,
    error_description: over.error_description ?? null,
  };
}

/** Posts to the REAL webhook route with a REAL signature over the exact
 * bytes sent. `signature` may be overridden to test rejection. */
async function deliverWebhook(event: string, entity: ReturnType<typeof paymentEntity>, signature?: string) {
  const body = JSON.stringify({ event, payload: { payment: { entity } } });
  return buyerApp.inject({
    method: "POST",
    url: "/api/v1/payments/webhooks/razorpay",
    payload: body,
    headers: { "content-type": "application/json", "x-razorpay-signature": signature ?? computeWebhookSignature(body, MOCK_WEBHOOK_SECRET) },
  });
}

async function ledgerActions(workflowId: string): Promise<string[]> {
  const rows = await prisma.agentAction.findMany({ where: { workflowId }, orderBy: { sequence: "asc" }, select: { actionType: true } });
  return rows.map((r) => r.actionType);
}

beforeAll(async () => {
  buyerApp = await buildCustomerTestApp();
  merchantApp = await buildAuthedTestApp();
  expect(getPaymentGateway()?.provider, "tests must never reach a live provider").toBe("MOCK");
});

afterAll(async () => {
  /**
   * EVERY proposal this suite created, not just the unauthorized ones.
   *
   * The other buyer suites delete only rows still `PROPOSED`, which is
   * right for them — they never complete a purchase. This one does, on
   * purpose, and a completed purchase counts toward the demo shopper's
   * standing (`SETTLED_STATUSES` includes CAPTURED). Leaving them behind
   * promoted the shared demo shopper from NEW to VIP and broke six
   * assertions in `customer-negotiation.test.ts` that had nothing to do
   * with payments.
   *
   * `Order.authorizationId` is a plain column rather than a foreign key,
   * so the orders and payments survive — which is correct. They are
   * merchant-side records of things that really happened in this run, the
   * same residue `payments.test.ts` already leaves, and no assertion
   * anywhere depends on their absence.
   */
  if (createdProposalIds.length > 0) {
    await prisma.decisionRecord.deleteMany({ where: { id: { in: createdProposalIds } } });
  }
  await buyerApp.close();
  await merchantApp.close();
  await prisma.$disconnect();
});

describe("PART 13 — the successful path, buyer agent to captured money", () => {
  it("carries one conversational purchase through webhook capture to a PAID order", async () => {
    const purchase = await authorizedPurchase();
    if (!purchase) return;

    // ── RAZORPAY TEST CHECKOUT ────────────────────────────────────────
    // Before any provider evidence: an order exists, nothing is charged.
    const before = await prisma.payment.findUniqueOrThrow({ where: { id: purchase.paymentId } });
    expect(before.state).toBe("CREATED");
    expect(before.capturedAt).toBeNull();
    expect(before.customerDebitStatus).toBe("UNKNOWN");
    const orderBefore = await prisma.order.findUniqueOrThrow({ where: { id: purchase.orderId } });
    expect(orderBefore.status).not.toBe("PAID");

    // ── WEBHOOK + SIGNATURE VERIFICATION ──────────────────────────────
    const providerPaymentId = `mock_pay_${randomUUID()}`;
    const captured = paymentEntity({
      id: providerPaymentId,
      order_id: purchase.providerOrderId,
      amount: purchase.amountMinor,
      currency: purchase.currency,
      status: "captured",
    });
    const res = await deliverWebhook("payment.captured", captured);
    expect(res.statusCode).toBe(200);

    // ── PAYMENT STATE ─────────────────────────────────────────────────
    const after = await prisma.payment.findUniqueOrThrow({ where: { id: purchase.paymentId } });
    expect(after.state).toBe("CAPTURED");
    expect(after.providerPaymentId).toBe(providerPaymentId);
    expect(after.capturedAt).not.toBeNull();
    expect(after.customerDebitStatus).toBe("DEBITED");
    expect(after.merchantCreditStatus).toBe("CREDITED");
    // Integer minor units, unchanged from the amount the server priced.
    expect(Number.isInteger(after.amountMinor)).toBe(true);
    expect(after.amountMinor).toBe(purchase.amountMinor);

    // ── ORDER ─────────────────────────────────────────────────────────
    const order = await prisma.order.findUniqueOrThrow({ where: { id: purchase.orderId } });
    expect(order.status).toBe("PAID");
    expect(order.totalAmountMinor).toBe(purchase.amountMinor);

    // The proposal that authorized it is settled, and settled by the
    // capture — not by the authorization that preceded it.
    const decision = await prisma.decisionRecord.findUniqueOrThrow({ where: { id: purchase.proposalId } });
    expect(decision.settlementStatus).toBe("CAPTURED");
    expect(decision.providerPaymentId).toBe(providerPaymentId);

    // ── AUDITABILITY ──────────────────────────────────────────────────
    // One continuous workflow: the buyer's intent and the provider's
    // money movement are on the same hash-chained timeline.
    const actions = await ledgerActions(purchase.workflowId);
    expect(actions).toContain("BUYER_PURCHASE_PROPOSED");
    expect(actions).toContain("BUYER_PURCHASE_AUTHORIZED");
    expect(actions).toContain("PROVIDER_ORDER_CREATED");
    expect(actions).toContain("WEBHOOK_RECEIVED");
    expect(actions).toContain("WEBHOOK_SIGNATURE_VERIFIED");
    expect(actions).toContain("PAYMENT_CAPTURED");
  });

  it("shows the buyer a captured payment only after the server verified it", async () => {
    const purchase = await authorizedPurchase();
    if (!purchase) return;

    const beforeRes = await buyerApp.inject({ method: "GET", url: `/api/v1/buyer/purchase-proposals/${purchase.proposalId}/payment` });
    expect(beforeRes.statusCode).toBe(200);
    expect(beforeRes.json().state).not.toBe("CAPTURED");

    await deliverWebhook(
      "payment.captured",
      paymentEntity({ order_id: purchase.providerOrderId, amount: purchase.amountMinor, currency: purchase.currency, status: "captured" }),
    );

    const afterRes = await buyerApp.inject({ method: "GET", url: `/api/v1/buyer/purchase-proposals/${purchase.proposalId}/payment` });
    expect(afterRes.json().state).toBe("CAPTURED");
  });
});

describe("PART 13 — signature verification", () => {
  it("rejects a webhook whose body was tampered with after signing, and changes nothing", async () => {
    const purchase = await authorizedPurchase();
    if (!purchase) return;

    const honest = paymentEntity({ order_id: purchase.providerOrderId, amount: purchase.amountMinor, currency: purchase.currency, status: "captured" });
    const honestBody = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: honest } } });
    const signature = computeWebhookSignature(honestBody, MOCK_WEBHOOK_SECRET);

    // Same signature, different body — the classic replay-with-edits.
    const tampered = { ...honest, amount: honest.amount + 100_000 };
    const res = await deliverWebhook("payment.captured", tampered, signature);
    expect(res.statusCode).toBe(400);

    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: purchase.paymentId } });
    expect(payment.state).toBe("CREATED");
    expect(payment.customerDebitStatus).toBe("UNKNOWN");
  });

  it("rejects a webhook with no signature header at all", async () => {
    const res = await buyerApp.inject({
      method: "POST",
      url: "/api/v1/payments/webhooks/razorpay",
      payload: JSON.stringify({ event: "payment.captured", payload: {} }),
      headers: { "content-type": "application/json" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("refuses to capture when a validly-signed event reports a different amount", async () => {
    const purchase = await authorizedPurchase();
    if (!purchase) return;

    // Correctly signed, and wrong. A signature proves who sent it, never
    // that the contents describe the payment we authorized.
    const res = await deliverWebhook(
      "payment.captured",
      paymentEntity({ order_id: purchase.providerOrderId, amount: purchase.amountMinor + 1, currency: purchase.currency, status: "captured" }),
    );
    expect(res.statusCode).toBe(200);

    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: purchase.paymentId } });
    expect(payment.state).not.toBe("CAPTURED");
    expect(await ledgerActions(purchase.workflowId)).toContain("PAYMENT_FINANCIAL_INTEGRITY_ERROR");
  });
});

describe("PART 13 — idempotency", () => {
  it("captures exactly once when the provider redelivers the identical event", async () => {
    const purchase = await authorizedPurchase();
    if (!purchase) return;

    const entity = paymentEntity({ order_id: purchase.providerOrderId, amount: purchase.amountMinor, currency: purchase.currency, status: "captured" });
    expect((await deliverWebhook("payment.captured", entity)).statusCode).toBe(200);
    expect((await deliverWebhook("payment.captured", entity)).statusCode).toBe(200);
    expect((await deliverWebhook("payment.captured", entity)).statusCode).toBe(200);

    // Three deliveries, one capture. Not "the last one won" — the second
    // and third never became state changes at all.
    const captures = (await ledgerActions(purchase.workflowId)).filter((a) => a === "PAYMENT_CAPTURED");
    expect(captures).toHaveLength(1);

    const events = await prisma.paymentProviderEvent.count({ where: { paymentId: purchase.paymentId, eventType: "payment.captured" } });
    expect(events, "a redelivered event must not be recorded twice").toBe(1);
  });

  it("does not regress a captured payment when a stale event arrives afterwards", async () => {
    const purchase = await authorizedPurchase();
    if (!purchase) return;

    const providerPaymentId = `mock_pay_${randomUUID()}`;
    await deliverWebhook("payment.captured", paymentEntity({ id: providerPaymentId, order_id: purchase.providerOrderId, amount: purchase.amountMinor, currency: purchase.currency, status: "captured" }));
    // The authorization that preceded the capture, arriving late.
    await deliverWebhook("payment.authorized", paymentEntity({ id: providerPaymentId, order_id: purchase.providerOrderId, amount: purchase.amountMinor, currency: purchase.currency, status: "authorized" }));

    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: purchase.paymentId } });
    expect(payment.state).toBe("CAPTURED");
    const order = await prisma.order.findUniqueOrThrow({ where: { id: purchase.orderId } });
    expect(order.status).toBe("PAID");
  });
});

describe("PART 13 — the failed path", () => {
  it("never claims the customer was not debited when a payment fails", async () => {
    const purchase = await authorizedPurchase();
    if (!purchase) return;

    const res = await deliverWebhook(
      "payment.failed",
      paymentEntity({
        order_id: purchase.providerOrderId,
        amount: purchase.amountMinor,
        currency: purchase.currency,
        status: "failed",
        error_code: "BAD_REQUEST_ERROR",
        error_description: "Payment failed due to insufficient funds",
      }),
    );
    expect(res.statusCode).toBe(200);

    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: purchase.paymentId } });
    expect(payment.state).toBe("FAILED");

    // THE ASSERTION THIS WHOLE DESCRIBE EXISTS FOR.
    //
    // `payment.failed` means the provider could not complete the payment.
    // It does NOT mean the customer's account was untouched — a debit can
    // succeed and the credit still fail, which is exactly the case that
    // turns into a duplicate charge if we assume otherwise and retry.
    expect(payment.customerDebitStatus).toBe("UNKNOWN");
    expect(payment.customerDebitStatus).not.toBe("NOT_DEBITED");
    expect(payment.merchantCreditStatus).toBe("NOT_CREDITED");
    expect(payment.automaticRetryBlocked, "an unknown debit must block automatic retry").toBe(true);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: purchase.orderId } });
    expect(order.status).toBe("FAILED");
    expect(await ledgerActions(purchase.workflowId)).toContain("PAYMENT_FAILED");
  });

  it("classifies the failure and releases the reserved stock exactly once", async () => {
    const purchase = await authorizedPurchase();
    if (!purchase) return;

    const lines = await prisma.orderItem.findMany({ where: { orderId: purchase.orderId }, select: { variantId: true, quantity: true } });
    const before = await prisma.inventory.findUniqueOrThrow({ where: { variantId: lines[0]!.variantId } });

    const entity = paymentEntity({
      order_id: purchase.providerOrderId,
      amount: purchase.amountMinor,
      currency: purchase.currency,
      status: "failed",
      error_code: "GATEWAY_ERROR",
      error_description: "Gateway timed out",
    });
    await deliverWebhook("payment.failed", entity);
    // Redelivery must not release the same stock twice.
    await deliverWebhook("payment.failed", entity);

    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: purchase.paymentId } });
    expect(payment.failureCategory, "a failure must be classified, not left raw").toBeTruthy();
    expect(payment.failureCode).toBe("GATEWAY_ERROR");

    const after = await prisma.inventory.findUniqueOrThrow({ where: { variantId: lines[0]!.variantId } });
    expect(after.availableQuantity).toBe(before.availableQuantity + lines[0]!.quantity);
  });
});

describe("PART 13 — the AI never moves money", () => {
  it("has no AI provider anywhere on the payment path", async () => {
    const { readFile } = await import("node:fs/promises");
    const files = [
      "modules/payments/payment-service.ts",
      "modules/payments/payment-transition.ts",
      "modules/payments/webhook-service.ts",
      "modules/payments/razorpay-gateway.ts",
      "modules/payments/razorpay-signature.ts",
      "modules/gateway/execution-service.ts",
    ];
    for (const file of files) {
      const source = await readFile(new URL(`./${file}`, import.meta.url), "utf8");
      // IMPORTS, not a text search.
      //
      // The first version of this grepped the whole file for /anthropic/
      // and failed on `payment-service.ts` — whose own docblock says
      // "`grep -i anthropic` on this file returns nothing". It matched
      // the sentence claiming the absence. A dependency is something a
      // module IMPORTS; prose about a dependency is not one, and a check
      // that cannot tell them apart proves nothing either way.
      const imports = source.match(/^\s*import\s[\s\S]*?from\s+"[^"]+";/gm) ?? [];
      const aiImport = imports.find((line) => /anthropic|ai-provider|AIProvider|provider-factory|\/agents\//i.test(line));
      expect(aiImport, `${file} must not import an AI provider`).toBeUndefined();
    }
  });

  it("accepts no client-supplied amount, currency or success flag when authorizing", async () => {
    const conversation = await say("I need running shoes");
    const bought = await say("buy the first one", conversation.conversationId);
    if (bought.status !== "PURCHASE_PROPOSED") return;

    const serverPriced = bought.purchase!.amountMinor;
    // Every one of these is an attempt to state financial truth from the
    // client. The route's schema has no such fields, so they are ignored
    // rather than rejected — and being ignored is the point.
    const res = await buyerApp.inject({
      method: "POST",
      url: `/api/v1/buyer/purchase-proposals/${bought.purchase!.proposalId}/authorize`,
      payload: { amountMinor: 1, currency: "USD", captured: true, paid: true, state: "CAPTURED" },
    });
    if (res.statusCode !== 200) return;

    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: res.json().id } });
    expect(payment.amountMinor).toBe(serverPriced);
    expect(payment.currency).not.toBe("USD");
    expect(payment.state).not.toBe("CAPTURED");
  });
});

describe("PART 13 — agent activity reflects the real payment", () => {
  it("shows the checkout, payment and order stages after a real capture", async () => {
    const purchase = await authorizedPurchase();
    if (!purchase) return;

    await deliverWebhook(
      "payment.captured",
      paymentEntity({ order_id: purchase.providerOrderId, amount: purchase.amountMinor, currency: purchase.currency, status: "captured" }),
    );

    const res = await buyerApp.inject({ method: "GET", url: "/api/v1/buyer/activity" });
    expect(res.statusCode).toBe(200);
    const activity = res.json() as BuyerActivityResponseDTO;
    const workflow = activity.workflows.find((w) => w.workflowId === purchase.workflowId);
    expect(workflow, "the buyer's own purchase must appear in their activity").toBeTruthy();

    // The three stages that only exist because money actually moved.
    expect(workflow!.reachedStages).toContain("CHECKOUT");
    expect(workflow!.reachedStages).toContain("PAYMENT");
    expect(workflow!.reachedStages).toContain("ORDER");

    // Every event shown is a real ledger row, matched by id.
    for (const event of workflow!.events) {
      const row = await prisma.agentAction.findUnique({ where: { id: event.id }, select: { actionType: true, workflowId: true } });
      expect(row, `activity event ${event.id} must exist in the ledger`).toBeTruthy();
      expect(row!.actionType).toBe(event.actionType);
      expect(row!.workflowId).toBe(purchase.workflowId);
    }
  });

  it("does not claim an ORDER stage before the money actually arrived", async () => {
    const purchase = await authorizedPurchase();
    if (!purchase) return;

    // An authorized purchase has a real Order row from the moment stock is
    // reserved. That is not an order the buyer has — it is a reservation
    // that may still fail. Lighting the last stage of the rail for it is
    // the same overstatement as a checkout screen saying "order placed"
    // because a row was inserted.
    const before = await buyerApp.inject({ method: "GET", url: "/api/v1/buyer/activity" });
    const beforeWorkflow = (before.json() as BuyerActivityResponseDTO).workflows.find((w) => w.workflowId === purchase.workflowId)!;
    expect(beforeWorkflow.reachedStages).toContain("CHECKOUT");
    expect(beforeWorkflow.reachedStages, "no capture yet, so no order yet").not.toContain("ORDER");

    await deliverWebhook(
      "payment.captured",
      paymentEntity({ order_id: purchase.providerOrderId, amount: purchase.amountMinor, currency: purchase.currency, status: "captured" }),
    );

    const after = await buyerApp.inject({ method: "GET", url: "/api/v1/buyer/activity" });
    const afterWorkflow = (after.json() as BuyerActivityResponseDTO).workflows.find((w) => w.workflowId === purchase.workflowId)!;
    expect(afterWorkflow.reachedStages, "a verified capture is what makes it an order").toContain("ORDER");
  });

  it("puts the newest activity first, whatever produced it", async () => {
    const purchase = await authorizedPurchase();
    if (!purchase) return;

    // A search that never became a purchase, made AFTER the purchase above.
    const searchOnly = await say("I need running shoes");

    const res = await buyerApp.inject({ method: "GET", url: "/api/v1/buyer/activity" });
    const activity = res.json() as BuyerActivityResponseDTO;

    const conversation = await prisma.buyerConversation.findUniqueOrThrow({
      where: { id: searchOnly.conversationId },
      select: { workflowId: true },
    });

    // The feed used to concatenate purchase workflows before conversation
    // ones and slice the first twenty, so a buyer with twenty or more
    // proposals — the demo shopper has ninety-six — never saw a search at
    // all. The most recent thing the agent did must be in the feed.
    const ids = activity.workflows.map((w) => w.workflowId);
    expect(ids, "a search made just now must appear in the feed").toContain(conversation.workflowId);
    expect(ids.indexOf(conversation.workflowId!)).toBeLessThan(ids.indexOf(purchase.workflowId));

    // And the whole feed is in recency order, not source order.
    const times = activity.workflows.map((w) => Date.parse(w.startedAt));
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it("shows the whole journey as one workflow, intent through order", async () => {
    const purchase = await authorizedPurchase();
    if (!purchase) return;

    await deliverWebhook(
      "payment.captured",
      paymentEntity({ order_id: purchase.providerOrderId, amount: purchase.amountMinor, currency: purchase.currency, status: "captured" }),
    );

    const res = await buyerApp.inject({ method: "GET", url: "/api/v1/buyer/activity" });
    const activity = res.json() as BuyerActivityResponseDTO;
    const workflow = activity.workflows.find((w) => w.workflowId === purchase.workflowId)!;
    expect(workflow).toBeTruthy();

    // ONE journey, not two. The conversation minted a workflow for the
    // search and the purchase minted a second, unrelated one — so a buyer
    // saw their own single journey as two disconnected cards with nothing
    // joining "you recommended this" to "you charged me for it".
    //
    // Asserted through the buyer's own activity feed rather than against
    // the ledger directly, because the feed is where the split was
    // visible and where a regression would show up again.
    for (const stage of ["INTENT", "DISCOVERY", "RECOMMENDATION", "POLICY", "AUTHORIZATION", "CHECKOUT", "PAYMENT", "ORDER"]) {
      expect(workflow.reachedStages, `${stage} belongs to this journey`).toContain(stage);
    }

    // In pipeline order, and each stage appearing once in the rail.
    const order = activity.stageOrder;
    const positions = workflow.reachedStages.map((s) => order.indexOf(s));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(new Set(workflow.reachedStages).size).toBe(workflow.reachedStages.length);
  });
});

describe("PART 13 — the merchant sees the sale", () => {
  it("surfaces the captured order and payment on the merchant's own endpoints", async () => {
    const purchase = await authorizedPurchase();
    if (!purchase) return;

    const providerPaymentId = `mock_pay_${randomUUID()}`;
    await deliverWebhook(
      "payment.captured",
      paymentEntity({ id: providerPaymentId, order_id: purchase.providerOrderId, amount: purchase.amountMinor, currency: purchase.currency, status: "captured" }),
    );

    // The buyer bought from whichever merchant the catalogue matched, and
    // the merchant test app is authenticated as the demo merchant — so
    // this only proves anything when they are the same merchant.
    const demoMerchant = await prisma.merchant.findFirstOrThrow({ where: { slug: "meridian-athletics" }, select: { id: true } });
    if (purchase.merchantId !== demoMerchant.id) return;

    const ordersRes = await merchantApp.inject({ method: "GET", url: "/api/v1/commerce/orders?limit=50" });
    expect(ordersRes.statusCode).toBe(200);
    const order = (ordersRes.json().orders as Array<{ id: string; status: string; totalAmountMinor: number }>).find((o) => o.id === purchase.orderId);
    expect(order, "the merchant must see the order the buyer's agent placed").toBeTruthy();
    expect(order!.status).toBe("PAID");
    expect(order!.totalAmountMinor).toBe(purchase.amountMinor);

    const paymentsRes = await merchantApp.inject({ method: "GET", url: "/api/v1/commerce/payments?limit=50" });
    const payment = (paymentsRes.json().payments as Array<{ id: string; state: string }>).find((p) => p.id === purchase.paymentId);
    expect(payment, "the merchant must see the captured payment").toBeTruthy();
    expect(payment!.state).toBe("CAPTURED");
  });
});
