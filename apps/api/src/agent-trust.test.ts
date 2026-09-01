/**
 * Adaptive Agent Trust Score — through the real gateway route.
 *
 * The domain unit tests pin the arithmetic. These pin the thing that
 * actually matters to a merchant: that an agent's OWN behaviour, recorded
 * by the gateway on earlier calls, changes what the gateway does on later
 * ones — with no new write path, no manual counter, and nobody retuning a
 * limit by hand.
 *
 * Each test enrols a fresh agent, because the subject under test IS the
 * history, and a shared identity would carry someone else's in.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";
import { prisma } from "./db/client.js";
import { getTestMerchantId } from "./test-helpers/test-app.js";
import { enrolAgent, type EnrolledAgent } from "./test-helpers/enrol-agent.js";
import { TRUST_SCORE_BASELINE } from "@razorgrowth/domain";

let app: FastifyInstance;
let merchantId: string;
let merchantSlug: string;
let sku: string;
let priceMinor: number;
let blockedSku: string;
let blockedPriceMinor: number;

const UNKNOWN_CEILING = 1_000_000; // ₹10,000
const KNOWN_CEILING = 5_000_000; // ₹50,000

async function intent(as: EnrolledAgent, body: Record<string, unknown>) {
  return app.inject({
    method: "POST",
    url: `/api/v1/agent-gateway/${merchantSlug}/intents`,
    headers: { "x-agent-id": as.externalAgentId },
    payload: body,
  });
}

/** One ordinary, honest purchase of `quantity` units. */
async function buy(as: EnrolledAgent, quantity = 1) {
  const total = priceMinor * quantity;
  return intent(as, {
    items: [{ id: sku, quantity }],
    buyer: {},
    totals: { total },
    vaanigam_mandate: as.mandate(merchantId, { maxAmountMinor: total + 1 }),
  });
}

/** One forged mandate: a ceiling raised after the signature was made. */
async function forge(as: EnrolledAgent) {
  return intent(as, {
    items: [{ id: sku, quantity: 1 }],
    buyer: {},
    totals: { total: priceMinor },
    vaanigam_mandate: { ...as.mandate(merchantId, { maxAmountMinor: 100 }), maxAmountMinor: 99_000_000 },
  });
}

/** Settled orders are what the merchant's own history is made of. */
async function creditSettledOrders(as: EnrolledAgent, count: number) {
  await prisma.agentIdentity.update({
    where: { merchantId_externalAgentId: { merchantId, externalAgentId: as.externalAgentId } },
    data: { settledOrderCount: count },
  });
}

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  merchantId = await getTestMerchantId(prisma);
  merchantSlug = (await prisma.merchant.findUniqueOrThrow({ where: { id: merchantId } })).slug;

  await prisma.agentGatewayPolicy.upsert({
    where: { merchantId },
    create: {
      merchantId,
      policyVersion: 1,
      unknownAgentCeilingMinor: UNKNOWN_CEILING,
      knownAgentCeilingMinor: KNOWN_CEILING,
      blockedCategories: ["Hydration"],
      maxNegotiationDiscountBps: 1000,
      velocityMaxIntentsPerHour: 500,
    },
    update: {
      unknownAgentCeilingMinor: UNKNOWN_CEILING,
      knownAgentCeilingMinor: KNOWN_CEILING,
      blockedCategories: ["Hydration"],
      velocityMaxIntentsPerHour: 500,
    },
  });

  const variant = await prisma.productVariant.findFirstOrThrow({
    where: { active: true, product: { merchantId, category: "Running Shoes", status: "ACTIVE" } },
  });
  sku = variant.sku;
  priceMinor = variant.priceMinor;

  const blocked = await prisma.productVariant.findFirstOrThrow({
    where: { active: true, product: { merchantId, category: "Hydration", status: "ACTIVE" } },
  });
  blockedSku = blocked.sku;
  blockedPriceMinor = blocked.priceMinor;
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("agent trust — a fresh agent", () => {
  it("starts at the baseline and gets exactly the unknown-agent ceiling", async () => {
    const fresh = await enrolAgent(prisma, merchantId);
    const res = await buy(fresh);

    expect(res.statusCode).toBe(200);
    expect(res.json().trustScore).toBe(TRUST_SCORE_BASELINE);
    expect(res.json().appliedCeilingMinor).toBe(UNKNOWN_CEILING);
  });

  it("records the score it decided on, so the console can show it later", async () => {
    const fresh = await enrolAgent(prisma, merchantId);
    const res = await buy(fresh);

    const record = await prisma.decisionRecord.findUniqueOrThrow({ where: { id: res.json().decisionId } });
    expect(record.trustScoreAtDecision).toBe(TRUST_SCORE_BASELINE);
    // PROVISIONAL, not ESTABLISHED: the band only reaches ESTABLISHED at
    // 55, so an agent has to actually settle an order to get there. A
    // stranger sitting at the baseline is exactly "provisional".
    expect(record.trustBandAtDecision).toBe("PROVISIONAL");
  });
});

