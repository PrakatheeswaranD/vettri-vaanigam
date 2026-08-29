/**
 * Multi-tenant identity & RBAC acceptance tests (PART 10 §1).
 *
 * Proves the item's Definition of Done against the REAL auth middleware
 * and routes — never a parallel test-only auth path: cross-tenant data
 * isolation is structural (a route never has another merchant's id to
 * query with), every request without a valid session is rejected, and
 * RBAC gates an approval decision by role, not just by tenant.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { buildAuthedTestApp, getTestMerchantId } from "./test-helpers/test-app.js";
import { prisma } from "./db/client.js";
import { hashPassword } from "./modules/auth/password.js";
import { proposeGrowthAction } from "./modules/merchant-agent/service.js";
import { createFixtureProvider } from "./modules/agents/providers/fixture-provider.js";

let app: FastifyInstance;
let otherMerchantProductId: string;
let otherMerchantToken: string;
let viewerToken: string;

const OTHER_MERCHANT_OWNER_EMAIL = "owner@otherstore.test";
const OTHER_MERCHANT_OWNER_PASSWORD = "OtherStorePw!2026";
const VIEWER_EMAIL = "viewer@meridianathletics.demo";
const VIEWER_PASSWORD = "MeridianViewerPw!2026";

async function proposePendingApprovalDiscount() {
  const merchantId = await getTestMerchantId(prisma);
  const pulseRunner = await prisma.product.findFirstOrThrow({ where: { merchantId, name: "Meridian Pulse Runner" } });
  const provider = createFixtureProvider(
    {
      proposeGrowthAction: async ({ candidates }) => ({
        actionType: "CROSS_SELL",
        primaryProductId: pulseRunner.id,
        relatedProductIds: [candidates.find((c) => c.relationship === "COMPLEMENTARY" && c.readinessState !== "NOT_READY")!.productId],
        offer: { kind: "PERCENTAGE", percentageBps: 500, amountMinor: null },
        reasonCodes: ["COMPLEMENTARY_PRODUCT"],
      }),
    },
    "LIVE_ANTHROPIC",
  );
  const proposal = await proposeGrowthAction(prisma, { merchantId, primaryProductId: pulseRunner.id }, provider);
  await app.inject({ method: "POST", url: "/api/v1/policy/evaluate", payload: { proposalId: proposal.id } });
  return proposal;
}

/** `MerchantUser.email` is `@unique`, so leftovers from a previous run of
 * this file would collide on re-run. Clearing them up front keeps the
 * suite idempotent against a persistent dev database. */
async function clearPreviousTestFixtures() {
  const staleUsers = await prisma.merchantUser.findMany({
    where: { email: { in: [OTHER_MERCHANT_OWNER_EMAIL, VIEWER_EMAIL] } },
    select: { id: true, merchantId: true, email: true },
  });
  if (staleUsers.length === 0) return;

  await prisma.session.deleteMany({ where: { merchantUserId: { in: staleUsers.map((u) => u.id) } } });
  await prisma.merchantUser.deleteMany({ where: { id: { in: staleUsers.map((u) => u.id) } } });

  // Only the throwaway second tenant is removed wholesale — never the
  // seeded demo merchant, which the VIEWER account belongs to.
  const otherMerchantIds = staleUsers.filter((u) => u.email === OTHER_MERCHANT_OWNER_EMAIL).map((u) => u.merchantId);
  if (otherMerchantIds.length > 0) {
    await prisma.merchant.deleteMany({ where: { id: { in: otherMerchantIds } } });
  }
}

