/**
 * PART 06 — Deterministic Commerce Execution integration tests. Follows
 * the same real-seeded-catalog + `FixtureProvider` + real Policy Engine
 * pattern established in `merchant-agent.test.ts` (PART 04) and
 * `policy.test.ts` (PART 05): a proposal is built with a controlled,
 * scripted offer, carried through the real `/policy/evaluate` and
 * `/approvals/*` endpoints to a real `ExecutionAuthorization`, and only
 * then handed to `POST /commerce/checkout` — exactly the chain PART 06
 * must consume, never a shortcut around it.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";
import { prisma } from "./db/client.js";
import { getDemoMerchantId } from "./modules/authorization/demo-context.js";
import { proposeGrowthAction } from "./modules/merchant-agent/service.js";
import { createFixtureProvider } from "./modules/agents/providers/fixture-provider.js";

let app: FastifyInstance;

async function productId(name: string): Promise<string> {
  const product = await prisma.product.findFirstOrThrow({ where: { name } });
  return product.id;
}

/** Picks the CHEAPEST active variant with recorded inventory — matching
 * how PART 04/05 derived this same product's price for the proposal/
 * policy evaluation (`commerce.priceRange.minMinor`), so a test using
 * this variant represents the "nothing changed" case rather than an
 * artificial price mismatch. */
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