describe("agent trust — earning a ceiling up", () => {
  it("lets a proven agent auto-approve an order a stranger could not", async () => {
    const proven = await enrolAgent(prisma, merchantId);
    await creditSettledOrders(proven, 5);

    // Twice the unknown-agent ceiling, well inside the known one.
    const quantity = Math.ceil((UNKNOWN_CEILING * 2) / priceMinor);
    const res = await buy(proven, quantity);

    expect(res.statusCode).toBe(200);
    expect(res.json().outcome).toBe("AUTO_APPROVE");
    expect(res.json().trustScore).toBe(100);
    expect(res.json().appliedCeilingMinor).toBe(KNOWN_CEILING);
    expect(res.json().explanation).toContain("earned");
  });

  /** The hard limit: a derived score must never mint authority a human did
   * not configure. */
  it("still steps up past the merchant's configured maximum, at any score", async () => {
    const proven = await enrolAgent(prisma, merchantId);
    await creditSettledOrders(proven, 500);

    const quantity = Math.ceil(KNOWN_CEILING / priceMinor) + 1;
    const res = await buy(proven, quantity);

    expect(res.statusCode).toBe(202);
    expect(res.json().outcome).toBe("STEP_UP");
    expect(res.json().trustScore).toBe(100);
    expect(res.json().appliedCeilingMinor).toBe(KNOWN_CEILING);
  });
});

describe("agent trust — collapsing on being caught", () => {
  /**
   * The demo moment: the SAME agent and the SAME basket, before and after
   * one forged mandate. Nothing about the merchant's policy changed in
   * between.
   */
  it("steps up a basket it would have auto-approved before it cheated", async () => {
    const turncoat = await enrolAgent(prisma, merchantId);
    await creditSettledOrders(turncoat, 5);

    const quantity = Math.ceil((UNKNOWN_CEILING * 1.5) / priceMinor);

    const before = await buy(turncoat, quantity);
    expect(before.json().outcome).toBe("AUTO_APPROVE");
    const scoreBefore: number = before.json().trustScore;

    const caught = await forge(turncoat);
    expect(caught.json().reasonCode).toBe("MANDATE_SIGNATURE_INVALID");

    const after = await buy(turncoat, quantity);
    expect(after.json().trustScore).toBeLessThan(scoreBefore);
    expect(after.json().outcome).toBe("STEP_UP");
  });

  it("drops a caught agent BELOW what a total stranger is allowed", async () => {
    const caughtAgent = await enrolAgent(prisma, merchantId);
    await forge(caughtAgent);

    const res = await buy(caughtAgent);
    expect(res.json().trustScore).toBe(TRUST_SCORE_BASELINE - 40);
    expect(res.json().appliedCeilingMinor).toBeLessThan(UNKNOWN_CEILING);
  });

  /** Losing trust must never lose the sale outright — it escalates. */
  it("escalates rather than declining, so a legitimate order survives", async () => {
    const wiped = await enrolAgent(prisma, merchantId);
    for (let i = 0; i < 3; i += 1) await forge(wiped);

    const res = await buy(wiped);
    expect(res.json().trustScore).toBe(0);
    expect(res.json().appliedCeilingMinor).toBe(0);
    expect(res.json().outcome).toBe("STEP_UP");
    expect(res.json().explanation).toContain("nothing at all");
    expect(res.json().explanation).not.toContain("Infinity");
  });
});

describe("agent trust — what does NOT count against an agent", () => {
  /**
   * A typo in a SKU is a support ticket, not a risk signal. Charging it 25
   * points would collapse an honest integration's ceiling before anyone
   * noticed the score was moving.
   */
  it("does not penalise a badly-wired agent for an unresolvable item", async () => {
    const clumsy = await enrolAgent(prisma, merchantId);

    for (let i = 0; i < 3; i += 1) {
      await intent(clumsy, {
        items: [{ id: `SKU-DOES-NOT-EXIST-${i}`, quantity: 1 }],
        buyer: {},
        vaanigam_mandate: clumsy.mandate(merchantId),
      });
    }

    const res = await buy(clumsy);
    expect(res.json().trustScore).toBe(TRUST_SCORE_BASELINE);
    expect(res.json().outcome).toBe("AUTO_APPROVE");
  });

  /** Penalising a step-up would make the score punish the guardrail for
   * doing exactly what it exists to do. */
  it("does not penalise an agent for correctly triggering a step-up", async () => {
    const overreacher = await enrolAgent(prisma, merchantId);

    const quantity = Math.ceil(UNKNOWN_CEILING / priceMinor) + 1;
    const stepped = await buy(overreacher, quantity);
    expect(stepped.json().outcome).toBe("STEP_UP");

    const res = await buy(overreacher);
    expect(res.json().trustScore).toBe(TRUST_SCORE_BASELINE);
  });

  it("does penalise an agent that keeps trying to buy what it may not", async () => {
    const persistent = await enrolAgent(prisma, merchantId);

    for (let i = 0; i < 2; i += 1) {
      const res = await intent(persistent, {
        items: [{ id: blockedSku, quantity: 1 }],
        buyer: {},
        totals: { total: blockedPriceMinor },
        vaanigam_mandate: persistent.mandate(merchantId),
      });
      expect(res.json().reasonCode).toBe("CATEGORY_BLOCKED");
    }

    const res = await buy(persistent);
    expect(res.json().trustScore).toBe(TRUST_SCORE_BASELINE - 50);
  });
});
