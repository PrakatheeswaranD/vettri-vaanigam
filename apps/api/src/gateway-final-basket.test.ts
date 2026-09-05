import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "./db/client.js";
import { getTestMerchantId } from "./test-helpers/test-app.js";
import { enrolAgent } from "./test-helpers/enrol-agent.js";
import { handleAgentPurchaseIntent } from "./modules/gateway/service.js";
import * as providers from "./modules/agents/provider-factory.js";
import { createDemoRuleBasedProvider } from "./modules/agents/providers/demo-rule-based-provider.js";
import { verifyWorkflowLedger } from "./modules/audit/ledger.js";

let merchantId: string;
let original: { sku: string; priceMinor: number };
let addition: { sku: string; priceMinor: number };
let priorPolicy: Awaited<ReturnType<typeof prisma.agentGatewayPolicy.findUnique>>;
const disabledIds: string[] = [];
const createdIds: string[] = [];
beforeAll(async () => { merchantId = await getTestMerchantId(prisma); });
beforeEach(async () => {
  priorPolicy = await prisma.agentGatewayPolicy.findUnique({ where: { merchantId } });
  const makeProduct = async (category: string, priceMinor: number) => {
    const id = `0000-${randomUUID()}`;
    // Use existing catalogue rows with distinct products so the real candidate
    // query sees the same set as a merchant would.
    const product = await prisma.product.findFirstOrThrow({ where: { merchantId, category }, include: { variants: true } });
    disabledIds.push(...product.variants.filter(v => v.active).map(v => v.id));
    await prisma.productVariant.updateMany({ where: { productId: product.id }, data: { active: false } });
    const variant = await prisma.productVariant.create({ data: { productId: product.id, sku: id, title: "Regression fixture",
      priceMinor, costMinor: 100, currency: "INR", active: true } });
    createdIds.push(variant.id);
    return variant;
  };
  original = await makeProduct("Running Shoes", 480000);
  addition = await makeProduct("Hydration", 200000);
  await prisma.agentGatewayPolicy.upsert({ where: { merchantId },
    create: { merchantId }, update: {} });
  await prisma.agentGatewayPolicy.update({ where: { merchantId }, data: {
    unknownAgentCeilingMinor: 10000000, knownAgentCeilingMinor: 10000000,
    blockedCategories: [], maxNegotiationDiscountBps: 1000, negotiatorMinBundleItems: 2,
    negotiatorFloorMarginBps: 1000, velocityMaxIntentsPerHour: 1000,
  } });
  vi.spyOn(providers, "getAIProvider").mockReturnValue({ ...createDemoRuleBasedProvider(),
    proposeAgentUpsell: async () => ({ addSkus: [addition.sku], discountBps: 1000, pitch: "Bundle" }) });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await prisma.productVariant.updateMany({ where: { id: { in: disabledIds.splice(0) } }, data: { active: true } });
  await prisma.productVariant.deleteMany({ where: { id: { in: createdIds.splice(0) } } });
  if (priorPolicy) await prisma.agentGatewayPolicy.update({ where: { merchantId }, data: priorPolicy });
});
afterAll(async () => { await prisma.$disconnect(); });

async function purchase(maxAmountMinor = 10000000, acceptNegotiation = true) {
  const agent = await enrolAgent(prisma, merchantId);
  const execute = vi.fn(async (_args: { amountMinor: number }) => ({ providerOrderId: "test-order", orderId: "test-internal", paymentId: "test-payment" }));
  const result = await handleAgentPurchaseIntent(prisma, { merchantId,
    headers: { "x-agent-id": agent.externalAgentId }, acceptNegotiation,
    body: { buyer: {}, items: [{ id: original.sku, quantity: 1 }], totals: { total: original.priceMinor },
      vettri_vaanigam_mandate: agent.mandate(merchantId, { maxAmountMinor }) } }, undefined, execute);
  return { result, execute };
}

describe("Final basket authorization", () => {
  it("refuses an accepted upsell above the signed amount before execution", async () => {
    const { result, execute } = await purchase(500000);
    expect(result).toMatchObject({ outcome: "DECLINE", reasonCode: "MANDATE_AMOUNT_EXCEEDED" });
    expect(execute).not.toHaveBeenCalled();
  });
  it("steps up when the final bundle crosses the merchant ceiling", async () => {
    await prisma.agentGatewayPolicy.update({ where: { merchantId }, data: { unknownAgentCeilingMinor: 500000, knownAgentCeilingMinor: 500000 } });
    const { result, execute } = await purchase();
    expect(result.outcome).toBe("STEP_UP");
    expect(execute).not.toHaveBeenCalled();
  });
  it("refuses a blocked category introduced only by the upsell", async () => {
    await prisma.agentGatewayPolicy.update({ where: { merchantId }, data: { blockedCategories: ["Hydration"] } });
    const { result, execute } = await purchase();
    expect(result).toMatchObject({ outcome: "DECLINE", reasonCode: "CATEGORY_BLOCKED" });
    expect(execute).not.toHaveBeenCalled();
  });
  it("records and executes the same authorized final total", async () => {
    const { result, execute } = await purchase();
    expect(result).toMatchObject({ outcome: "AUTO_APPROVE", computedTotalMinor: 612000 });
    expect(execute.mock.calls[0]?.[0]).toMatchObject({ amountMinor: 612000 });
    const record = await prisma.decisionRecord.findUniqueOrThrow({ where: { id: result.decisionId } });
    expect(record.computedTotalMinor).toBe(612000);
    expect(await verifyWorkflowLedger(prisma, record.workflowId!)).toMatchObject({ valid: true, eventCount: 1 });
  });
  it("keeps the original basket when the offer is not accepted", async () => {
    const { result } = await purchase(500000, false);
    expect(result).toMatchObject({ outcome: "AUTO_APPROVE", computedTotalMinor: 480000 });
  });
  it("rolls back the decision and prevents execution when its audit write fails", async () => {
    const before = await prisma.decisionRecord.count({ where: { merchantId } });
    const broken = prisma.$extends({ query: { agentAction: { create() { throw new Error("audit unavailable"); } } } });
    const execute = vi.fn();
    await expect(handleAgentPurchaseIntent(broken as unknown as typeof prisma,
      { merchantId, headers: {}, body: {} }, undefined, execute)).rejects.toThrow("audit unavailable");
    expect(await prisma.decisionRecord.count({ where: { merchantId } })).toBe(before);
    expect(execute).not.toHaveBeenCalled();
  });
});