beforeAll(async () => {
  app = await buildAuthedTestApp();
  await clearPreviousTestFixtures();

  // A second, fully independent merchant tenant — never touched by the
  // shared seed script — to prove cross-tenant isolation is structural,
  // not merely a convention the seeded demo data happens to respect.
  const otherMerchant = await prisma.merchant.create({
    data: { name: "Other Store", slug: `other-store-${randomUUID()}`, businessCategory: "General" },
  });
  await prisma.merchantUser.create({
    data: {
      merchantId: otherMerchant.id,
      email: OTHER_MERCHANT_OWNER_EMAIL,
      passwordHash: await hashPassword(OTHER_MERCHANT_OWNER_PASSWORD),
      role: "OWNER",
    },
  });
  const otherProduct = await prisma.product.create({
    data: {
      merchantId: otherMerchant.id,
      name: "Isolated Test Widget",
      slug: "isolated-test-widget",
      description: "Exists only to prove cross-tenant isolation.",
      category: "Test",
      brand: "Other Store",
      variants: { create: [{ sku: "OTW-1", title: "Default", priceMinor: 1999 }] },
    },
  });
  otherMerchantProductId = otherProduct.id;

  const otherLoginRes = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { email: OTHER_MERCHANT_OWNER_EMAIL, password: OTHER_MERCHANT_OWNER_PASSWORD },
  });
  otherMerchantToken = (otherLoginRes.json() as { token: string }).token;

  // A VIEWER on the demo merchant, to prove RBAC blocks approval decisions
  // by role — not just by tenant.
  const merchantId = await getTestMerchantId(prisma);
  await prisma.merchantUser.create({
    data: { merchantId, email: VIEWER_EMAIL, passwordHash: await hashPassword(VIEWER_PASSWORD), role: "VIEWER" },
  });
  const viewerLoginRes = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { email: VIEWER_EMAIL, password: VIEWER_PASSWORD },
  });
  viewerToken = (viewerLoginRes.json() as { token: string }).token;
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("Global authentication gate (PART 10 §1)", () => {
  it("rejects a request with no session token", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/merchant", headers: { authorization: "" } });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
  });

  it("rejects a request with a malformed or unknown session token", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/merchant",
      headers: { authorization: "Bearer not-a-real-token" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("still allows the unauthenticated allowlist (login, health) through", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/health", headers: { authorization: "" } });
    expect(res.statusCode).toBe(200);
  });
});

describe("Cross-tenant data isolation (PART 10 §1)", () => {
  it("a merchant cannot read a product belonging to a different merchant", async () => {
    const res = await app.inject({ method: "GET", url: `/api/v1/catalog/products/${otherMerchantProductId}` });
    expect(res.statusCode).toBe(404);
  });

  it("symmetrically, the other merchant cannot read the demo merchant's product", async () => {
    const merchantId = await getTestMerchantId(prisma);
    const pulseRunner = await prisma.product.findFirstOrThrow({ where: { merchantId, name: "Meridian Pulse Runner" } });
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/catalog/products/${pulseRunner.id}`,
      headers: { authorization: `Bearer ${otherMerchantToken}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("each merchant can still read its own product (sanity)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/catalog/products/${otherMerchantProductId}`,
      headers: { authorization: `Bearer ${otherMerchantToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(otherMerchantProductId);
  });

  it("a merchant's proposal/approval endpoints never leak into a different merchant's session", async () => {
    const proposal = await proposePendingApprovalDiscount();
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/approvals/${proposal.id}/approve`,
      payload: {},
      headers: { authorization: `Bearer ${otherMerchantToken}` },
    });
    expect(res.statusCode).not.toBe(200);
  });
});

describe("Role-based access control on approval decisions (PART 10 §1)", () => {
  it("blocks a VIEWER from approving a pending proposal", async () => {
    const proposal = await proposePendingApprovalDiscount();
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/approvals/${proposal.id}/approve`,
      payload: {},
      headers: { authorization: `Bearer ${viewerToken}` },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");

    const row = await prisma.growthActionProposal.findUniqueOrThrow({ where: { id: proposal.id } });
    expect(row.status).toBe("PENDING_APPROVAL"); // unchanged — the block was real, not cosmetic
  });

  it("blocks a VIEWER from rejecting a pending proposal", async () => {
    const proposal = await proposePendingApprovalDiscount();
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/approvals/${proposal.id}/reject`,
      payload: { reason: "test" },
      headers: { authorization: `Bearer ${viewerToken}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("still allows OWNER/APPROVER to decide, and records their real user id", async () => {
    const proposal = await proposePendingApprovalDiscount();
    const res = await app.inject({ method: "POST", url: `/api/v1/approvals/${proposal.id}/approve`, payload: {} });
    expect(res.statusCode).toBe(200);
    expect(res.json().approval.approverId).toBeTruthy();
  });
});
