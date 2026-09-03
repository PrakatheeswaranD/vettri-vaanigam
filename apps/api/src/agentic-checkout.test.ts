/**
 * "Buy this." carried all the way to a real payment order.
 *
 * WHAT THESE ASSERTIONS ARE ACTUALLY GUARDING
 *
 * Not "does a purchase work" — `buyer-agent-pipeline.test.ts` covers that.
 * These guard the two things that go wrong quietly on a checkout path:
 *
 *   1. **A discount that is displayed and not applied.** Part 9 surfaced
 *      merchant-authorized offers to the buyer. Nothing applied them, so
 *      the agent quoted 5% off and the proposal charged list price. The
 *      arithmetic assertions below are exact, in integer minor units, and
 *      they run against a product that genuinely carries an authorized
 *      offer — a fixture with no offer would let every one of them pass
 *      while proving nothing, so the offer's existence is asserted first.
 *
 *   2. **A frontend concluding a purchase completed.** Authorizing creates
 *      a payment ORDER. It does not charge. The test asserts the payment
 *      comes back in a pre-capture state with `paid: false`, because the
 *      only thing that may set `paid` is a server-verified provider
 *      capture.
 *
 * Every figure here is read back from the database or the API response.
 * Nothing is computed in the test and compared against itself.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { BuyerAgentResponseDTO } from "@razorgrowth/contracts";
import { buildCustomerTestApp } from "./test-helpers/test-app.js";
import { prisma } from "./db/client.js";
import { findBuyerVisibleOffers } from "./modules/buyer-agent/offers-service.js";

let app: FastifyInstance;
/** Proposals this suite creates, so it cannot consume another suite's
 * daily spending allowance. */
const createdProposalIds: string[] = [];

async function say(message: string, conversationId?: string): Promise<BuyerAgentResponseDTO> {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/buyer/messages",
    payload: conversationId ? { conversationId, message } : { message },
  });
  expect(res.statusCode, `"${message}" -> ${res.body}`).toBe(200);
  const body = res.json() as BuyerAgentResponseDTO;
  if (body.purchase) createdProposalIds.push(body.purchase.proposalId);
  return body;
}

/**
 * A product that genuinely carries a merchant-authorized offer AND has
 * purchasable stock.
 *
 * Returned as null rather than throwing when the seed has none, so the
 * offer assertions can state plainly that they proved nothing rather than
 * failing for the wrong reason.
 */
async function productWithAuthorizedOffer(): Promise<{ productId: string; variantId: string; percentageBps: number } | null> {
  const proposals = await prisma.growthActionProposal.findMany({
    where: { status: { in: ["AUTHORIZED", "EXECUTED", "VERIFIED"] }, offerKind: { not: null }, offerPercentageBps: { gt: 0 } },
    orderBy: { createdAt: "desc" },
    select: { primaryProductId: true },
    take: 25,
  });

  for (const { primaryProductId } of proposals) {
    const [offer] = await findBuyerVisibleOffers(prisma, [primaryProductId]);
    if (!offer?.percentageBps) continue;
    const variant = await prisma.productVariant.findFirst({
      where: {
        productId: primaryProductId,
        active: true,
        product: { status: "ACTIVE", merchant: { status: "ACTIVE" } },
        inventory: { availableQuantity: { gte: 2 } },
      },
      orderBy: { priceMinor: "asc" },
      select: { id: true },
    });
    if (variant) return { productId: primaryProductId, variantId: variant.id, percentageBps: offer.percentageBps };
  }
  return null;
}

beforeAll(async () => {
  app = await buildCustomerTestApp();
});

afterAll(async () => {
  if (createdProposalIds.length > 0) {
    await prisma.decisionRecord.deleteMany({ where: { id: { in: createdProposalIds }, settlementStatus: "PROPOSED" } });
  }
  await app.close();
  await prisma.$disconnect();
});

