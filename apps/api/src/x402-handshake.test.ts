/**
 * x402 challenge/response (TECH_SPEC §2.3).
 *
 * The handshake is implemented for real, so it is tested for real. What is
 * NOT real is settlement, and the tests below assert that the response
 * says so — a 200 here must never be readable as an on-chain payment.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";
import { prisma } from "./db/client.js";
import { getTestMerchantId } from "./test-helpers/test-app.js";

let app: FastifyInstance;
let merchantId: string;
let slug: string;
let sku: string;
let priceMinor: number;

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
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

function purchase(headers: Record<string, string> = {}, quantity = 1) {
  return app.inject({
    method: "POST",
    url: `/api/v1/x402/${slug}/purchase`,
    headers: { "x-agent-id": "agent-x402-suite", ...headers },
    payload: { items: [{ sku, quantity }], currency: "INR" },
  });
}

function paymentHeader(value: unknown): Record<string, string> {
  return { "payment-signature": Buffer.from(JSON.stringify(value), "utf8").toString("base64") };
}

/**
 * A payload authorising a SPECIFIC amount, because that is what a real
 * client does: read the quoted `accepts[0].amount` from the 402, then
 * authorise exactly that. Authorising some other figure is a genuine
 * disagreement about the price and the gateway is right to refuse it —
 * see the mismatch test below.
 */
function payloadFor(amountMinor: number, overrides: Record<string, unknown> = {}) {
  return {
    x402Version: 2,
    accepted: {
      scheme: "exact",
      network: "eip155:84532",
      amount: String(amountMinor),
      asset: process.env.X402_ASSET!,
      payTo: process.env.X402_PAY_TO!,
      maxTimeoutSeconds: 60,
    },
    payload: {
      signature: "0xdeadbeefdeadbeefdeadbeef",
      authorization: {
        from: "0xabc",
        to: process.env.X402_PAY_TO!,
        value: String(amountMinor),
        // Required now: an authorisation with no expiry, or an expired
        // one, is not a payment instruction we can act on.
        validAfter: String(Math.floor(Date.now() / 1000) - 5),
        validBefore: String(Math.floor(Date.now() / 1000) + 600),
        nonce: randomUUID(),
      },
    },
    ...overrides,
  };
}

/** The real exchange: unpaid request, read the quote, retry with it. */
async function challengeThenPay(quantity = 1) {
  const challenge = await purchase({}, quantity);
  const quoted = Number(challenge.json().accepts[0].amount);
  return { challenge, paid: await purchase(paymentHeader(payloadFor(quoted)), quantity), quoted };
}

describe("x402 — the challenge", () => {
  it("answers an unpaid request with a real 402 and an accepts offer", async () => {
    const res = await purchase();

    expect(res.statusCode).toBe(402);
    const body = res.json();
    expect(body.x402Version).toBe(2);
    expect(body.accepts).toHaveLength(1);
    expect(body.accepts[0]).toMatchObject({ scheme: "exact", maxTimeoutSeconds: 60 });
    // The quoted amount is OUR price, computed before quoting — never a
    // number the client supplied.
    expect(body.accepts[0].amount).toBe(String(priceMinor));
    expect(res.headers["payment-required"]).toBeTruthy();
  });

  it("quotes the correct total for a multi-unit basket", async () => {
    const res = await purchase({}, 3);
    expect(res.json().accepts[0].amount).toBe(String(priceMinor * 3));
  });

  it("404s for a SKU it cannot sell rather than quoting a price for it", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/x402/${slug}/purchase`,
      payload: { items: [{ sku: "NOT-REAL", quantity: 1 }], currency: "INR" },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("x402 — the retry", () => {
  it("accepts a base64 PAYMENT-SIGNATURE header and steps up when no facilitator is configured", async () => {
    const { challenge, paid, quoted } = await challengeThenPay();

    expect(challenge.statusCode).toBe(402);
    expect(quoted).toBe(priceMinor);
    expect(paid.statusCode).toBe(202);
    const body = paid.json();
    // STEP_UP, not AUTO_APPROVE. x402 settlement cannot be verified without
    // a facilitator, so no order is created and nobody is charged — the
    // purchase waits for a human. An auto-approval here would mean trusting
    // the buyer's own word that the money exists.
    expect(body.vaanigam.decision).toBe("STEP_UP");
    expect(body.vaanigam.order_id).toBeFalsy();
    expect(body.vaanigam.reason).toMatch(/no settlement facilitator|nobody has verified/i);
  });

  it("accepts raw JSON too, and still steps up rather than settling", async () => {
    const res = await purchase({ "payment-signature": JSON.stringify(payloadFor(priceMinor)) });
    // 202, not 200: no facilitator means nobody verified the money exists,
    // so it goes to a human rather than being charged on the buyer's word.
    expect(res.statusCode).toBe(202);
  });

  it("refuses at the x402 layer when the client authorises an amount that is not the quote", async () => {
    // The client "read" the quote and then authorised something else.
    // Settling that would charge a price neither side agreed on.
    const res = await purchase(paymentHeader(payloadFor(1)));
    // 402, not 403: a payload that disagrees with the quote is refused by
    // the x402 layer itself before the gateway ever sees it, which is the
    // protocol-native answer — "your payment was wrong, here is the price
    // again" rather than "your purchase was declined".
    expect(res.statusCode).toBe(402);
    expect(res.json().error).toBe("payment_payload_rejected");
    expect(res.json().detail).toMatch(/signed authorisation covers|payload accepts/i);
  });

  it("re-challenges with 402 when the header does not decode", async () => {
    const res = await purchase({ "payment-signature": "!!!not-base64-or-json!!!" });
    expect(res.statusCode).toBe(402);
  });

  it("steps up an over-ceiling purchase instead of settling it", async () => {
    const quantity = Math.ceil(1_000_000 / priceMinor) + 1;
    const { paid } = await challengeThenPay(quantity);

    expect(paid.statusCode).toBe(202);
    expect(paid.json().vaanigam.decision).toBe("STEP_UP");
  });
});

describe("x402 — honesty about settlement", () => {
  /**
   * The single most important assertion in this file. The handshake is
   * genuine; settlement is not. A caller reading a 200 as "paid on-chain"
   * would be relying on something that never happened.
   */
  it("labels every unverified outcome as not settled", async () => {
    const { paid: approved } = await challengeThenPay();
    expect(approved.json().settlement_status).toBe("not_settled");
    expect(approved.json().settlement_note).toMatch(/nothing settled on-chain/i);

    const quantity = Math.ceil(1_000_000 / priceMinor) + 1;
    const { paid: steppedUp } = await challengeThenPay(quantity);
    expect(steppedUp.json().settlement_status).toBe("not_settled");
  });

  it("records the decision as x402 so the console can badge it", async () => {
    const { paid: res } = await challengeThenPay();
    const record = await prisma.decisionRecord.findFirstOrThrow({
      where: { merchantId, protocol: "X402" },
      orderBy: { createdAt: "desc" },
    });
    expect(res.statusCode).toBeLessThan(300);
    expect(record.protocol).toBe("X402");
  });
});
