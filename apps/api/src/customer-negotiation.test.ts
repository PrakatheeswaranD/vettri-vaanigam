/**
 * Automated customer negotiation, through the real routes.
 *
 * The domain tests pin the arithmetic. These pin the things only an
 * integration can: that the customer's tier is DERIVED and cannot be
 * asserted, that the discount is computed against the server's price,
 * that a proposal cannot be negotiated twice, and that an escalated
 * request is a merchant decision rather than a delayed automatic one.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildAuthedTestApp, getTestMerchantId } from "./test-helpers/test-app.js";
import { prisma } from "./db/client.js";
import { CUSTOMER_AGENT_ID } from "./modules/buyer-policy/negotiation-service.js";

let app: FastifyInstance;
let merchantId: string;
let variantId: string;
let priceMinor: number;

const AUTO_APPLY_CEILING_BPS = 500;
const MAX_DISCOUNT_BPS = 1500;
const MAX_AUTO_APPLY_MINOR = 200_000; // ₹2,000

async function createProposal(quantity = 1) {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/buyer/purchase-proposals",
    payload: { variantId, quantity },
  });
  if (res.statusCode !== 200) throw new Error(`proposal failed: ${res.statusCode} ${res.body}`);
  return res.json() as { id: string; amountMinor: number; outcome: string };
}

function negotiate(id: string, discountBps?: number | null) {
  return app.inject({
    method: "POST",
    url: `/api/v1/buyer/purchase-proposals/${id}/negotiate`,
    payload: discountBps === undefined ? {} : { discountBps },
  });
}

function standing() {
  return app.inject({ method: "GET", url: "/api/v1/buyer/standing" });
}

/**
 * Fakes a settled purchase history by writing the same rows a real
 * settlement writes. The tier is read from these, never from a request.
 */
async function giveCustomerSettledOrders(count: number, disputed = 0) {
  await prisma.decisionRecord.deleteMany({
    where: { externalAgentId: CUSTOMER_AGENT_ID, protocolActorRef: merchantId, settlementStatus: { in: ["SETTLED", "REFUNDED"] } },
  });
  for (let i = 0; i < count; i += 1) {
    await prisma.decisionRecord.create({
      data: {
        merchantId,
        externalAgentId: CUSTOMER_AGENT_ID,
        protocolActorRef: merchantId,
        outcome: "AUTO_APPROVE",
        reasonCode: "BUYER_POLICY_PASSED",
        explanation: "Seeded settled order for negotiation history.",
        computedTotalMinor: 300_000,
        currency: "INR",
        settlementStatus: "SETTLED",
        decisionLatencyMs: 0,
      },
    });
  }
  for (let i = 0; i < disputed; i += 1) {
    await prisma.decisionRecord.create({
      data: {
        merchantId,
        externalAgentId: CUSTOMER_AGENT_ID,
        protocolActorRef: merchantId,
        outcome: "AUTO_APPROVE",
        reasonCode: "BUYER_POLICY_PASSED",
        explanation: "Seeded refunded order for negotiation history.",
        computedTotalMinor: 300_000,
        currency: "INR",
        settlementStatus: "REFUNDED",
        decisionLatencyMs: 0,
      },
    });
  }
}