async function proposeCrossSellWithDiscount(percentageBps: number | null) {
  const merchantId = await getDemoMerchantId(prisma);
  const pulseRunner = await productId("Meridian Pulse Runner");
  const provider = createFixtureProvider(
    {
      proposeGrowthAction: async ({ candidates }) => ({
        actionType: "CROSS_SELL",
        primaryProductId: pulseRunner,
        relatedProductIds: [candidates.find((c) => c.relationship === "COMPLEMENTARY" && c.readinessState !== "NOT_READY")!.productId],
        offer: percentageBps === null ? null : { kind: "PERCENTAGE", percentageBps, amountMinor: null },
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

async function approve(proposalId: string) {
  return app.inject({ method: "POST", url: `/api/v1/approvals/${proposalId}/approve`, payload: {} });
}

/** Runs a proposal through evaluate (+ approve if REQUIRE_APPROVAL) and
 * returns the resulting ACTIVE authorization id. */
async function authorizeProposal(percentageBps: number | null): Promise<{ authorizationId: string; primaryProductId: string; variantId: string }> {
  const proposal = await proposeCrossSellWithDiscount(percentageBps);
  const evalRes = await evaluate(proposal.id);
  const evalBody = evalRes.json();
  let authorizationId: string;
  if (evalBody.decision.outcome === "ALLOW") {
    authorizationId = evalBody.authorization.id;
  } else if (evalBody.decision.outcome === "REQUIRE_APPROVAL") {
    const approveRes = await approve(proposal.id);
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

describe("Commerce Execution — golden path (PART 06 §189)", () => {
  it("executes an ALLOW-authorized cross-sell into a READY_FOR_PAYMENT checkout with no discount", async () => {
    const { authorizationId, primaryProductId, variantId } = await authorizeProposal(null);
    const res = await checkout({
      authorizationId,
      selection: { productId: primaryProductId, variantId, quantity: 1 },
      idempotencyKey: randomUUID(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.status).toBe("READY_FOR_PAYMENT");
    expect(body.payment.status).toBe("NOT_STARTED");
    expect(body.authorization).toEqual({ authorizationId, consumed: true });
    expect(body.items).toHaveLength(2); // buyer's primary + the authorized cross-sell add
    expect(body.totals.totalMinor).toBe(body.totals.subtotalMinor - body.totals.discountMinor);
    expect(body.totals.totalMinor).toBe(body.items.reduce((sum: number, i: { lineTotalMinor: number }) => sum + i.lineTotalMinor, 0));
    expect(typeof body.orderFingerprint).toBe("string");
    expect(body.orderFingerprint.length).toBeGreaterThan(10);

    const authRow = await prisma.executionAuthorization.findUniqueOrThrow({ where: { id: authorizationId } });
    expect(authRow.status).toBe("CONSUMED");

    const order = await prisma.order.findUniqueOrThrow({ where: { id: body.orderId } });
    expect(order.status).toBe("PENDING"); // never PAID — PART 07's job
    expect(order.totalAmountMinor).toBe(body.totals.totalMinor);
    expect(order.source).toBe("AI_CROSS_SELL");

    const cart = await prisma.cart.findUniqueOrThrow({ where: { id: body.cartId } });
    expect(cart.status).toBe("CONVERTED");
  });

  it("applies the authorized discount deterministically to the eligible line only", async () => {
    const { authorizationId, primaryProductId, variantId } = await authorizeProposal(200); // 2% -> ALLOW tier
    const res = await checkout({
      authorizationId,
      selection: { productId: primaryProductId, variantId, quantity: 1 },
      idempotencyKey: randomUUID(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.appliedOffer).not.toBeNull();
    expect(body.appliedOffer.kind).toBe("PERCENTAGE");
    expect(body.totals.discountMinor).toBeGreaterThan(0);

    const primaryLine = body.items.find((i: { productId: string }) => i.productId === primaryProductId);
    const addedLine = body.items.find((i: { productId: string }) => i.productId !== primaryProductId);
    expect(primaryLine.lineDiscountMinor).toBe(body.totals.discountMinor);
    expect(addedLine.lineDiscountMinor).toBe(0); // never stacked onto both lines
  });
});

describe("Commerce Execution — idempotency (PART 06 §8, §48-§51, §126)", () => {
  it("returns the exact same checkout for a retried request with the same idempotency key", async () => {
    const { authorizationId, primaryProductId, variantId } = await authorizeProposal(null);
    const body = { authorizationId, selection: { productId: primaryProductId, variantId, quantity: 1 }, idempotencyKey: randomUUID() };

    const first = await checkout(body);
    const second = await checkout(body);
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(first.json().checkoutId).toBe(second.json().checkoutId);
    expect(first.json().orderId).toBe(second.json().orderId);

    const orders = await prisma.order.count({ where: { authorizationId } });
    expect(orders).toBe(1); // never duplicated
  });

  it("rejects the same idempotency key reused for a materially different request", async () => {
    const { authorizationId, primaryProductId, variantId } = await authorizeProposal(null);
    const idempotencyKey = randomUUID();
    const first = await checkout({ authorizationId, selection: { productId: primaryProductId, variantId, quantity: 1 }, idempotencyKey });
    expect(first.statusCode).toBe(200);

    const second = await checkout({ authorizationId, selection: { productId: primaryProductId, variantId, quantity: 2 }, idempotencyKey });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("rejects a second checkout attempt against an already-consumed authorization, even with a fresh idempotency key", async () => {
    const { authorizationId, primaryProductId, variantId } = await authorizeProposal(null);
    const first = await checkout({ authorizationId, selection: { productId: primaryProductId, variantId, quantity: 1 }, idempotencyKey: randomUUID() });
    expect(first.statusCode).toBe(200);

    const second = await checkout({ authorizationId, selection: { productId: primaryProductId, variantId, quantity: 1 }, idempotencyKey: randomUUID() });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe("AUTHORIZATION_ALREADY_CONSUMED");

    const orders = await prisma.order.count({ where: { authorizationId } });
    expect(orders).toBe(1);
  });

  it("two concurrent checkout attempts against the same authorization resolve to exactly one order", async () => {
    const { authorizationId, primaryProductId, variantId } = await authorizeProposal(null);
    const [a, b] = await Promise.all([
      checkout({ authorizationId, selection: { productId: primaryProductId, variantId, quantity: 1 }, idempotencyKey: randomUUID() }),
      checkout({ authorizationId, selection: { productId: primaryProductId, variantId, quantity: 1 }, idempotencyKey: randomUUID() }),
    ]);
    const statuses = [a.statusCode, b.statusCode].sort();
    expect(statuses).toEqual([200, 409]);
    const orders = await prisma.order.count({ where: { authorizationId } });
    expect(orders).toBe(1);
  });
});

describe("Commerce Execution — tamper resistance (PART 06 §107-§110, §139)", () => {
  it("rejects a request substituting a different product than the one authorized", async () => {
    const { authorizationId, variantId } = await authorizeProposal(null);
    const otherProduct = await productId("Meridian CoolMax Running Socks");
    const res = await checkout({
      authorizationId,
      selection: { productId: otherProduct, variantId, quantity: 1 },
      idempotencyKey: randomUUID(),
    });
    expect(res.statusCode).toBe(403);
  });

  it("ignores client-submitted price/discount/total fields entirely — they are not part of the schema", async () => {
    const { authorizationId, primaryProductId, variantId } = await authorizeProposal(null);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/commerce/checkout",
      payload: {
        authorizationId,
        selection: { productId: primaryProductId, variantId, quantity: 1 },
        idempotencyKey: randomUUID(),
        amountMinor: 100,
        discountBps: 10_000,
        totalMinor: 1,
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totals.totalMinor).toBeGreaterThan(100); // authoritative total, never ₹1
  });

  it("rejects a quantity above the schema's bounded maximum", async () => {
    const { authorizationId, primaryProductId, variantId } = await authorizeProposal(null);
    const res = await checkout({
      authorizationId,
      selection: { productId: primaryProductId, variantId, quantity: 999 },
      idempotencyKey: randomUUID(),
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects an expired authorization", async () => {
    const { authorizationId, primaryProductId, variantId } = await authorizeProposal(null);
    await prisma.executionAuthorization.update({ where: { id: authorizationId }, data: { expiresAt: new Date(Date.now() - 60_000) } });
    const res = await checkout({
      authorizationId,
      selection: { productId: primaryProductId, variantId, quantity: 1 },
      idempotencyKey: randomUUID(),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("AUTHORIZATION_EXPIRED");
  });
});

describe("Commerce Execution — ledger integrity (PART 06 §84-§88, §105)", () => {
  it("records the full commerce sequence on the same workflow the proposal established", async () => {
    const proposal = await proposeCrossSellWithDiscount(null);
    const evalRes = await evaluate(proposal.id);
    const authorizationId = evalRes.json().authorization.id;
    const variantId = await cheapestActiveVariant(proposal.primaryProductId);

    const res = await checkout({
      authorizationId,
      selection: { productId: proposal.primaryProductId, variantId, quantity: 1 },
      idempotencyKey: randomUUID(),
    });
    expect(res.statusCode).toBe(200);

    const verifyRes = await app.inject({ method: "GET", url: `/api/v1/action-ledger/workflows/${proposal.traceId}/verify` });
    const verifyBody = verifyRes.json();
    expect(verifyBody.valid).toBe(true);

    const events = await prisma.agentAction.findMany({ where: { workflowId: proposal.traceId }, orderBy: { sequence: "asc" } });
    const actionTypes = events.map((e) => e.actionType);
    expect(actionTypes).toContain("GROWTH_PROPOSAL_CREATED");
    expect(actionTypes).toContain("POLICY_ALLOWED");
    expect(actionTypes).toContain("COMMERCE_EXECUTION_REQUESTED");
    expect(actionTypes).toContain("CART_CREATED");
    expect(actionTypes).toContain("ORDER_CREATED");
    expect(actionTypes).toContain("CHECKOUT_CREATED");
    expect(actionTypes).toContain("EXECUTION_AUTHORIZATION_CONSUMED");
    expect(actionTypes).toContain("CHECKOUT_READY_FOR_PAYMENT");
    expect(events.every((e) => e.actorType === "COMMERCE" || e.actorType === "SYSTEM" || e.actorType === "MERCHANT_AGENT" || e.actorType === "POLICY_ENGINE" || e.actorType === "CUSTOMER")).toBe(true);
  });
});

describe("Commerce read APIs (PART 06 §74-§75)", () => {
  it("returns the checkout and order via their read endpoints", async () => {
    const { authorizationId, primaryProductId, variantId } = await authorizeProposal(null);
    const res = await checkout({ authorizationId, selection: { productId: primaryProductId, variantId, quantity: 1 }, idempotencyKey: randomUUID() });
    const { checkoutId, orderId } = res.json();

    const checkoutRes = await app.inject({ method: "GET", url: `/api/v1/commerce/checkouts/${checkoutId}` });
    expect(checkoutRes.statusCode).toBe(200);
    expect(checkoutRes.json().status).toBe("READY_FOR_PAYMENT");

    const orderRes = await app.inject({ method: "GET", url: `/api/v1/commerce/orders/${orderId}` });
    expect(orderRes.statusCode).toBe(200);
    expect(orderRes.json().items.length).toBeGreaterThan(0);
  });

  it("404s for a checkout/order that does not exist", async () => {
    const missing = randomUUID();
    const checkoutRes = await app.inject({ method: "GET", url: `/api/v1/commerce/checkouts/${missing}` });
    expect(checkoutRes.statusCode).toBe(404);
    const orderRes = await app.inject({ method: "GET", url: `/api/v1/commerce/orders/${missing}` });
    expect(orderRes.statusCode).toBe(404);
  });
});