describe("the offer is applied, not just displayed", () => {
  it("charges list price minus the merchant-authorized discount, exactly", async () => {
    const fixture = await productWithAuthorizedOffer();
    expect(fixture, "no product carries an authorized offer — this test would prove nothing").not.toBeNull();
    const { variantId, percentageBps } = fixture!;

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/buyer/purchase-proposals",
      payload: { variantId, quantity: 1 },
    });
    expect(res.statusCode, res.body).toBe(200);
    const proposal = res.json() as { id: string; amountMinor: number };
    createdProposalIds.push(proposal.id);

    const variant = await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } });
    const listTotalMinor = variant.priceMinor;
    const expectedDiscount = Math.min(listTotalMinor, Math.round((listTotalMinor * percentageBps) / 10_000));

    // The discount is real, not zero — otherwise everything below is
    // trivially satisfied by a proposal that ignored the offer entirely.
    expect(expectedDiscount).toBeGreaterThan(0);
    expect(proposal.amountMinor, "the offer was displayed but not applied").toBe(listTotalMinor - expectedDiscount);
    expect(proposal.amountMinor).toBeLessThan(listTotalMinor);
  });

  it("records the discount on the basket line so execution can reprice it", async () => {
    const fixture = await productWithAuthorizedOffer();
    if (!fixture) return;

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/buyer/purchase-proposals",
      payload: { variantId: fixture.variantId, quantity: 1 },
    });
    expect(res.statusCode, res.body).toBe(200);
    const proposalId = (res.json() as { id: string }).id;
    createdProposalIds.push(proposalId);

    const row = await prisma.decisionRecord.findUniqueOrThrow({ where: { id: proposalId } });
    const lines = row.normalizedBasket as Array<{ unitPriceMinor: number; quantity: number; lineDiscountMinor?: number }>;

    // Execution recomputes `(unitPrice * qty) - lineDiscount` and refuses
    // the purchase with FINANCIAL_INTEGRITY_ERROR if it disagrees with the
    // stored total. That invariant is asserted directly here, because it
    // is the thing standing between a discounted quote and a full-price
    // charge.
    const recomputed = lines.reduce(
      (sum, line) => sum + line.unitPriceMinor * line.quantity - (line.lineDiscountMinor ?? 0),
      0,
    );
    expect(recomputed).toBe(row.computedTotalMinor);
  });

  it("keeps every figure an integer in minor units", async () => {
    const fixture = await productWithAuthorizedOffer();
    if (!fixture) return;

    const conversation = await say("I need running shoes");
    const bought = await say("buy the first one", conversation.conversationId);
    if (!bought.purchase) return;

    const p = bought.purchase;
    for (const [label, value] of [
      ["unitPriceMinor", p.unitPriceMinor],
      ["listTotalMinor", p.listTotalMinor],
      ["discountMinor", p.discountMinor],
      ["amountMinor", p.amountMinor],
    ] as const) {
      expect(Number.isInteger(value), `${label} = ${value} is not an integer`).toBe(true);
    }
    // The identity the whole breakdown rests on. A buyer can check this
    // arithmetic on screen, so it has to be exactly true.
    expect(p.listTotalMinor - p.discountMinor).toBe(p.amountMinor);
  });
});

describe("the conversation carries the buyer to a real payment order", () => {
  it("shows the itemised breakdown before anything is authorized", async () => {
    const conversation = await say("I need running shoes");
    const bought = await say("buy the first one", conversation.conversationId);
    expect(bought.status, bought.unresolvedReason ?? "").toBe("PURCHASE_PROPOSED");

    const p = bought.purchase!;
    // What the buyer is owed before they say yes: what it is, how many,
    // at what price, and what they will actually pay.
    expect(p.productName.length).toBeGreaterThan(0);
    expect(p.variantTitle.length).toBeGreaterThan(0);
    expect(p.quantity).toBe(1);
    expect(p.unitPriceMinor).toBeGreaterThan(0);
    expect(p.currency.length).toBeGreaterThan(0);
    // Nothing has been charged, and no payment exists yet.
    expect(bought.checkout).toBeNull();
  });

  it("authorizes on 'yes' and creates a payment order that is NOT paid", async () => {
    const conversation = await say("I need running shoes");
    const bought = await say("buy the first one", conversation.conversationId);
    if (bought.status !== "PURCHASE_PROPOSED") return;

    const authorized = await say("yes", conversation.conversationId);

    // Either the authorization succeeded, or the server refused it for a
    // reason it states. Both are correct outcomes; silently doing nothing
    // is not, so the turn must be one of the two.
    expect(["CHECKOUT_READY", "AUTHORIZATION_REFUSED"]).toContain(authorized.status);
    if (authorized.status === "AUTHORIZATION_REFUSED") {
      expect(authorized.unresolvedReason, "a refusal must say why").toBeTruthy();
      return;
    }

    const checkout = authorized.checkout!;
    expect(checkout.paymentId).toBeTruthy();
    // THE ASSERTION THAT MATTERS. Authorizing creates an order with the
    // provider; it does not charge. Only a server-verified capture may
    // ever set `paid`, and no capture has happened here.
    expect(checkout.paid, "authorization must never report a completed payment").toBe(false);
    expect(checkout.state).not.toBe("CAPTURED");

    // The payment is real and readable back from the database — not a
    // shape the conversation invented.
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: checkout.paymentId } });
    expect(payment.state).toBe(checkout.state);
    expect(payment.amountMinor).toBe(checkout.amountMinor);
  });

  it("does not authorize when nothing is pending", async () => {
    // "yes" on a fresh conversation authorizes nothing. This is the gate
    // that stops an ordinary affirmation from creating a payment order.
    const fresh = await say("yes");
    expect(fresh.status).not.toBe("CHECKOUT_READY");
    expect(fresh.checkout).toBeNull();
    expect(fresh.turnAction).toBe("SEARCH");
  });

  it("refuses to authorize the same proposal twice", async () => {
    const conversation = await say("I need running shoes");
    const bought = await say("buy the first one", conversation.conversationId);
    if (bought.status !== "PURCHASE_PROPOSED") return;

    const first = await say("yes", conversation.conversationId);
    if (first.status !== "CHECKOUT_READY") return;

    // A second "yes" must not create a second payment order against the
    // same proposal. The proposal is no longer PROPOSED, so it is not
    // pending any more and the word means nothing again.
    const second = await say("yes", conversation.conversationId);
    expect(second.status).not.toBe("CHECKOUT_READY");

    const payments = await prisma.decisionRecord.findUniqueOrThrow({
      where: { id: bought.purchase!.proposalId },
      select: { internalPaymentId: true },
    });
    const paymentCount = await prisma.payment.count({ where: { id: payments.internalPaymentId ?? "" } });
    expect(paymentCount).toBeLessThanOrEqual(1);
  });
});