beforeAll(async () => {
  app = await buildAuthedTestApp();
  merchantId = await getTestMerchantId(prisma);

  await prisma.agentGatewayPolicy.upsert({
    where: { merchantId },
    create: {
      merchantId,
      policyVersion: 1,
      negotiationAutoApplyCeilingBps: AUTO_APPLY_CEILING_BPS,
      negotiationMaxDiscountBps: MAX_DISCOUNT_BPS,
      negotiationMaxAutoApplyMinor: MAX_AUTO_APPLY_MINOR,
      negotiationAutomationEnabled: true,
      negotiatorFloorMarginBps: 1000,
    },
    update: {
      negotiationAutoApplyCeilingBps: AUTO_APPLY_CEILING_BPS,
      negotiationMaxDiscountBps: MAX_DISCOUNT_BPS,
      negotiationMaxAutoApplyMinor: MAX_AUTO_APPLY_MINOR,
      negotiationAutomationEnabled: true,
      negotiatorFloorMarginBps: 1000,
    },
  });

  // A variant with a KNOWN cost, so the margin check has something to
  // work with rather than failing closed on every test.
  const variant = await prisma.productVariant.findFirstOrThrow({
    where: { active: true, costMinor: { not: null }, product: { merchantId, status: "ACTIVE" } },
  });
  variantId = variant.id;
  priceMinor = variant.priceMinor;

  // The buyer policy has to permit this category, or every proposal is a
  // DECLINE and there is no price to negotiate.
  await prisma.buyerSpendingPolicy.upsert({
    where: { merchantId },
    create: {
      merchantId,
      allowedCategories: [(await prisma.product.findUniqueOrThrow({ where: { id: variant.productId } })).category],
      autonomousPurchaseLimitMinor: 100_000_000,
      dailyLimitMinor: 1_000_000_000,
    },
    update: {
      allowedCategories: [(await prisma.product.findUniqueOrThrow({ where: { id: variant.productId } })).category],
      autonomousPurchaseLimitMinor: 100_000_000,
      dailyLimitMinor: 1_000_000_000,
    },
  });
});

beforeEach(async () => {
  await giveCustomerSettledOrders(0);
});

afterAll(async () => {
  await prisma.decisionRecord.deleteMany({
    where: { externalAgentId: CUSTOMER_AGENT_ID, protocolActorRef: merchantId, settlementStatus: { in: ["SETTLED", "REFUNDED"] } },
  });
  await app.close();
  await prisma.$disconnect();
});

describe("customer standing — derived, never asserted", () => {
  it("starts a shopper with no history at NEW", async () => {
    const res = await standing();
    expect(res.statusCode).toBe(200);
    expect(res.json().tier).toBe("NEW");
    expect(res.json().earnedDiscountBps).toBe(0);
  });

  it("moves up as settled orders accumulate", async () => {
    await giveCustomerSettledOrders(3);
    expect((await standing()).json().tier).toBe("LOYAL");

    await giveCustomerSettledOrders(8);
    expect((await standing()).json().tier).toBe("VIP");
  });

  it("counts refunds against the tier", async () => {
    await giveCustomerSettledOrders(4, 1);
    const body = (await standing()).json();
    expect(body.disputedOrders).toBe(1);
    expect(body.effectiveOrders).toBe(2);
    expect(body.tier).toBe("RETURNING");
  });

  it("tells the shopper the merchant's line, not just their own tier", async () => {
    const body = (await standing()).json();
    expect(body.autoApplyCeilingBps).toBe(AUTO_APPLY_CEILING_BPS);
    expect(body.maxNegotiableDiscountBps).toBe(MAX_DISCOUNT_BPS);
    expect(body.maxAutoApplyDiscountMinor).toBe(MAX_AUTO_APPLY_MINOR);
  });
});

describe("negotiation — inside what the customer earned, it just happens", () => {
  it("applies a loyal shopper's discount with no merchant involved", async () => {
    await giveCustomerSettledOrders(3);
    const proposal = await createProposal();

    const res = await negotiate(proposal.id, 400);
    expect(res.statusCode).toBe(200);

    const body = res.json();
    expect(body.outcome).toBe("AUTO_APPLIED");
    expect(body.appliedDiscountBps).toBe(400);
    expect(body.awaitingMerchant).toBe(false);
    expect(body.finalTotalMinor).toBe(body.originalTotalMinor - body.appliedDiscountMinor);
  });

  it("offers what they earned when no number is named", async () => {
    await giveCustomerSettledOrders(3);
    const proposal = await createProposal();

    const body = (await negotiate(proposal.id)).json();
    expect(body.outcome).toBe("AUTO_APPLIED");
    expect(body.appliedDiscountBps).toBeGreaterThan(0);
  });

  /** Reducing the price must move the authorization envelope with it, or
   * the later authorize step compares against a stale number. */
  it("writes the discount and keeps the original total for audit", async () => {
    await giveCustomerSettledOrders(3);
    const proposal = await createProposal();
    await negotiate(proposal.id, 400);

    const row = await prisma.decisionRecord.findUniqueOrThrow({ where: { id: proposal.id } });
    expect(row.negotiationStatus).toBe("AUTO_APPLIED");
    expect(row.preNegotiationTotalMinor).toBe(proposal.amountMinor);
    expect(row.computedTotalMinor).toBeLessThan(proposal.amountMinor);
    expect(row.authorizationMaxAmountMinor).toBe(row.computedTotalMinor);
    expect(row.customerTierAtDecision).toBe("LOYAL");
  });

  it("gives a first-time shopper nothing, and explains why", async () => {
    const proposal = await createProposal();
    const body = (await negotiate(proposal.id)).json();
    expect(body.outcome).toBe("DECLINED");
    expect(body.reasonCode).toBe("NOTHING_TO_NEGOTIATE");
    expect(body.explanation).toContain("first order");
  });
});

