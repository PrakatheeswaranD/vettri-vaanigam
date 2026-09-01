/**
 * Vaanigam gateway — end-to-end through the real HTTP route.
 *
 * These exercise the actual door an outside buyer agent knocks on: no
 * session, real protocol detection, real adapters, real mandate
 * verification against Ed25519 keys, real merchant policy, and a
 * DecisionRecord written for every outcome.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";
import { prisma } from "./db/client.js";
import { getTestMerchantId, TEST_MERCHANT_EMAIL, TEST_MERCHANT_PASSWORD } from "./test-helpers/test-app.js";
import { enrolAgent, type EnrolledAgent } from "./test-helpers/enrol-agent.js";


let app: FastifyInstance;
let merchantId: string;
let merchantSlug: string;
let sku: string;
let priceMinor: number;
let agent: EnrolledAgent;

/** Signed by the key the merchant has ENROLLED — the only kind that verifies now. */
function mandateFor(overrides: Record<string, unknown> = {}) {
  return agent.mandate(merchantId, overrides as never);
}

async function postIntentAs(as: EnrolledAgent, body: unknown, headers: Record<string, string> = {}) {
  return app.inject({
    method: "POST",
    url: `/api/v1/agent-gateway/${merchantSlug}/intents`,
    headers: { "x-agent-id": as.externalAgentId, ...headers },
    payload: body as Record<string, unknown>,
  });
}

async function postIntent(body: unknown, headers: Record<string, string> = {}) {
  return postIntentAs(agent, body, headers);
}

beforeAll(async () => {
  // Built UNauthenticated on purpose: the gateway intake is the door an
  // outside agent knocks on with no session, and the merchant-facing
  // views must still refuse anonymous callers.
  app = await buildApp();
  await app.ready();
  merchantId = await getTestMerchantId(prisma);
  const merchant = await prisma.merchant.findUniqueOrThrow({ where: { id: merchantId } });
  merchantSlug = merchant.slug;

  await prisma.agentGatewayPolicy.upsert({
    where: { merchantId },
    create: {
      merchantId,
      policyVersion: 1,
      unknownAgentCeilingMinor: 1_000_000,
      knownAgentCeilingMinor: 5_000_000,
      blockedCategories: ["Hydration"],
      maxNegotiationDiscountBps: 1000,
      velocityMaxIntentsPerHour: 500,
    },
    update: { blockedCategories: ["Hydration"], velocityMaxIntentsPerHour: 500 },
  });

  const variant = await prisma.productVariant.findFirstOrThrow({
    where: { active: true, product: { merchantId, category: "Running Shoes", status: "ACTIVE" } },
  });
  sku = variant.sku;
  priceMinor = variant.priceMinor;

  // A merchant registers the agent's signing key before it can spend.
  agent = await enrolAgent(prisma, merchantId, "agent-under-test");
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("Vaanigam gateway — protocol mesh", () => {
  it("accepts an ACP intent on the shared endpoint with no session", async () => {
    const res = await postIntent({
      items: [{ id: sku, quantity: 1 }],
      buyer: { email: "agent@example.test" },
      totals: { total: priceMinor },
      vaanigam_mandate: mandateFor(),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ outcome: "AUTO_APPROVE", protocol: "ACP", protocolFidelity: "SPEC_IMPLEMENTED" });
  });

  it("accepts an x402 intent on the same endpoint with implemented protocol fidelity", async () => {
    const res = await postIntent({
      x402Version: 1,
      currency: "INR",
      items: [{ sku, quantity: 1 }],
      payload: { authorization: { value: String(priceMinor) } },
      vaanigam_mandate: mandateFor(),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ outcome: "AUTO_APPROVE", protocol: "X402", protocolFidelity: "SPEC_IMPLEMENTED" });
  });

  it("declines a request that identifies no protocol it can read", async () => {
    const res = await postIntent({ please: "buy me something" });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ outcome: "DECLINE", reasonCode: "PROTOCOL_UNSUPPORTED" });
  });
});

/**
 * Each of these enrols its OWN agent.
 *
 * They assert what the mandate check does, not what an agent's history
 * does — and forging a signature or replaying a nonce is now scored, so an
 * agent that has just done both in an earlier test has a collapsed ceiling
 * and legitimately steps up everything afterwards. Sharing one identity
 * across the block would silently couple these assertions to the adaptive
 * trust score and make them fail for reasons that have nothing to do with
 * mandates.
 */
