import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildAuthedTestApp, getTestMerchantId } from "./test-helpers/test-app.js";
import { prisma } from "./db/client.js";

let app: FastifyInstance;
beforeAll(async () => { app = await buildAuthedTestApp(); });
afterAll(async () => { await app?.close(); await prisma.$disconnect(); });

describe("governed buyer purchase integration", () => {
  it("creates a cross-merchant order once and returns actual uncaptured payment evidence", async () => {
    const buyerId = await getTestMerchantId(prisma);
    const variant = await prisma.productVariant.findFirstOrThrow({ where: { active: true, product: { merchantId: { not: buyerId }, status: "ACTIVE" }, inventory: { availableQuantity: { gt: 1 } } }, include: { product: true, inventory: true } });
    const previousPolicy = await prisma.buyerSpendingPolicy.findUnique({ where: { merchantId: buyerId } });
    await prisma.buyerSpendingPolicy.upsert({ where: { merchantId: buyerId }, update: { dailyLimitMinor: 100_000_000, autonomousPurchaseLimitMinor: 1, allowedCategories: [variant.product.category], approvalRequiredAboveLimit: true }, create: { merchantId: buyerId, dailyLimitMinor: 100_000_000, autonomousPurchaseLimitMinor: 1, allowedCategories: [variant.product.category], approvalRequiredAboveLimit: true } });
    try {
      const proposalResponse = await app.inject({ method: "POST", url: "/api/v1/buyer/purchase-proposals", payload: { variantId: variant.id, quantity: 1 } });
      expect(proposalResponse.statusCode, proposalResponse.body).toBe(200);
      const proposal = proposalResponse.json();
      expect(proposal.outcome).toBe("STEP_UP");
      expect(proposal.amountMinor).toBe(variant.priceMinor);
      const url = `/api/v1/buyer/purchase-proposals/${proposal.id}/authorize`;
      const response = await app.inject({ method: "POST", url });
      expect(response.statusCode, response.body).toBe(200);
      const payment = response.json();
      expect(payment.state).not.toBe("CAPTURED");
      expect(payment.merchantId).toBe(variant.product.merchantId);
      const replay = await app.inject({ method: "POST", url });
      expect(replay.statusCode, replay.body).toBe(200);
      expect(replay.json().id).toBe(payment.id);
      const inventory = await prisma.inventory.findUniqueOrThrow({ where: { variantId: variant.id } });
      expect(inventory.availableQuantity).toBe(variant.inventory!.availableQuantity - 1);
      const evidence = await app.inject({ method: "GET", url: `/api/v1/buyer/purchase-proposals/${proposal.id}/payment` });
      expect(evidence.statusCode).toBe(200);
      expect(evidence.json().id).toBe(payment.id);
    } finally {
      if (previousPolicy) await prisma.buyerSpendingPolicy.update({ where: { merchantId: buyerId }, data: { dailyLimitMinor: previousPolicy.dailyLimitMinor, autonomousPurchaseLimitMinor: previousPolicy.autonomousPurchaseLimitMinor, allowedCategories: previousPolicy.allowedCategories!, approvalRequiredAboveLimit: previousPolicy.approvalRequiredAboveLimit } });
    }
  });
});
