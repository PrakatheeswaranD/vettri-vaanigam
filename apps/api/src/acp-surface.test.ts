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

/** ACP requires bearer auth on every endpoint, so every call carries the
 * merchant-issued credential as well as a fresh idempotency key. */
function keyed(extra: Record<string, string> = {}) {
  return { ...agent.headers(), ...extra };
}

/** Authenticated, but deliberately WITHOUT an idempotency key. */
function authOnly(extra: Record<string, string> = {}) {
  return { "x-agent-id": agent.externalAgentId, authorization: `Bearer ${agent.apiKey}`, ...extra };
}

async function createSession(body: Record<string, unknown>, headers = keyed()) {
  return app.inject({ method: "POST", url: `/api/v1/acp/${slug}/checkout_sessions`, headers, payload: body });
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
    where: { active: true, product: { merchantId, category: "Running Shoes", status: "ACTIVE" } },
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
    const res = await app.inject({ method: "GET", url: `/api/v1/acp/${slug}/checkout_sessions/${created.id}`, headers: authOnly() });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(created.id);
  });

  it("updates a session and reprices it", async () => {
    const created = (await createSession({ line_items: [{ id: sku, quantity: 1 }], currency: "INR" })).json();
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/acp/${slug}/checkout_sessions/${created.id}`,
      headers: authOnly(),
      payload: { line_items: [{ id: sku, quantity: 3 }] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().totals.total).toBe(priceMinor * 3);
  });

  it("cancels a session, and refuses to mutate it afterwards", async () => {
    const created = (await createSession({ line_items: [{ id: sku, quantity: 1 }], currency: "INR" })).json();
    const cancelled = await app.inject({ method: "POST", url: `/api/v1/acp/${slug}/checkout_sessions/${created.id}/cancel`, headers: authOnly() });
    expect(cancelled.json().status).toBe("canceled");

    const update = await app.inject({
      method: "POST",
      url: `/api/v1/acp/${slug}/checkout_sessions/${created.id}`,
      headers: authOnly(),
      payload: { line_items: [{ id: sku, quantity: 2 }] },
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
});

describe("ACP — idempotency (the spec names these by code)", () => {
  it("refuses a create with no Idempotency-Key", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/acp/${slug}/checkout_sessions`,
      headers: authOnly(),
      payload: { line_items: [{ id: sku, quantity: 1 }], currency: "INR" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
  });

  /** The whole point: a retry must not create a second session. */
  it("replays the cached response for a repeated key, creating nothing new", async () => {
    const headers = keyed();
    const body = { line_items: [{ id: sku, quantity: 1 }], currency: "INR" };

    const first = await createSession(body, headers);
    const second = await createSession(body, headers);

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200); // replay, not a fresh create
    expect(second.json().id).toBe(first.json().id);

    const count = await prisma.acpCheckoutSession.count({ where: { id: first.json().id } });
    expect(count).toBe(1);
  });

  it("rejects the same key reused with a different body", async () => {
    const headers = keyed();
    await createSession({ line_items: [{ id: sku, quantity: 1 }], currency: "INR" }, headers);
    const conflicting = await createSession({ line_items: [{ id: sku, quantity: 9 }], currency: "INR" }, headers);

    expect(conflicting.statusCode).toBe(409);
    expect(conflicting.json().error.code).toBe("IDEMPOTENCY_KEY_REUSED");
  });
});

describe("ACP — completion runs the full Anumati gate", () => {
  it("approves inside the envelope using the ACP Allowance as the mandate", async () => {
    const created = (
      await createSession({
        line_items: [{ id: sku, quantity: 1 }],
        currency: "INR",
        buyer: { email: "buyer@agent.test", name: "Jane Doe" },
        allowance: {
          reason: "one_time",
          max_amount: priceMinor * 5,
          currency: "INR",
          merchant_id: merchantId,
          expires_at: new Date(Date.now() + 600_000).toISOString(),
        },
      })
    ).json();

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/acp/${slug}/checkout_sessions/${created.id}/complete`,
      headers: keyed(),
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("completed");
    expect(body.anumati.decision).toBe("AUTO_APPROVE");
    expect(body.anumati.order_id).toBeTruthy();
    expect(body.anumati.reason.length).toBeGreaterThan(20);
  });

  it("declines when the allowance does not cover the merchant's price", async () => {
    const created = (
      await createSession({
        line_items: [{ id: sku, quantity: 1 }],
        currency: "INR",
        allowance: { max_amount: 1, currency: "INR", merchant_id: merchantId },
      })
    ).json();

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/acp/${slug}/checkout_sessions/${created.id}/complete`,
      headers: keyed(),
      payload: {},
    });

    expect(res.statusCode).toBe(202);
    expect(res.json().anumati.reason_code).toBe("ALLOWANCE_INVALID");
  });

  it("records the buyer and the raw payload on the decision", async () => {
    const created = (
      await createSession({
        line_items: [{ id: sku, quantity: 1 }],
        currency: "INR",
        buyer: { email: "trace@agent.test", name: "Trace Buyer" },
        allowance: { max_amount: priceMinor * 5, currency: "INR", merchant_id: merchantId },
      })
    ).json();

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/acp/${slug}/checkout_sessions/${created.id}/complete`,
      headers: keyed(),
      payload: {},
    });

    const record = await prisma.decisionRecord.findFirstOrThrow({
      where: { protocolActorRef: created.id },
      orderBy: { createdAt: "desc" },
    });
    expect(res.statusCode).toBeLessThan(300);
    expect(record.buyerEmail).toBe("trace@agent.test");
    expect(record.buyerName).toBe("Trace Buyer");
    // The exact payload, not our summary of it.
    expect(record.rawProtocolPayload).toBeTruthy();
  });
});

describe("ACP — delegate_payment", () => {
  it("returns an allowance-reference token and says it vaults nothing", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/acp/${slug}/agentic_commerce/delegate_payment`,
      headers: keyed(),
      payload: {
        allowance: { reason: "one_time", max_amount: 200000, currency: "INR", merchant_id: merchantId },
        risk_signals: [{ type: "card_testing", score: 8, action: "authorized" }],
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toMatch(/^vt_/);
    expect(body.anumati.payment_instrument_vaulted).toBe(false);
    expect(body.anumati.risk_signals_forwarded).toBe(0);
  });

  it("forwards blocking risk signals rather than discarding them", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/acp/${slug}/agentic_commerce/delegate_payment`,
      headers: keyed(),
      payload: {
        allowance: { max_amount: 200000, currency: "INR", merchant_id: merchantId },
        risk_signals: [
          { type: "velocity", action: "manual_review" },
          { type: "device", action: "blocked" },
        ],
      },
    });

    expect(res.json().anumati.risk_signals_forwarded).toBe(2);
    expect(res.json().anumati.note).toMatch(/human approval/i);
  });
});

describe("ACP — risk signals reach the decision", () => {
  it("steps up an otherwise-approvable purchase that the platform flagged", async () => {
    const created = (
      await createSession({
        line_items: [{ id: sku, quantity: 1 }],
        currency: "INR",
        allowance: { max_amount: priceMinor * 5, currency: "INR", merchant_id: merchantId },
        risk_signals: [{ type: "device_reputation", action: "manual_review" }],
      })
    ).json();

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/acp/${slug}/checkout_sessions/${created.id}/complete`,
      headers: keyed(),
      payload: {},
    });

    expect(res.statusCode).toBe(202);
    expect(res.json().anumati.decision).toBe("STEP_UP");
    expect(res.json().anumati.reason).toMatch(/flagged this purchase for review/i);
  });
});