describe("Vaanigam gateway — mandate is the gate", () => {
  it("declines an intent presented with no mandate at all", async () => {
    const solo = await enrolAgent(prisma, merchantId);
    const res = await postIntentAs(solo, { items: [{ id: sku, quantity: 1 }], buyer: {}, totals: { total: priceMinor } });
    expect(res.statusCode).toBe(403);
    expect(res.json().reasonCode).toBe("MANDATE_MISSING");
  });

  it("declines a mandate whose ceiling was raised after signing", async () => {
    const solo = await enrolAgent(prisma, merchantId);
    const mandate = { ...solo.mandate(merchantId, { maxAmountMinor: 100 }), maxAmountMinor: 99_000_000 };
    const res = await postIntentAs(solo, {
      items: [{ id: sku, quantity: 1 }],
      buyer: {},
      totals: { total: priceMinor },
      vaanigam_mandate: mandate,
    });
    expect(res.json().reasonCode).toBe("MANDATE_SIGNATURE_INVALID");
  });

  it("refuses to spend the same mandate twice", async () => {
    const solo = await enrolAgent(prisma, merchantId);
    const mandate = solo.mandate(merchantId);
    const body = { items: [{ id: sku, quantity: 1 }], buyer: {}, totals: { total: priceMinor }, vaanigam_mandate: mandate };

    const first = await postIntentAs(solo, body);
    expect(first.statusCode).toBe(200);

    const replay = await postIntentAs(solo, body);
    expect(replay.statusCode).toBe(403);
    expect(replay.json().reasonCode).toBe("MANDATE_NONCE_REPLAYED");
  });

  /** A decline must not burn a nonce for an order the buyer never got. */
  it("does not consume a mandate on a declined intent", async () => {
    const solo = await enrolAgent(prisma, merchantId);
    const mandate = solo.mandate(merchantId);
    const blocked = await prisma.productVariant.findFirstOrThrow({
      where: { active: true, product: { merchantId, category: "Hydration", status: "ACTIVE" } },
    });

    const declined = await postIntentAs(solo, {
      items: [{ id: blocked.sku, quantity: 1 }],
      buyer: {},
      totals: { total: blocked.priceMinor },
      vaanigam_mandate: mandate,
    });
    expect(declined.json().reasonCode).toBe("CATEGORY_BLOCKED");

    // The same mandate must still be spendable on a permitted basket.
    const accepted = await postIntentAs(solo, {
      items: [{ id: sku, quantity: 1 }],
      buyer: {},
      totals: { total: priceMinor },
      vaanigam_mandate: mandate,
    });
    expect(accepted.statusCode).toBe(200);
  });
});

describe("Vaanigam gateway — the merchant's price is the one that counts", () => {
  it("declines when the agent's claimed total disagrees with the catalogue", async () => {
    const res = await postIntent({
      items: [{ id: sku, quantity: 1 }],
      buyer: {},
      totals: { total: 1 },
      vaanigam_mandate: mandateFor(),
    });
    expect(res.json()).toMatchObject({ reasonCode: "AMOUNT_MISMATCH", computedTotalMinor: priceMinor });
  });

  it("declines a basket containing an item it cannot resolve", async () => {
    const res = await postIntent({
      items: [{ id: "SKU-THAT-DOES-NOT-EXIST", quantity: 1 }],
      buyer: {},
      vaanigam_mandate: mandateFor(),
    });
    expect(res.json().reasonCode).toBe("UNRESOLVABLE_ITEMS");
  });
});

