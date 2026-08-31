import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "./db/client.js";
import {
  finalizeX402ExternalAgentPurchase,
  prepareX402ExternalAgentPurchase,
} from "./modules/gateway/execution-service.js";
import { getTestMerchantId } from "./test-helpers/test-app.js";

describe("x402 internal commerce lifecycle", () => {
  let dbAvailable = false;
  let merchantId: string;

  beforeAll(async () => {
    try {
      merchantId = await getTestMerchantId(prisma);
      dbAvailable = true;
    } catch {
      dbAvailable = false;
    }
  });

  afterAll(async () => prisma.$disconnect());

  it("reserves before settlement and records captured facilitator evidence as a real Payment", async () => {
    if (!dbAvailable) return;
    const variant = await prisma.productVariant.findFirstOrThrow({
      where: { active: true, inventory: { availableQuantity: { gte: 2 } }, product: { merchantId, status: "ACTIVE" } },
      include: { inventory: true },
    });
    const startingQuantity = variant.inventory!.availableQuantity;
    const decisionId = randomUUID();
    const workflowId = `x402-lifecycle-test-${randomUUID()}`;
    await prisma.decisionRecord.create({
      data: {
        id: decisionId,
        merchantId,
        protocol: "X402",
        protocolVersion: "2",
        outcome: "AUTO_APPROVE",
        reasonCode: "TEST_APPROVED",
        explanation: "Synthetic approved x402 decision for lifecycle verification.",
        computedTotalMinor: variant.priceMinor,
        currency: variant.currency,
        permissionType: "VERIFIED_X402",
        decisionLatencyMs: 1,
        workflowId,
      },
    });

    let prepared: Awaited<ReturnType<typeof prepareX402ExternalAgentPurchase>> | null = null;
    try {
      const lines = [{
        productId: variant.productId,
        variantId: variant.id,
        quantity: 1,
        unitPriceMinor: variant.priceMinor,
      }];
      prepared = await prepareX402ExternalAgentPurchase(prisma, {
        merchantId,
        decisionId,
        workflowId,
        currency: variant.currency,
        amountMinor: variant.priceMinor,
        authorizationReference: `x402:${randomUUID()}`,
        lines,
      });

      expect((await prisma.inventory.findUniqueOrThrow({ where: { variantId: variant.id } })).availableQuantity).toBe(
        startingQuantity - 1,
      );
      expect(await prisma.payment.findUniqueOrThrow({ where: { id: prepared.paymentId } })).toMatchObject({
        provider: "X402",
        state: "AUTHORIZED",
      });

      await finalizeX402ExternalAgentPurchase(prisma, {
        merchantId,
        workflowId,
        prepared,
        lines,
        outcome: "CAPTURED",
        transactionId: `0x${randomUUID().replace(/-/g, "")}`,
      });

      expect(await prisma.payment.findUniqueOrThrow({ where: { id: prepared.paymentId } })).toMatchObject({
        provider: "X402",
        state: "CAPTURED",
      });
      expect((await prisma.order.findUniqueOrThrow({ where: { id: prepared.orderId } })).status).toBe("PAID");
      expect((await prisma.checkoutSession.findUniqueOrThrow({ where: { id: prepared.checkoutId } })).status).toBe("COMPLETED");
      expect((await prisma.decisionRecord.findUniqueOrThrow({ where: { id: decisionId } })).settlementStatus).toBe("CAPTURED");
    } finally {
      await prisma.inventory.update({ where: { variantId: variant.id }, data: { availableQuantity: startingQuantity } });
      if (prepared) {
        await prisma.payment.deleteMany({ where: { id: prepared.paymentId } });
        await prisma.checkoutSession.deleteMany({ where: { id: prepared.checkoutId } });
        await prisma.order.deleteMany({ where: { id: prepared.orderId } });
        await prisma.cart.deleteMany({ where: { id: prepared.cartId } });
      }
      await prisma.agentAction.deleteMany({ where: { workflowId } });
      await prisma.decisionRecord.deleteMany({ where: { id: decisionId } });
    }
  });
});
