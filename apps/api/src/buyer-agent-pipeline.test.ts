/**
 * The buyer pipeline, end to end, through the conversation.
 *
 * WHAT THIS EXISTS TO PROVE
 *
 * Both halves of the pipeline already worked before Part 9. Discovery,
 * filtering, comparison and recommendation ran in the conversation;
 * purchase, spending policy, authorization, checkout, payment,
 * verification and order ran over HTTP. Nothing joined them, so a buyer
 * who had just been shown three products had to leave the chat, find a
 * product page, and drive an ordinary checkout by hand — the exact thing
 * "express intent rather than operate a website" rules out.
 *
 * So these assertions follow ONE conversation from "I need..." through to
 * a priced purchase proposal, and check at each step that the agent used
 * real catalogue rows and invented nothing.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { BuyerAgentResponseDTO } from "@razorgrowth/contracts";
import { buildAuthedTestApp, buildCustomerTestApp, getTestBuyerContextId } from "./test-helpers/test-app.js";
import { prisma } from "./db/client.js";

let app: FastifyInstance;
let merchantApp: FastifyInstance;
let buyerContextId: string;
/** Proposals this suite creates, removed in `afterAll` so a conversation
 * test cannot consume another suite's daily spending allowance. */
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

beforeAll(async () => {
  app = await buildCustomerTestApp();
  merchantApp = await buildAuthedTestApp();
  buyerContextId = await getTestBuyerContextId(prisma);
});

afterAll(async () => {
  if (createdProposalIds.length > 0) {
    await prisma.decisionRecord.deleteMany({ where: { id: { in: createdProposalIds } } });
  }
  await app.close();
  await merchantApp.close();
  await prisma.$disconnect();
});

describe("the conversation carries the whole pipeline", () => {
  it("goes from natural language to a priced purchase proposal without leaving the chat", async () => {
    // 1. INTENT → STRUCTURED REQUIREMENTS → DISCOVERY → FILTERING →
    //    COMPARISON → REASONING → RECOMMENDATION
    const search = await say("I need running shoes under 8000");
    expect(search.turnAction).toBe("SEARCH");
    if (search.recommendations.length === 0) return; // catalogue-dependent

    // Every recommendation is a real catalogue row, not a model invention.
    for (const rec of search.recommendations) {
      const product = await prisma.product.findUnique({ where: { id: rec.productId } });
      expect(product, `recommended product ${rec.productId} must exist`).not.toBeNull();
      const variant = await prisma.productVariant.findUnique({ where: { id: rec.variantId } });
      expect(variant, `recommended variant ${rec.variantId} must exist`).not.toBeNull();
      expect(variant!.productId).toBe(rec.productId);
    }

    // 8. OFFER EVALUATION — every offer shown is one a merchant's policy
    //    engine actually authorized, never one the agent found or made up.
    for (const offer of search.offers) {
      const proposal = await prisma.growthActionProposal.findUnique({ where: { id: offer.proposalId } });
      expect(proposal, "an offer must trace to a real governance row").not.toBeNull();
      expect(["AUTHORIZED", "EXECUTED", "VERIFIED"]).toContain(proposal!.status);
      expect(proposal!.primaryProductId).toBe(offer.productId);
    }

    // 9-10. PURCHASE PROPOSAL + SPENDING POLICY, said in words.
    const buy = await say("buy the first one", search.conversationId);
    expect(["PURCHASE_PROPOSED", "PURCHASE_DECLINED"]).toContain(buy.status);
    expect(buy.turnAction).toBe("BUY");
    expect(buy.purchase, "a BUY turn must produce a purchase outcome").not.toBeNull();

    // The proposal is a real DecisionRecord owned by this shopper, priced
    // by the server from the catalogue row.
    const record = await prisma.decisionRecord.findUniqueOrThrow({ where: { id: buy.purchase!.proposalId } });
    expect(record.protocolActorRef).toBe(buyerContextId);
    expect(record.settlementStatus).toBe("PROPOSED");
    expect(buy.purchase!.amountMinor).toBe(record.computedTotalMinor);

    const variant = await prisma.productVariant.findUniqueOrThrow({ where: { id: buy.purchase!.variantId } });
    // The price came from the variant, not from anything in the message.
    expect(buy.purchase!.amountMinor).toBe(variant.priceMinor * buy.purchase!.quantity);
  });

  it("never moves money on a purchase turn", async () => {
    const search = await say("I need running shoes under 8000");
    if (search.recommendations.length === 0) return;

    const paymentsBefore = await prisma.payment.count();
    const buy = await say("buy the first one", search.conversationId);
    const paymentsAfter = await prisma.payment.count();

    // The whole promise of the proposal stage. A conversation that
    // charged a card because someone typed two words would be the single
    // worst thing this product could do.
    expect(paymentsAfter).toBe(paymentsBefore);
    if (buy.purchase) {
      expect(buy.purchase.requiresAuthorization || buy.purchase.outcome === "AUTO_APPROVE").toBe(true);
    }
  });
});

