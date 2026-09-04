/**
 * PART 18 — a buyer's budget is about what the buyer PAYS.
 *
 * THE BUG THIS GUARDS
 *
 * Discovery ranked and budget-checked candidates on their LIST price, then
 * resolved merchant-authorized offers only for the products that had
 * already won. So a product whose governed discount brought it inside the
 * buyer's stated budget was thrown out one stage earlier as over-budget.
 *
 * Both sides lost: the buyer never saw something they could afford, and
 * the merchant lost the sale their own agent had authorized the discount
 * to win. The offer existed, had passed policy, and was invisible.
 *
 * The fixture below is deliberately self-contained rather than leaning on
 * the seeded catalogue. An earlier test in this project passed on a worn
 * database and failed on a fresh one because it assumed seeded prices; a
 * regression guard that depends on fixture drift guards nothing.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildCustomerTestApp } from "./test-helpers/test-app.js";
import { prisma } from "./db/client.js";

const SLUG = "p18-offer-budget-merchant";
/**
 * Chosen against the real seeded catalogue, not picked round.
 *
 * Thirteen seeded Black/UK9 running shoes are active; the cheapest is
 * ₹3,492. A ₹3,500 budget therefore leaves a two-candidate field, so this
 * asserts the product is REACHABLE rather than racing a top-N cut it could
 * lose for unrelated ranking reasons.
 */
const LIST_MINOR = 360_000; //      ₹3,600 — deliberately OVER the budget below
const BUDGET_MINOR = 350_000; //    ₹3,500 — what the buyer says they can spend
const EFFECTIVE_MINOR = 324_000; // ₹3,240 after 10% — comfortably inside it

let app: FastifyInstance;
let productId: string;
let proposalId: string;

beforeAll(async () => {
  const merchant = await prisma.merchant.upsert({
    where: { slug: SLUG },
    update: { status: "ACTIVE" },
    create: { slug: SLUG, name: "00 P18 Offer Budget Seller", defaultCurrency: "INR", businessCategory: "Footwear", status: "ACTIVE" },
  });

  const product = await prisma.product.upsert({
    where: { merchantId_slug: { merchantId: merchant.id, slug: "p18-discounted-runner" } },
    update: { status: "ACTIVE", promotionEligibility: "ELIGIBLE" },
    create: {
      merchantId: merchant.id,
      slug: "p18-discounted-runner",
      name: "P18 Discounted Runner",
      description: "Fixture for the effective-price budget rule.",
      category: "Running Shoes",
      brand: "P18",
      status: "ACTIVE",
      returnPolicySummary: "Thirty day returns.",
      shippingSummary: "Ships next business day.",
      promotionEligibility: "ELIGIBLE",
    },
  });
  productId = product.id;

  const variant = await prisma.productVariant.upsert({
    where: { productId_sku: { productId: product.id, sku: "p18-runner-uk9-black" } },
    update: { active: true, priceMinor: LIST_MINOR, attributes: { size: "UK9", color: "Black", category: "running shoes" } },
    create: {
      productId: product.id,
      sku: "p18-runner-uk9-black",
      title: "UK9 / Black",
      priceMinor: LIST_MINOR,
      costMinor: 300_000,
      currency: "INR",
      active: true,
      attributes: { size: "UK9", color: "Black", category: "running shoes" },
    },
  });
  await prisma.inventory.upsert({
    where: { variantId: variant.id },
    update: { availableQuantity: 25 },
    create: { variantId: variant.id, availableQuantity: 25 },
  });

  // A merchant-authorized 10% offer: AUTHORIZED means it cleared validation,
  // the policy engine, and any approval the merchant's ceilings required.
  // `offerCalculation` is the figure governance actually signed off on —
  // `findBuyerVisibleOffers` reads the discount from there, never recomputes it.
  await prisma.growthActionProposal.deleteMany({ where: { merchantId: merchant.id } });
  const proposal = await prisma.growthActionProposal.create({
    data: {
      merchantId: merchant.id,
      primaryProductId: product.id,
      actionType: "BOUNDED_OFFER",
      relatedProductIds: [],
      offerKind: "PERCENTAGE",
      offerPercentageBps: 1_000,
      offerCurrency: "INR",
      offerCalculation: { baseAmountMinor: LIST_MINOR, discountMinor: LIST_MINOR - EFFECTIVE_MINOR },
      evidence: [],
      reasonCodes: ["P18_FIXTURE"],
      explanation: "Fixture offer for the effective-price budget rule.",
      mode: "DETERMINISTIC_RELATIONSHIP",
      status: "AUTHORIZED",
      blockedOpportunities: [],
      traceId: "p18-offer-budget-fixture",
      isSyntheticDemo: true,
    },
  });
  proposalId = proposal.id;

  app = await buildCustomerTestApp();
});

