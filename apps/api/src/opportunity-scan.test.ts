/**
 * The `catalog.published` trigger.
 *
 * The point of this test is that the opportunity feed stops being fifteen
 * fixed seed rows and starts describing the merchant's actual catalogue —
 * and that a rescan never destroys history it did not write.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "./db/client.js";
import { runOpportunityScan } from "./modules/growth/opportunity-scan-service.js";
import { getTestMerchantId } from "./test-helpers/test-app.js";

let merchantId: string;

beforeAll(async () => {
  merchantId = await getTestMerchantId(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("catalogue opportunity scan", () => {
  it("writes real, agent-generated opportunities from the live catalogue", async () => {
    const result = await runOpportunityScan(prisma, merchantId);

    expect(result.productsScanned).toBeGreaterThan(0);

    const real = await prisma.growthOpportunity.findMany({ where: { merchantId, isSyntheticDemo: false } });
    expect(real.length).toBe(result.opportunitiesFound);

    // Every row must be checkable prose, never a bare code.
    for (const row of real) {
      expect(row.signal.length).toBeGreaterThan(10);
      expect(row.recommendation.length).toBeGreaterThan(10);
    }
  });

  /** An invented rupee figure is what made the seeded feed misleading. */
  it("never attaches a fabricated value to a scanned opportunity", async () => {
    await runOpportunityScan(prisma, merchantId);
    const real = await prisma.growthOpportunity.findMany({ where: { merchantId, isSyntheticDemo: false } });
    for (const row of real) {
      expect(row.estimatedValueMinor).toBeNull();
      expect(row.valueClassification).toBe("OPPORTUNITY");
    }
  });

  it("is idempotent — rescanning replaces its own rows rather than duplicating them", async () => {
    const first = await runOpportunityScan(prisma, merchantId);
    const afterFirst = await prisma.growthOpportunity.count({ where: { merchantId, isSyntheticDemo: false } });

    await runOpportunityScan(prisma, merchantId);
    const afterSecond = await prisma.growthOpportunity.count({ where: { merchantId, isSyntheticDemo: false } });

    expect(afterFirst).toBe(first.opportunitiesFound);
    expect(afterSecond).toBe(afterFirst);
  });

  /** A rescan must never erase demo content or a merchant's own history. */
  it("leaves seeded rows and acted-on opportunities untouched", async () => {
    const seededBefore = await prisma.growthOpportunity.count({ where: { merchantId, isSyntheticDemo: true } });

    const acted = await prisma.growthOpportunity.create({
      data: {
        merchantId,
        category: "CROSS_SELL",
        signal: "An opportunity the merchant already acted on.",
        recommendation: "This row must survive a rescan.",
        isSyntheticDemo: false,
        status: "ACTED_ON",
      },
    });

    await runOpportunityScan(prisma, merchantId);

    const seededAfter = await prisma.growthOpportunity.count({ where: { merchantId, isSyntheticDemo: true } });
    const survivor = await prisma.growthOpportunity.findUnique({ where: { id: acted.id } });

    expect(seededAfter).toBe(seededBefore);
    expect(survivor).not.toBeNull();

    await prisma.growthOpportunity.delete({ where: { id: acted.id } }).catch(() => undefined);
  });

  it("records the scan in the ledger, attributed to the Merchant Agent", async () => {
    await runOpportunityScan(prisma, merchantId);
    const entry = await prisma.agentAction.findFirst({
      where: { merchantId, actionType: "GROWTH_OPPORTUNITY_SCAN" },
      orderBy: { createdAt: "desc" },
    });
    expect(entry).not.toBeNull();
    expect(entry!.actorType).toBe("MERCHANT_AGENT");
    expect(entry!.conciseReason).toMatch(/Scanned \d+ products/);
  });
});
