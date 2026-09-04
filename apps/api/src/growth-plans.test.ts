import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { prisma } from "./db/client.js";
import { buildAuthedTestApp, getTestMerchantId } from "./test-helpers/test-app.js";
import { nextAllowedSend } from "./modules/growth-plans/routes.js";

describe("quiet hours (UTC)", () => {
  it.each([
    [21, 9, "2026-09-04T22:15:00Z", "2026-09-05T09:00:00.000Z"],
    [21, 9, "2026-09-04T08:15:00Z", "2026-09-04T09:00:00.000Z"],
    [9, 17, "2026-09-04T10:15:00Z", "2026-09-04T17:00:00.000Z"],
    [21, 9, "2026-09-04T12:15:00Z", "2026-09-04T12:15:00.000Z"],
    [9, 9, "2026-09-04T12:15:00Z", "2026-09-04T12:15:00.000Z"],
  ])("schedules %s–%s at the next permissible time", (start, end, now, expected) => {
    expect(nextAllowedSend(start, end, new Date(now)).toISOString()).toBe(expected);
  });
});

describe("weekly plan safety", () => {
  let app: FastifyInstance;
  let merchantId: string;
  const planIds: string[] = [];
  const jobIds: string[] = [];
  const messageIds: string[] = [];
  const customerIds: string[] = [];

  beforeAll(async () => {
    app = await buildAuthedTestApp();
    merchantId = await getTestMerchantId(prisma);
  });
  afterAll(async () => {
    await prisma.outboundMessage.deleteMany({ where: { planItem: { planId: { in: planIds } } } });
    await prisma.outboundMessage.deleteMany({ where: { id: { in: messageIds } } });
    await prisma.agentJob.deleteMany({ where: { id: { in: jobIds } } });
    await prisma.growthPlan.deleteMany({ where: { id: { in: planIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await app.close();
    await prisma.$disconnect();
  });

  async function fixture(nextAttemptAt = new Date(0)) {
    const plan = await prisma.growthPlan.create({ data: {
      merchantId, weekStart: new Date(Date.now() + planIds.length * 1000), status: "APPROVED", summary: "Safety test",
      items: { create: { opportunityId: randomUUID(), opportunityType: "CATALOGUE_FIX", title: "Test action", proposedAction: "Fix catalogue", subjectIds: [], priority: 1, confidence: 50 } },
    }, include: { items: true } });
    planIds.push(plan.id);
    const job = await prisma.agentJob.create({ data: { merchantId, type: "GROWTH_ACTION", payload: { planId: plan.id, planItemId: plan.items[0]!.id }, idempotencyKey: randomUUID(), nextAttemptAt } });
    jobIds.push(job.id);
    return { plan, job };
  }

  it("never reports an unsupported executor as completed work", async () => {
    const { plan } = await fixture();
    const response = await app.inject({ method: "POST", url: `/api/v1/growth-plans/${plan.id}/run` });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({ completed: 0, plan: { status: "WAITING", items: [{ status: "BLOCKED" }] } });
  });

  it("honours the scheduled retry time", async () => {
    const { plan, job } = await fixture(new Date(Date.now() + 3_600_000));
    const response = await app.inject({ method: "POST", url: `/api/v1/growth-plans/${plan.id}/run` });
    expect(response.statusCode, response.body).toBe(200);
    expect(await prisma.agentJob.findUnique({ where: { id: job.id } })).toMatchObject({ status: "QUEUED", attempts: 0, lockedAt: null });
  });

  it("keeps an approved weekly snapshot unchanged when generated again", async () => {
    const current = new Date();
    current.setUTCHours(0, 0, 0, 0);
    current.setUTCDate(current.getUTCDate() - ((current.getUTCDay() + 6) % 7));
    const existing = await prisma.growthPlan.findUnique({ where: { merchantId_weekStart: { merchantId, weekStart: current } }, include: { items: true } });
    const plan = existing ?? (await fixture()).plan;
    if (!existing) await prisma.growthPlan.update({ where: { id: plan.id }, data: { weekStart: current } });
    const response = await app.inject({ method: "POST", url: "/api/v1/growth-plans/generate" });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({ id: plan.id, status: plan.status, approvedBudgetMinor: plan.approvedBudgetMinor });
    expect(response.json().items.map((item: { id: string }) => item.id).sort()).toEqual(plan.items.map((item) => item.id).sort());
  });

  it("respects the plan contact allowance and queues no duplicate drafts", async () => {
    const { plan, job } = await fixture();
    for (let i = 0; i < 2; i += 1) {
      const customer = await prisma.customer.create({ data: { merchantId, displayName: "Contact limit test", marketingConsent: { BUYER_AGENT: true } } });
      customerIds.push(customer.id);
    }
    await prisma.growthPlan.update({ where: { id: plan.id }, data: { approvedCustomerContacts: 1 } });
    await prisma.growthPlanItem.update({ where: { id: plan.items[0]!.id }, data: { opportunityType: "REPEAT_PURCHASE", subjectIds: customerIds } });
    await prisma.agentJob.update({ where: { id: job.id }, data: { type: "OUTBOUND_COMMUNICATION" } });
    const response = await app.inject({ method: "POST", url: `/api/v1/growth-plans/${plan.id}/run` });
    expect(response.statusCode, response.body).toBe(200);
    expect(await prisma.outboundMessage.count({ where: { planItem: { planId: plan.id } } })).toBe(1);
    expect(response.json()).toMatchObject({ completed: 0, plan: { status: "WAITING" } });
    await app.inject({ method: "POST", url: `/api/v1/growth-plans/${plan.id}/run` });
    expect(await prisma.outboundMessage.count({ where: { planItem: { planId: plan.id } } })).toBe(1);
  });

  it("does not accept merchant assertions as verified delivery or conversion", async () => {
    const message = await prisma.outboundMessage.create({ data: { merchantId, channel: "EMAIL", purpose: "TEST", content: "Test", idempotencyKey: randomUUID() } });
    messageIds.push(message.id);
    for (const status of ["SENT", "DELIVERED", "CONVERTED"]) {
      const response = await app.inject({ method: "POST", url: `/api/v1/outbound-messages/${message.id}/events`, payload: { status, providerReference: "unverified" } });
      expect(response.statusCode, response.body).toBe(403);
    }
    expect(await prisma.outboundMessage.findUnique({ where: { id: message.id } })).toMatchObject({ status: "QUEUED", sentAt: null, deliveredAt: null, convertedAt: null });
  });
});