describe("Vaanigam gateway — the step-up the brief demos on stage", () => {
  it("steps an over-ceiling unknown-agent order up to a human instead of declining it", async () => {
    const quantity = Math.ceil(1_000_000 / priceMinor) + 1; // guaranteed over the ₹10,000 ceiling
    const total = priceMinor * quantity;

    // A FRESH agent. The shared one has settled orders by now and is
    // therefore KNOWN, which earns the higher ceiling — this scenario is
    // specifically about an agent the merchant has never sold to.
    const stranger = await enrolAgent(prisma, merchantId);

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/agent-gateway/${merchantSlug}/intents`,
      headers: { "x-agent-id": stranger.externalAgentId },
      payload: {
        items: [{ id: sku, quantity }],
        buyer: {},
        totals: { total },
        vaanigam_mandate: stranger.mandate(merchantId, { maxAmountMinor: total + 1 }),
      },
    });

    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.outcome).toBe("STEP_UP");
    expect(body.reasonCode).toBe("UNKNOWN_AGENT_CEILING_EXCEEDED");
    expect(body.explanation).toContain("hasn't transacted with you before");
    expect(body.computedTotalMinor).toBe(total);
  });
});

describe("Vaanigam gateway — an approval becomes payable", () => {
  /**
   * The brief's data flow sends an approved intent to Razorpay's Orders
   * API. Without this the gateway only ever DECIDES — the agent is told
   * yes and handed nothing it can pay.
   */
  it("creates a provider order the agent can pay, and records it", async () => {
    const solo = await enrolAgent(prisma, merchantId);
    const res = await postIntentAs(solo, {
      items: [{ id: sku, quantity: 1 }],
      buyer: {},
      totals: { total: priceMinor },
      vaanigam_mandate: solo.mandate(merchantId),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.providerOrderId).toBeTruthy();
    expect(body.explanation).toContain("Razorpay order was created");

    const record = await prisma.decisionRecord.findUniqueOrThrow({ where: { id: body.decisionId } });
    expect(record.providerOrderId).toBe(body.providerOrderId);
  });

  it("never creates a provider order for a declined intent", async () => {
    const blocked = await prisma.productVariant.findFirstOrThrow({
      where: { active: true, product: { merchantId, category: "Hydration", status: "ACTIVE" } },
    });
    const res = await postIntent({
      items: [{ id: blocked.sku, quantity: 1 }],
      buyer: {},
      totals: { total: blocked.priceMinor },
      vaanigam_mandate: mandateFor(),
    });

    expect(res.json().outcome).toBe("DECLINE");
    expect(res.json().providerOrderId).toBeNull();

    const record = await prisma.decisionRecord.findUniqueOrThrow({ where: { id: res.json().decisionId } });
    expect(record.providerOrderId).toBeNull();
  });

  it("does not bill order creation to decision latency", async () => {
    // Order creation is execution, not deciding. If its round trip were
    // counted, an approval would always look slower than a decline for
    // reasons that have nothing to do with the gate.
    const solo = await enrolAgent(prisma, merchantId);
    const approve = await postIntentAs(solo, {
      items: [{ id: sku, quantity: 1 }],
      buyer: {},
      totals: { total: priceMinor },
      vaanigam_mandate: solo.mandate(merchantId),
    });
    const record = await prisma.decisionRecord.findUniqueOrThrow({ where: { id: approve.json().decisionId } });
    expect(record.providerOrderId).toBeTruthy();
    expect(record.decisionLatencyMs).toBeLessThan(approve.json().decisionLatencyMs + 1);
  });
});

describe("Vaanigam gateway — explainability", () => {
  it("writes a Decision Record with a written reason for every outcome", async () => {
    const records = await prisma.decisionRecord.findMany({ where: { merchantId } });
    expect(records.length).toBeGreaterThan(5);
    for (const record of records) {
      expect(record.explanation.trim().length).toBeGreaterThan(20);
      expect(record.decisionLatencyMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("records a decision even for a request it could not parse", async () => {
    const before = await prisma.decisionRecord.count({ where: { merchantId } });
    await postIntent({ items: [], buyer: {} });
    const after = await prisma.decisionRecord.count({ where: { merchantId } });
    expect(after).toBe(before + 1);
  });

  it("reports measured metrics, never invented ones", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: TEST_MERCHANT_EMAIL, password: TEST_MERCHANT_PASSWORD },
    });
    const token = login.json().token;

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/agent-gateway/metrics",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const metrics = res.json();
    expect(metrics.totalDecisions).toBeGreaterThan(0);
    expect(metrics.decisionsWithWrittenReasonPct).toBe(100);
    expect(metrics.medianDecisionLatencyMs).toBeGreaterThanOrEqual(0);
    expect(metrics.basis).toContain("seeded test environment");
  });

  it("keeps the merchant-facing decision log authenticated", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/agent-gateway/decisions" });
    expect(res.statusCode).toBe(401);
  });
});
