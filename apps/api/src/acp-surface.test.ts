/**
 * The real ACP surface (TECH_SPEC §2.1).
 *
 * Two things carry most of the weight here: the stateful session lifecycle
 * (create → update → complete/cancel), and idempotency-key semantics,
 * which the spec calls out by name because a retrying buyer agent is the
 * normal case rather than an edge one.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";
import { prisma } from "./db/client.js";
import { getTestMerchantId } from "./test-helpers/test-app.js";
import { enrolAgent, type EnrolledAgent } from "./test-helpers/enrol-agent.js";

let app: FastifyInstance;
let merchantId: string;
let slug: string;
let sku: string;
let priceMinor: number;

let agent: EnrolledAgent;

/** ACP requires bearer auth plus a detached request signature. */
function keyed(method: string, url: string, body: unknown = null, extra: Record<string, string> = {}) {
  return agent.requestHeaders(method, url, body, extra);
}

/** Authenticated, but deliberately WITHOUT an idempotency key. */
function authOnly(method: string, url: string, body: unknown = null, extra: Record<string, string> = {}) {
  return keyed(method, url, body, { ...extra, "idempotency-key": "" });
}

async function createSession(body: Record<string, unknown>, idempotencyKey = randomUUID()) {
  const url = `/api/v1/acp/${slug}/checkout_sessions`;
  const headers = keyed("POST", url, body, { "idempotency-key": idempotencyKey });
  return app.inject({ method: "POST", url: `/api/v1/acp/${slug}/checkout_sessions`, headers, payload: body });
}

async function delegatePayment(
  checkoutSessionId: string | null,
  maxAmount: number,
  riskSignals: { type: string; action: "blocked" | "manual_review" | "authorized"; score?: number }[] = [],
) {
  const url = `/api/v1/acp/${slug}/agentic_commerce/delegate_payment`;
  const payload = {
    allowance: {
      reason: "one_time",
      max_amount: maxAmount,
      currency: "INR",
      merchant_id: merchantId,
      ...(checkoutSessionId ? { checkout_session_id: checkoutSessionId } : {}),
      expires_at: new Date(Date.now() + 600_000).toISOString(),
    },
    payment_method: { type: "tokenized_card", token: `vault_token_${randomUUID()}`, last4: "4242" },
    risk_signals: riskSignals,
  };
  return app.inject({
    method: "POST",
    url,
    headers: keyed("POST", url, payload),
    payload,
  });
}

function completionPayload(token: string) {
  return { payment_data: { type: "delegated_payment_token", token } };
}

function completeSession(sessionId: string, payload: Record<string, unknown>) {
  const url = `/api/v1/acp/${slug}/checkout_sessions/${sessionId}/complete`;
  return app.inject({ method: "POST", url, headers: keyed("POST", url, payload), payload });
}

