/**
 * The shopper is not a merchant.
 *
 * WHAT THIS EXISTS TO PREVENT COMING BACK
 *
 * A shopper used to be a `MerchantUser` with role CUSTOMER inside a
 * synthetic merchant, and that merchant's id was reused as the partition
 * key for their spending policy and their buyer-agent conversations. So
 * `BuyerConversation.merchantId` meant the SHOPPER on rows written by
 * `/buyer/messages` and the SELLER on rows written by anything
 * merchant-side — 66 of one and 8 of the other, in the same column, at the
 * time this was written.
 *
 * Nothing failed loudly. The AI Buyer Readiness score counted
 * conversations `where: { merchantId }` meaning the seller, matched the
 * eight rows a test had left behind, and reported a merchant's buyer-agent
 * capability from them while every real conversation was invisible to it.
 * A column that means two things is eventually read as the wrong one, and
 * the reading that goes wrong is silent.
 *
 * These assertions are about the SHAPE of the model, not about a feature.
 * They fail if anyone re-merges the two identities.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildAuthedTestApp, buildCustomerTestApp, getTestBuyerContextId, getTestMerchantId } from "./test-helpers/test-app.js";
import { prisma } from "./db/client.js";

let customerApp: FastifyInstance;
let merchantApp: FastifyInstance;
let merchantId: string;
let buyerContextId: string;

beforeAll(async () => {
  customerApp = await buildCustomerTestApp();
  merchantApp = await buildAuthedTestApp();
  merchantId = await getTestMerchantId(prisma);
  buyerContextId = await getTestBuyerContextId(prisma);
});

afterAll(async () => {
  await customerApp.close();
  await merchantApp.close();
  await prisma.$disconnect();
});

describe("the shopper has their own account", () => {
  it("resolves to a CustomerAccount row, not a Merchant row", async () => {
    const account = await prisma.customerAccount.findUnique({ where: { id: buyerContextId } });
    expect(account, "the demo shopper must have a customer account").not.toBeNull();
    expect(account!.displayName.length).toBeGreaterThan(0);
  });

  it("is never the seller", () => {
    // The single sentence this whole migration exists to make true.
    expect(buyerContextId).not.toBe(merchantId);
  });

  it("links the sign-in row to the account, and only for a shopper", async () => {
    const shopper = await prisma.merchantUser.findFirstOrThrow({ where: { customerAccountId: buyerContextId } });
    expect(shopper.role).toBe("CUSTOMER");

    // Every other role must have none. A merchant user carrying a customer
    // account would be exactly the conflation this replaced.
    const nonShoppersWithAccounts = await prisma.merchantUser.count({
      where: { role: { not: "CUSTOMER" }, customerAccountId: { not: null } },
    });
    expect(nonShoppersWithAccounts).toBe(0);
  });
});

describe("buyer-side rows belong to the shopper", () => {
  it("keys the spending policy by the customer account", async () => {
    const policy = await prisma.buyerSpendingPolicy.findUnique({ where: { customerAccountId: buyerContextId } });
    expect(policy, "the demo shopper must have a spending policy").not.toBeNull();

    // And no policy may exist for anyone who is not a shopper. The seed
    // used to create one keyed by the SELLER — a buyer spending policy
    // belonging to a merchant, which no route could read and no shopper
    // could use.
    const total = await prisma.buyerSpendingPolicy.count();
    const owned = await prisma.buyerSpendingPolicy.count({
      where: { customerAccountId: { in: (await prisma.customerAccount.findMany({ select: { id: true } })).map((a) => a.id) } },
    });
    expect(owned).toBe(total);
  });

  it("keys every conversation by a customer account", async () => {
    const accountIds = (await prisma.customerAccount.findMany({ select: { id: true } })).map((a) => a.id);
    const total = await prisma.buyerConversation.count();
    const owned = await prisma.buyerConversation.count({ where: { customerAccountId: { in: accountIds } } });
    // The foreign key makes this structurally true; asserting it states
    // what the foreign key is FOR, so removing the constraint fails a test
    // rather than silently re-opening the column.
    expect(owned).toBe(total);
  });

  it("files a new conversation under the shopper who had it", async () => {
    const res = await customerApp.inject({
      method: "POST",
      url: "/api/v1/buyer/messages",
      payload: { message: "Looking for trail running shoes under 8000." },
    });
    expect(res.statusCode, res.body).toBe(200);
    const { conversationId } = res.json() as { conversationId: string };

    const row = await prisma.buyerConversation.findUniqueOrThrow({ where: { id: conversationId } });
    expect(row.customerAccountId).toBe(buyerContextId);
    // The account id is deliberately SHARED with the identity-context
    // merchant the shopper was previously filed under, so every historical
    // `protocolActorRef` still resolves to them without a rewrite. What
    // must never be true is that it belongs to a SELLER: an id that both
    // sells and shops is the conflation this replaced.
    expect(await prisma.product.count({ where: { merchantId: row.customerAccountId } })).toBe(0);
    expect(await prisma.order.count({ where: { merchantId: row.customerAccountId } })).toBe(0);
  });
});

describe("the readiness score counts the right conversations", () => {
  it("attributes work to a merchant through the products it recommended", async () => {
    // Neither table has a column meaning "this merchant". The only honest
    // link is which PRODUCTS a recommendation put in front of the shopper.
    const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count FROM "RecommendationRecord" rr
      WHERE EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(rr."recommendedProductIds") AS pid
        JOIN "Product" p ON p."id" = pid AND p."merchantId" = ${merchantId}
      )`;
    const reaching = Number(rows[0]?.count ?? 0);
    expect(reaching, "the demo merchant must have recommendations against its own catalogue").toBeGreaterThan(0);

    // The query the score USED to run, kept deliberately: it is the number
    // the merchant was shown. Asserting the two DIFFER is the whole point —
    // if they ever agree, either the fix was reverted or the fixture stopped
    // exercising a marketplace conversation, and the test would otherwise
    // pass while proving nothing.
    const byOwnerColumn = await prisma.recommendationRecord.count({ where: { merchantId } });
    expect(reaching).toBeGreaterThan(byOwnerColumn);
  });

  it("reports those recommendations in the score the merchant actually sees", async () => {
    const res = await merchantApp.inject({ method: "GET", url: "/api/v1/growth/revenue-opportunities" });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { aiBuyerScore: { components: Array<{ key: string; earned: number; evidence: string }> } };
    const grounded = body.aiBuyerScore.components.find((c) => c.key === "grounded_recommendation");
    const intent = body.aiBuyerScore.components.find((c) => c.key === "intent_extraction");
    expect(grounded, "the score must expose a grounded-recommendation component").toBeDefined();
    expect(intent, "the score must expose an intent-extraction component").toBeDefined();
    // 35 of the 100 points were structurally unreachable: both components
    // scored zero for every merchant no matter how much the buyer agent had
    // actually done for them, because both counted rows filed under the
    // shopper using the seller 's id.
    expect(grounded!.earned, grounded!.evidence).toBeGreaterThan(0);
    expect(intent!.earned, intent!.evidence).toBeGreaterThan(0);
  });

  it("serves the score without error now that its query changed", async () => {
    const res = await merchantApp.inject({ method: "GET", url: "/api/v1/growth/scores" });
    expect([200, 404]).toContain(res.statusCode);
  });
});

describe("a merchant session cannot borrow a shopper's identity", () => {
  it("refuses merchant sessions at the customer surface", async () => {
    // Previously a merchant session reaching here would have been handed
    // its own merchant id as a "buyer context" and partitioned data by it.
    // The accessor now has nothing to hand back.
    for (const url of ["/api/v1/buyer/policy", "/api/v1/buyer/purchase-proposals"]) {
      const res = await merchantApp.inject({ method: "GET", url });
      expect(res.statusCode, `${url} -> ${res.body}`).toBe(403);
    }
  });
});