describe("the agent asks rather than guessing", () => {
  it("refuses to pick when several options are on the table", async () => {
    const search = await say("I need running shoes under 8000");
    if (search.recommendations.length < 2) return;

    const buy = await say("buy this", search.conversationId);
    // "Buy this" with four options is a guess. An agent that resolves it
    // by picking the first will eventually buy the wrong thing, and the
    // buyer will find out from their bank.
    expect(buy.status).toBe("ACTION_UNRESOLVED");
    expect(buy.purchase).toBeNull();
  });

  it("refuses an ordinal it does not have", async () => {
    const search = await say("I need running shoes under 8000");
    if (search.recommendations.length === 0) return;

    const buy = await say("buy the fifth one", search.conversationId);
    if (search.recommendations.length >= 5) return; // legitimately resolvable

    expect(buy.status).toBe("ACTION_UNRESOLVED");
    expect(buy.purchase).toBeNull();
  });

  it("treats a purchase phrase with nothing on the table as a search", async () => {
    // A brand new conversation. "Buy me running shoes" is an opening
    // request, not a purchase instruction.
    const opening = await say("buy me some running shoes");
    expect(opening.turnAction).toBe("SEARCH");
    expect(opening.purchase).toBeNull();
  });
});

describe("comparison is facts, not opinion", () => {
  it("builds a side-by-side from catalogue rows", async () => {
    const search = await say("I need running shoes under 8000");
    if (search.recommendations.length < 2) return;

    const compare = await say("compare these", search.conversationId);
    expect(compare.turnAction).toBe("COMPARE");
    expect(compare.status).toBe("COMPARISON_READY");
    expect(compare.comparison, "a comparison turn must produce a table").not.toBeNull();

    const table = compare.comparison!;
    expect(table.productIds.length).toBeGreaterThanOrEqual(2);

    for (const row of table.rows) {
      // One value per compared product, always.
      expect(row.values.length).toBe(table.productIds.length);
      // `differs` is DERIVED, never asserted — a row cannot claim a
      // difference its own values do not show.
      const distinct = new Set(row.values.map((v) => v ?? " null"));
      expect(row.differs).toBe(distinct.size > 1);
    }

    // Every compared product is one the agent actually recommended.
    for (const productId of table.productIds) {
      const product = await prisma.product.findUnique({ where: { id: productId } });
      expect(product).not.toBeNull();
    }
  });
});