describe("negotiation — past the line, the merchant decides", () => {
  it("escalates an above-ceiling request instead of applying it", async () => {
    await giveCustomerSettledOrders(3);
    const proposal = await createProposal();

    const body = (await negotiate(proposal.id, 1200)).json();
    expect(body.outcome).toBe("PROPOSED_TO_MERCHANT");
    expect(body.awaitingMerchant).toBe(true);
    expect(body.appliedDiscountMinor).toBe(0);

    // The price has NOT moved while a human is deciding.
    const row = await prisma.decisionRecord.findUniqueOrThrow({ where: { id: proposal.id } });
    expect(row.computedTotalMinor).toBe(proposal.amountMinor);
  });

  it("shows the merchant the rupees, not just the percentage", async () => {
    await giveCustomerSettledOrders(3);
    const proposal = await createProposal();
    await negotiate(proposal.id, 1200);

    const list = await app.inject({ method: "GET", url: "/api/v1/agent-gateway/negotiations" });
    const item = (list.json().items as { id: string; requestedDiscountMinor: number; wouldBecomeMinor: number; customerTier: string }[]).find(
      (row) => row.id === proposal.id,
    );

    expect(item).toBeTruthy();
    expect(item!.requestedDiscountMinor).toBeGreaterThan(0);
    expect(item!.wouldBecomeMinor).toBe(proposal.amountMinor - item!.requestedDiscountMinor);
    expect(item!.customerTier).toBe("LOYAL");
  });

  it("applies the discount only once a merchant approves", async () => {
    await giveCustomerSettledOrders(3);
    const proposal = await createProposal();
    await negotiate(proposal.id, 1200);

    const decided = await app.inject({
      method: "POST",
      url: `/api/v1/agent-gateway/negotiations/${proposal.id}/decide`,
      payload: { approve: true },
    });
    expect(decided.statusCode).toBe(200);
    expect(decided.json().status).toBe("MERCHANT_APPROVED");

    const row = await prisma.decisionRecord.findUniqueOrThrow({ where: { id: proposal.id } });
    expect(row.negotiatedDiscountBps).toBe(1200);
    expect(row.computedTotalMinor).toBe(proposal.amountMinor - Math.round((proposal.amountMinor * 1200) / 10_000));
  });

  it("keeps the original price when a merchant says no", async () => {
    await giveCustomerSettledOrders(3);
    const proposal = await createProposal();
    await negotiate(proposal.id, 1200);

    await app.inject({
      method: "POST",
      url: `/api/v1/agent-gateway/negotiations/${proposal.id}/decide`,
      payload: { approve: false },
    });

    const row = await prisma.decisionRecord.findUniqueOrThrow({ where: { id: proposal.id } });
    expect(row.negotiationStatus).toBe("MERCHANT_REJECTED");
    expect(row.computedTotalMinor).toBe(proposal.amountMinor);
    expect(row.negotiatedDiscountBps).toBeNull();
  });

  it("drops a decided negotiation off the merchant's queue", async () => {
    await giveCustomerSettledOrders(3);
    const proposal = await createProposal();
    await negotiate(proposal.id, 1200);
    await app.inject({
      method: "POST",
      url: `/api/v1/agent-gateway/negotiations/${proposal.id}/decide`,
      payload: { approve: false },
    });

    const list = await app.inject({ method: "GET", url: "/api/v1/agent-gateway/negotiations" });
    expect((list.json().items as { id: string }[]).some((row) => row.id === proposal.id)).toBe(false);
  });
});