function delegateRaw(payload: Record<string, unknown>) {
  const url = `/api/v1/acp/${slug}/agentic_commerce/delegate_payment`;
  return app.inject({ method: "POST", url, headers: keyed("POST", url, payload), payload });
}

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  merchantId = await getTestMerchantId(prisma);
  slug = (await prisma.merchant.findUniqueOrThrow({ where: { id: merchantId } })).slug;

  await prisma.agentGatewayPolicy.upsert({
    where: { merchantId },
    create: { merchantId, policyVersion: 1, unknownAgentCeilingMinor: 1_000_000, velocityMaxIntentsPerHour: 500 },
    update: { unknownAgentCeilingMinor: 1_000_000, velocityMaxIntentsPerHour: 500, blockedCategories: [] },
  });

  const variant = await prisma.productVariant.findFirstOrThrow({
    where: {
      active: true,
      product: { merchantId, category: "Running Shoes", status: "ACTIVE" },
      // Stock, because an intent for an out-of-stock variant is
      // refused on inventory — which would make a decline test pass
      // for the wrong reason and an approval test fail for one.
      inventory: { availableQuantity: { gte: 5 } },
    },
    // Deterministic: without it the fixture is whatever the planner
    // returns today, so identical code can pass and fail on
    // different days.
    orderBy: { sku: "asc" },
  });
  sku = variant.sku;
  priceMinor = variant.priceMinor;

  agent = await enrolAgent(prisma, merchantId, "agent-acp-suite");
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("ACP — checkout session lifecycle", () => {
  it("creates a session priced from the merchant's own catalogue", async () => {
    const res = await createSession({ line_items: [{ id: sku, quantity: 2 }], currency: "INR", capabilities: [] });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toMatch(/^csn_/);
    expect(body.status).toBe("ready_for_payment");
    // The agent stated no price; ours is the one that counts.
    expect(body.totals.total).toBe(priceMinor * 2);
    expect(res.headers["api-version"]).toBe("2026-04-17");
  });

  it("marks a session it cannot price as not_ready_for_payment rather than refusing it", async () => {
    const res = await createSession({ line_items: [{ id: "NOT-A-REAL-SKU", quantity: 1 }], currency: "INR" });
    expect(res.statusCode).toBe(201);
    expect(res.json().status).toBe("not_ready_for_payment");
  });

  it("retrieves a session by id", async () => {
    const created = (await createSession({ line_items: [{ id: sku, quantity: 1 }], currency: "INR" })).json();
    const url = `/api/v1/acp/${slug}/checkout_sessions/${created.id}`;
    const res = await app.inject({ method: "GET", url, headers: authOnly("GET", url) });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(created.id);
  });

  it("updates a session and reprices it", async () => {
    const created = (await createSession({ line_items: [{ id: sku, quantity: 1 }], currency: "INR" })).json();
    const url = `/api/v1/acp/${slug}/checkout_sessions/${created.id}`;
    const payload = { line_items: [{ id: sku, quantity: 3 }] };
    const res = await app.inject({
      method: "POST",
      url,
      headers: keyed("POST", url, payload),
      payload,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().totals.total).toBe(priceMinor * 3);
  });

  it("cancels a session, and refuses to mutate it afterwards", async () => {
    const created = (await createSession({ line_items: [{ id: sku, quantity: 1 }], currency: "INR" })).json();
    const cancelUrl = `/api/v1/acp/${slug}/checkout_sessions/${created.id}/cancel`;
    const cancelled = await app.inject({ method: "POST", url: cancelUrl, headers: keyed("POST", cancelUrl) });
    expect(cancelled.json().status).toBe("canceled");

    const updateUrl = `/api/v1/acp/${slug}/checkout_sessions/${created.id}`;
    const payload = { line_items: [{ id: sku, quantity: 2 }] };
    const update = await app.inject({
      method: "POST",
      url: updateUrl,
      headers: keyed("POST", updateUrl, payload),
      payload,
    });
    expect(update.statusCode).toBe(409);
  });
});

describe("ACP — authentication (the spec requires it on every endpoint)", () => {
  it("refuses an unauthenticated session create", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/acp/${slug}/checkout_sessions`,
      headers: { "idempotency-key": randomUUID() },
      payload: { line_items: [{ id: sku, quantity: 1 }], currency: "INR" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("refuses a revoked or unknown credential", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/acp/${slug}/checkout_sessions`,
      headers: { authorization: "Bearer ak_not-a-real-key", "idempotency-key": randomUUID() },
      payload: { line_items: [{ id: sku, quantity: 1 }], currency: "INR" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("refuses an unauthenticated completion", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/acp/${slug}/checkout_sessions/csn_whatever/complete`,
      headers: { "idempotency-key": randomUUID() },
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });

  it("refuses a bearer-authenticated request without its detached signature", async () => {
    const url = `/api/v1/acp/${slug}/checkout_sessions`;
    const payload = { line_items: [{ id: sku, quantity: 1 }], currency: "INR" };
    const res = await app.inject({ method: "POST", url, headers: agent.headers({ "api-version": "2026-04-17" }), payload });
    expect(res.statusCode).toBe(401);
  });

  it("refuses a request when the signed body is changed in transit", async () => {
    const url = `/api/v1/acp/${slug}/checkout_sessions`;
    const signed = { line_items: [{ id: sku, quantity: 1 }], currency: "INR" };
    const tampered = { line_items: [{ id: sku, quantity: 9 }], currency: "INR" };
    const res = await app.inject({ method: "POST", url, headers: keyed("POST", url, signed), payload: tampered });
    expect(res.statusCode).toBe(401);
  });

  it("refuses an unsupported or missing ACP API version", async () => {
    const url = `/api/v1/acp/${slug}/checkout_sessions`;
    const payload = { line_items: [{ id: sku, quantity: 1 }], currency: "INR" };
    const headers = keyed("POST", url, payload, { "api-version": "2025-09-12" });
    const res = await app.inject({ method: "POST", url, headers, payload });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toContain("2026-04-17");
  });

  it("does not let another enrolled agent read a session it does not own", async () => {
    const created = (await createSession({ line_items: [{ id: sku, quantity: 1 }], currency: "INR" })).json();
    const other = await enrolAgent(prisma, merchantId, `agent-other-${randomUUID().slice(0, 8)}`);
    const url = `/api/v1/acp/${slug}/checkout_sessions/${created.id}`;
    const res = await app.inject({ method: "GET", url, headers: other.requestHeaders("GET", url) });
    expect(res.statusCode).toBe(404);
  });
});

describe("ACP — idempotency (the spec names these by code)", () => {
  it("refuses a create with no Idempotency-Key", async () => {
    const url = `/api/v1/acp/${slug}/checkout_sessions`;
    const payload = { line_items: [{ id: sku, quantity: 1 }], currency: "INR" };
    const res = await app.inject({
      method: "POST",
      url,
      headers: authOnly("POST", url, payload),
      payload,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
  });

  /** The whole point: a retry must not create a second session. */
  it("replays the cached response for a repeated key, creating nothing new", async () => {
    const idempotencyKey = randomUUID();
    const body = { line_items: [{ id: sku, quantity: 1 }], currency: "INR" };

    const first = await createSession(body, idempotencyKey);
    const second = await createSession(body, idempotencyKey);

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200); // replay, not a fresh create
    expect(second.json().id).toBe(first.json().id);

    const count = await prisma.acpCheckoutSession.count({ where: { id: first.json().id } });
    expect(count).toBe(1);
  });

  it("rejects the same key reused with a different body", async () => {
    const idempotencyKey = randomUUID();
    await createSession({ line_items: [{ id: sku, quantity: 1 }], currency: "INR" }, idempotencyKey);
    const conflicting = await createSession({ line_items: [{ id: sku, quantity: 9 }], currency: "INR" }, idempotencyKey);

    expect(conflicting.statusCode).toBe(409);
    expect(conflicting.json().error.code).toBe("IDEMPOTENCY_KEY_REUSED");
  });
});

describe("ACP — completion runs the full Vaanigam gate", () => {
  it("approves inside the envelope using the ACP Allowance as the mandate", async () => {
    const created = (
      await createSession({
        line_items: [{ id: sku, quantity: 1 }],
        currency: "INR",
      })
    ).json();
    const delegated = await delegatePayment(created.id, 1);

    const res = await completeSession(created.id, completionPayload(delegated.json().id));

    expect(res.statusCode).toBe(202);
    expect(res.json().vaanigam.reason_code).toBe("ALLOWANCE_INVALID");
  });

  it("records the buyer and the raw payload on the decision", async () => {
    const created = (
      await createSession({
        line_items: [{ id: sku, quantity: 1 }],
        currency: "INR",
        buyer: { email: "trace@agent.test", name: "Trace Buyer" },
      })
    ).json();
    const delegated = await delegatePayment(created.id, priceMinor * 5);

    const res = await completeSession(created.id, completionPayload(delegated.json().id));

    const record = await prisma.decisionRecord.findFirstOrThrow({
      where: { protocolActorRef: created.id },
      orderBy: { createdAt: "desc" },
    });
    expect(res.statusCode).toBeLessThan(300);
    expect(record.buyerEmail).toBe("t***@agent.test");
    expect(record.buyerName).toBe("T*** B***");
    expect(JSON.stringify(record.rawProtocolPayload)).not.toContain("trace@agent.test");
    expect(JSON.stringify(record.rawProtocolPayload)).not.toContain("Trace Buyer");
  });

  it("refuses completion without delegated payment_data", async () => {
    const created = (await createSession({ line_items: [{ id: sku, quantity: 1 }], currency: "INR" })).json();
    const res = await completeSession(created.id, {});
    expect(res.statusCode).toBe(400);
  });
});

describe("ACP — delegate_payment", () => {
  it("returns an allowance-reference token and says it vaults nothing", async () => {
    const res = await delegateRaw({
        allowance: { reason: "one_time", max_amount: 200000, currency: "INR", merchant_id: merchantId },
        payment_method: { type: "tokenized_card", token: `vault_token_${randomUUID()}`, last4: "4242" },
        risk_signals: [{ type: "card_testing", score: 8, action: "authorized" }],
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toMatch(/^dpt_acpdp_/);
    expect(body.vaanigam.payment_instrument_vaulted).toBe(false);
    expect(body.vaanigam.risk_signals_forwarded).toBe(0);
  });

  it("forwards blocking risk signals rather than discarding them", async () => {
    const res = await delegateRaw({
        allowance: { max_amount: 200000, currency: "INR", merchant_id: merchantId },
        payment_method: { type: "network_token", token: `network_token_${randomUUID()}` },
        risk_signals: [
          { type: "velocity", action: "manual_review" },
          { type: "device", action: "blocked" },
        ],
    });

    expect(res.json().vaanigam.risk_signals_forwarded).toBe(2);
    expect(res.json().vaanigam.note).toMatch(/human approval/i);
  });
});

describe("ACP — risk signals reach the decision", () => {
  it("steps up an otherwise-approvable purchase that the platform flagged", async () => {
    const created = (
      await createSession({
        line_items: [{ id: sku, quantity: 1 }],
        currency: "INR",
      })
    ).json();
    const delegated = await delegatePayment(created.id, priceMinor * 5, [
      { type: "device_reputation", action: "manual_review" },
    ]);

    const res = await completeSession(created.id, completionPayload(delegated.json().id));

    expect(res.statusCode).toBe(202);
    expect(res.json().vaanigam.decision).toBe("STEP_UP");
    expect(res.json().vaanigam.reason).toMatch(/flagged this purchase for review/i);
  });
});

/**
 * FEATURES_1.md §D — the decline reaches the CALLING AGENT, in ACP's own
 * vocabulary, not just the merchant's dashboard.
 *
 * The point of these is protocol fidelity, not coverage: an agent that
 * speaks only ACP must be able to act on what comes back without knowing
 * anything about Vaanigam.
 */
describe("ACP — structured messages back to the calling agent", () => {
  it("returns approval_required on a step-up, using the protocol's own enum", async () => {
    const created = (await createSession({ line_items: [{ id: sku, quantity: 1 }], currency: "INR" })).json();
    const delegated = await delegatePayment(created.id, priceMinor * 5, [
      { type: "device_reputation", action: "manual_review" },
    ]);

    const res = await completeSession(created.id, completionPayload(delegated.json().id));
    const messages = res.json().messages as { type: string; code?: string; content: string; content_type: string }[];

    expect(Array.isArray(messages)).toBe(true);
    const error = messages.find((m) => m.type === "error");
    expect(error).toBeTruthy();
    expect(error!.code).toBe("approval_required");
    expect(error!.content_type).toBe("plain");
    // The merchant's own sentence travels to the agent, not just a code.
    expect(error!.content.length).toBeGreaterThan(40);
  });

  it("tells the agent a step-up is not a refusal", async () => {
    const created = (await createSession({ line_items: [{ id: sku, quantity: 1 }], currency: "INR" })).json();
    const delegated = await delegatePayment(created.id, priceMinor * 5, [
      { type: "device_reputation", action: "manual_review" },
    ]);

    const res = await completeSession(created.id, completionPayload(delegated.json().id));
    const messages = res.json().messages as { content: string }[];
    expect(messages.some((m) => m.content.includes("not a refusal"))).toBe(true);
  });

  /** An agent that polls the session must see the same reason it was given
   * at completion, not a different one. */
  it("persists the messages so a later GET returns the same reason", async () => {
    const created = (await createSession({ line_items: [{ id: sku, quantity: 1 }], currency: "INR" })).json();
    const delegated = await delegatePayment(created.id, priceMinor * 5, [
      { type: "device_reputation", action: "manual_review" },
    ]);
    const completed = await completeSession(created.id, completionPayload(delegated.json().id));

    const url = `/api/v1/acp/${slug}/checkout_sessions/${created.id}`;
    const fetched = await app.inject({ method: "GET", url, headers: keyed("GET", url) });

    expect(fetched.json().messages).toEqual(completed.json().messages);
  });

  it("says nothing on a clean approval rather than filling the array with noise", async () => {
    const created = (await createSession({ line_items: [{ id: sku, quantity: 1 }], currency: "INR" })).json();
    const delegated = await delegatePayment(created.id, priceMinor * 5);

    const res = await completeSession(created.id, completionPayload(delegated.json().id));
    expect(res.json().vaanigam.decision).toBe("AUTO_APPROVE");
    expect(res.json().messages).toEqual([]);
  });

  /** A session nothing has happened to yet still exposes the field, so a
   * client reading `messages.length` never meets undefined. */
  it("always exposes messages as an array, even on a fresh session", async () => {
    const created = await createSession({ line_items: [{ id: sku, quantity: 1 }], currency: "INR" });
    expect(created.json().messages).toEqual([]);
  });
});