describe("offer evaluation shows only what a merchant authorized", () => {
  it("surfaces a real authorized offer on a product that has one", async () => {
    // Pinned against a product KNOWN to carry an authorized offer, rather
    // than hoping a search happens to return one. Without this the offer
    // path could break silently: every other assertion tolerates an empty
    // list, because no offer is the normal case.
    const proposal = await prisma.growthActionProposal.findFirst({
      where: { status: { in: ["AUTHORIZED", "EXECUTED", "VERIFIED"] }, offerKind: { not: null } },
      orderBy: { createdAt: "desc" },
      select: { primaryProductId: true },
    });
    expect(proposal, "the demo data must contain at least one authorized offer").not.toBeNull();

    const { findBuyerVisibleOffers } = await import("./modules/buyer-agent/offers-service.js");
    const offers = await findBuyerVisibleOffers(prisma, [proposal!.primaryProductId]);

    expect(offers.length, "an authorized offer must be visible to the buyer").toBeGreaterThan(0);
    const offer = offers[0]!;
    // The amount is the merchant's own deterministic calculation, carried
    // verbatim — never recomputed here, because a second derivation is a
    // second chance to disagree with what governance authorized.
    expect(offer.discountMinor).not.toBeNull();
    expect(offer.baseAmountMinor).not.toBeNull();
    expect(offer.provenance).toMatch(/policy engine/i);
    expect(["AUTHORIZED", "EXECUTED", "VERIFIED"]).toContain(offer.status);
  });

  it("never shows an offer a merchant has not committed to", async () => {
    // A proposal still PROPOSED or PENDING_APPROVAL is something a
    // merchant agent SUGGESTED. Quoting it to a buyer would be quoting a
    // discount nobody agreed to.
    const uncommitted = await prisma.growthActionProposal.findFirst({
      where: { status: { in: ["PROPOSED", "PENDING_APPROVAL", "POLICY_DENIED"] }, offerKind: { not: null } },
      select: { primaryProductId: true, id: true },
    });
    if (!uncommitted) return;

    const { findBuyerVisibleOffers } = await import("./modules/buyer-agent/offers-service.js");
    const offers = await findBuyerVisibleOffers(prisma, [uncommitted.primaryProductId]);
    expect(offers.map((o) => o.proposalId)).not.toContain(uncommitted.id);
  });
});

describe("refinement keeps the constraints the buyer already gave", () => {
  it("reads 'show cheaper ones' as a refinement, not a new search", async () => {
    const search = await say("I need running shoes under 8000");
    if (search.recommendations.length === 0) return;

    const refined = await say("show cheaper ones", search.conversationId);
    // The distinction matters: treating it as a fresh search would
    // silently drop the category and budget the buyer already stated.
    expect(refined.turnAction).toBe("REFINE");
    expect(refined.conversationId).toBe(search.conversationId);
  });
});

describe("the conversation is not a second path around spending policy", () => {
  it("produces the same decision the REST purchase route produces", async () => {
    const search = await say("I need running shoes under 8000");
    if (search.recommendations.length === 0) return;
    const first = search.recommendations[0]!;

    // The same variant, once through the conversation and once through
    // the HTTP route. Both must land on the same policy outcome, because
    // both call `createPurchaseProposal` — if they ever disagree, the
    // conversation has grown its own copy of spending policy.
    const viaChat = await say("buy the first one", search.conversationId);
    const viaHttp = await app.inject({
      method: "POST",
      url: "/api/v1/buyer/purchase-proposals",
      payload: { variantId: first.variantId, quantity: 1 },
    });
    expect(viaHttp.statusCode, viaHttp.body).toBe(200);
    const httpBody = viaHttp.json() as { id: string; outcome: string; amountMinor: number };
    createdProposalIds.push(httpBody.id);

    if (viaChat.purchase) {
      expect(viaChat.purchase.outcome).toBe(httpBody.outcome);
      expect(viaChat.purchase.amountMinor).toBe(httpBody.amountMinor);
    }
  });

  it("refuses a purchase turn from a merchant session", async () => {
    // The Buyer Agent is a customer surface. A merchant session reaching
    // it would be a hole in the access model, not a feature.
    const res = await merchantApp.inject({
      method: "POST",
      url: "/api/v1/buyer/messages",
      payload: { message: "buy the first one" },
    });
    expect(res.statusCode).toBe(403);
  });
});