describe("negotiation — what a client cannot do", () => {
  /** The obvious attack: call the endpoint in a loop and stack discounts. */
  it("refuses to negotiate the same proposal twice", async () => {
    await giveCustomerSettledOrders(3);
    const proposal = await createProposal();

    const first = await negotiate(proposal.id, 400);
    expect(first.statusCode).toBe(200);

    const second = await negotiate(proposal.id, 400);
    expect(second.statusCode).toBe(409);

    const row = await prisma.decisionRecord.findUniqueOrThrow({ where: { id: proposal.id } });
    // Discounted exactly once.
    expect(row.computedTotalMinor).toBe(proposal.amountMinor - Math.round((proposal.amountMinor * 400) / 10_000));
  });

  it("refuses a discount past the merchant's maximum without troubling them", async () => {
    await giveCustomerSettledOrders(8);
    const proposal = await createProposal();

    const body = (await negotiate(proposal.id, 9000)).json();
    expect(body.outcome).toBe("DECLINED");
    expect(body.reasonCode).toBe("ABOVE_NEGOTIABLE_MAXIMUM");

    const list = await app.inject({ method: "GET", url: "/api/v1/agent-gateway/negotiations" });
    expect((list.json().items as { id: string }[]).some((row) => row.id === proposal.id)).toBe(false);
  });

  it("still tells the customer what they could have had", async () => {
    await giveCustomerSettledOrders(8);
    const proposal = await createProposal();
    const body = (await negotiate(proposal.id, 9000)).json();
    expect(body.counterOfferBps).toBeGreaterThan(0);
  });

  it("refuses to renegotiate a proposal that is already authorized", async () => {
    await giveCustomerSettledOrders(3);
    const proposal = await createProposal();
    await prisma.decisionRecord.update({ where: { id: proposal.id }, data: { settlementStatus: "EXECUTING" } });

    const res = await negotiate(proposal.id, 400);
    expect(res.statusCode).toBe(409);
  });

  it("does not let one buyer negotiate another's proposal", async () => {
    await giveCustomerSettledOrders(3);
    const proposal = await createProposal();
    await prisma.decisionRecord.update({ where: { id: proposal.id }, data: { protocolActorRef: "some-other-buyer" } });

    const res = await negotiate(proposal.id, 400);
    expect(res.statusCode).toBe(404);
  });
});

/**
 * The property that makes automating this safe at all: a percentage is
 * not a limit on a large basket.
 */
describe("negotiation — the rupee cap binds before the percentage", () => {
  it("never auto-applies more than the configured rupee cap", async () => {
    await giveCustomerSettledOrders(8);

    // A basket big enough that the tier percentage exceeds the cap.
    const quantity = Math.max(2, Math.ceil((MAX_AUTO_APPLY_MINOR * 30) / priceMinor));
    const proposal = await createProposal(Math.min(10, quantity));

    const body = (await negotiate(proposal.id)).json();
    if (body.outcome === "AUTO_APPLIED") {
      expect(body.appliedDiscountMinor).toBeLessThanOrEqual(MAX_AUTO_APPLY_MINOR);
    } else {
      expect(body.outcome).toBe("PROPOSED_TO_MERCHANT");
    }
  });
});

describe("negotiation — automation can be switched off entirely", () => {
  it("sends everything to the merchant when the merchant turns it off", async () => {
    await prisma.agentGatewayPolicy.update({
      where: { merchantId },
      data: { negotiationAutomationEnabled: false },
    });
    await giveCustomerSettledOrders(8);

    try {
      const proposal = await createProposal();
      const body = (await negotiate(proposal.id, 300)).json();
      expect(body.outcome).toBe("PROPOSED_TO_MERCHANT");
      expect(body.appliedDiscountMinor).toBe(0);
    } finally {
      await prisma.agentGatewayPolicy.update({
        where: { merchantId },
        data: { negotiationAutomationEnabled: true },
      });
    }
  });
});
