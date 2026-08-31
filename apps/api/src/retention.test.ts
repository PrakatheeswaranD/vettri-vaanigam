import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "./db/client.js";
import { runRetentionSweep } from "./modules/privacy/retention.js";
import { getTestMerchantId } from "./test-helpers/test-app.js";

describe("privacy retention", () => {
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

  it("removes expired buyer PII and raw payloads without deleting the commercial decision", async () => {
    if (!dbAvailable) return;
    const old = new Date("2020-01-01T00:00:00.000Z");
    const record = await prisma.decisionRecord.create({
      data: {
        merchantId,
        outcome: "DECLINE",
        reasonCode: "RETENTION_TEST",
        explanation: "Synthetic old decision used to verify privacy retention.",
        buyerEmail: "old-buyer@example.test",
        buyerName: "Old Buyer",
        rawProtocolPayload: { buyer: { email: "old-buyer@example.test" }, sku: "SKU-1" },
        decisionLatencyMs: 1,
        createdAt: old,
      },
    });

    try {
      const result = await runRetentionSweep(prisma, new Date("2026-08-29T00:00:00.000Z"));
      expect(result.decisionsRedacted).toBeGreaterThan(0);
      const retained = await prisma.decisionRecord.findUniqueOrThrow({ where: { id: record.id } });
      expect(retained.buyerEmail).toBeNull();
      expect(retained.buyerName).toBeNull();
      expect(retained.rawProtocolPayload).toBeNull();
      expect(retained.reasonCode).toBe("RETENTION_TEST");
    } finally {
      await prisma.decisionRecord.deleteMany({ where: { id: record.id } });
    }
  });
});