/**
 * Removed, not left behind.
 *
 * `buyer-agent.test.ts` leaves its fixtures in place deliberately — they
 * are ₹64,000 laptops named "00 …" that sit out of every other test's way.
 * This one cannot do that: it is a cheap Black/UK9 running shoe, which is
 * the exact shape the buyer-agent and merchant-agent suites shop for. Left
 * behind it won recommendations in two other files and failed them on its
 * own prices (₹3,240 where ₹3,600 was expected) — the same class of
 * fixture bleed that `test-helpers/inventory-restore.ts` exists to stop.
 *
 * Deleted innermost-first: the proposal and inventory reference the
 * product and variant, which reference the merchant.
 */
afterAll(async () => {
  // One delete: Merchant -> Product -> ProductVariant -> Inventory are all
  // `onDelete: Cascade`, and so is GrowthActionProposal -> Merchant.
  //
  // Deleting the levels explicitly was the obvious version and it did not
  // work: `deleteMany({ where: { product: { merchantId } } })` becomes a
  // subquery, and the PGlite dev shim answers those with "unexpected
  // message from server". Letting the database's own cascade rules do it
  // is both simpler and something the shim can actually execute.
  //
  // OrderItem -> ProductVariant is `onDelete: Restrict`, so this would
  // correctly refuse if a test here ever purchased the fixture. These
  // tests only discover; if one ever checks out, delete the order first
  // rather than weakening the constraint.
  await prisma.merchant.deleteMany({ where: { slug: SLUG } });
  await app?.close();
  await prisma.$disconnect();
});

describe("budget eligibility uses the price the buyer would actually pay", () => {
  it("recommends a product whose list price is over budget but whose authorized price is not", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/buyer/messages",
      payload: { message: "Find black running shoes in size 9 under ₹3,500" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.intent.budget.maxMinor).toBe(BUDGET_MINOR);

    const ids = body.recommendations.map((r: { productId: string }) => r.productId);
    expect(
      ids,
      `₹${LIST_MINOR / 100} list, ₹${EFFECTIVE_MINOR / 100} after the merchant's own authorized offer — ` +
        `inside a ₹${BUDGET_MINOR / 100} budget. Before PART 18 discovery compared list price and dropped it.`,
    ).toContain(productId);
  });

  it("stops quoting the offer once the merchant's validity window has passed", async () => {
    // PART 18 — before this, `findBuyerVisibleOffers` had no time bound in
    // reach at all, so an offer authorized months earlier was still quoted
    // as live. Aged by writing the stamp into the past: the same thing the
    // passage of time would do, without waiting for it.
    await prisma.growthActionProposal.update({
      where: { id: proposalId },
      data: { offerValidUntil: new Date(Date.now() - 60_000) },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/buyer/messages",
      payload: { message: "Find black running shoes in size 9 under ₹3,500" },
    });
    expect(res.statusCode).toBe(200);
    const ids = res.json().recommendations.map((r: { productId: string }) => r.productId);
    expect(ids, "an expired offer cannot rescue a ₹3,600 product into a ₹3,500 budget").not.toContain(productId);

    // Restore, so the ordering of tests in this file does not matter.
    await prisma.growthActionProposal.update({
      where: { id: proposalId },
      data: { offerValidUntil: new Date(Date.now() + 86_400_000) },
    });
  });

  it("keeps quoting an offer that predates validity windows entirely", async () => {
    // NULL is not expired. These are commitments a merchant made under
    // rules that had no expiry; the column arriving later must not revoke
    // them. 39 seeded offers are in exactly this state.
    await prisma.growthActionProposal.update({ where: { id: proposalId }, data: { offerValidUntil: null } });

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/buyer/messages",
      payload: { message: "Find black running shoes in size 9 under ₹3,500" },
    });
    const ids = res.json().recommendations.map((r: { productId: string }) => r.productId);
    expect(ids, "an offer with no recorded window still stands").toContain(productId);
  });

  it("still refuses a product that is over budget even after its offer", async () => {
    // The fix changes WHICH number is compared, never the comparison. Same
    // product, a budget below even the discounted price, must not appear.
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/buyer/messages",
      payload: { message: "Find black running shoes in size 9 under ₹3,000" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.intent.budget.maxMinor).toBe(300_000);

    const exact = body.recommendations.filter(
      (r: { productId: string; matchType?: string }) => r.productId === productId && r.matchType !== "NEAR_MATCH",
    );
    expect(exact, "₹3,240 does not fit a ₹3,000 budget at any discount this merchant authorized").toHaveLength(0);
  });
});
