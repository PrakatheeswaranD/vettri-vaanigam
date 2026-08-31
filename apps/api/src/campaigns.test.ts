import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "./db/client.js";
import { buildAuthedTestApp, getTestMerchantId } from "./test-helpers/test-app.js";

let app: FastifyInstance;
let merchantId: string;
const createdPaymentIds: string[] = [];
const createdOrderIds: string[] = [];
const createdCampaignIds: string[] = [];

async function capturedPayment(totalAmountMinor: number, state: "CAPTURED" | "CREATED" = "CAPTURED") {
  const order = await prisma.order.create({
    data: {
      merchantId,
      status: state === "CAPTURED" ? "PAID" : "PENDING",
      totalAmountMinor,
      currency: "INR",
      source: "CAMPAIGN_TEST",
    },
  });
  const payment = await prisma.payment.create({
    data: {
      merchantId,
      orderId: order.id,
      provider: "DEMO",
      amountMinor: totalAmountMinor,
      currency: "INR",
      state,
      capturedAt: state === "CAPTURED" ? new Date() : null,
    },
  });
  createdOrderIds.push(order.id);
  createdPaymentIds.push(payment.id);
  return payment;
}

async function createActiveCampaign(overrides: Record<string, unknown> = {}) {
  const created = await app.inject({
    method: "POST",
    url: "/api/v1/campaigns",
    payload: {
      name: `Campaign evidence ${randomUUID()}`,
      actionType: "BOUNDED_OFFER",
      budgetMinor: 100,
      incentiveMinorPerConversion: 60,
      maxUsesPerSubject: 2,
      controlPercentBps: 0,
      startsAt: new Date(Date.now() - 60_000).toISOString(),
      endsAt: new Date(Date.now() + 3_600_000).toISOString(),
      ...overrides,
    },
  });
  expect(created.statusCode).toBe(201);
  createdCampaignIds.push(created.json().id);
  const activated = await app.inject({
    method: "POST",
    url: `/api/v1/campaigns/${created.json().id}/status`,
    payload: { status: "ACTIVE" },
  });
  expect(activated.statusCode).toBe(200);
  return created.json();
}

async function bindOrder(campaignId: string, assignmentId: string, orderId: string) {
  const response = await app.inject({
    method: "POST",
    url: `/api/v1/campaigns/${campaignId}/attributions`,
    payload: { assignmentId, orderId },
  });
  expect(response.statusCode).toBe(201);
}

async function capture(payment: { id: string; orderId: string }) {
  await prisma.$transaction([
    prisma.payment.update({ where: { id: payment.id }, data: { state: "CAPTURED", capturedAt: new Date() } }),
    prisma.order.update({ where: { id: payment.orderId }, data: { status: "PAID" } }),
  ]);
}

beforeAll(async () => {
  app = await buildAuthedTestApp();
  merchantId = await getTestMerchantId(prisma);
});

afterAll(async () => {
  if (createdCampaignIds.length > 0) {
    await prisma.campaign.deleteMany({ where: { id: { in: createdCampaignIds } } });
  }
  if (createdPaymentIds.length > 0) {
    await prisma.payment.deleteMany({ where: { id: { in: createdPaymentIds } } });
  }
  if (createdOrderIds.length > 0) {
    await prisma.order.deleteMany({ where: { id: { in: createdOrderIds } } });
  }
  await app.close();
  await prisma.$disconnect();
});

describe("Campaign orchestration", () => {
  it("keeps deterministic control subjects ineligible", async () => {
    const campaign = await createActiveCampaign({ controlPercentBps: 9000 });
    let control: Record<string, unknown> | null = null;
    for (let index = 0; index < 50 && !control; index += 1) {
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/campaigns/${campaign.id}/assign`,
        payload: { subjectKey: `control-candidate-${index}@example.test` },
      });
      if (response.json().cohort === "CONTROL") control = response.json();
    }
    expect(control).toMatchObject({ eligible: false, cohort: "CONTROL", reason: "CONTROL_GROUP_NO_OFFER" });
  });

  it("attributes revenue only from captured payments, once, under atomic budget and frequency bounds", async () => {
    const campaign = await createActiveCampaign();
    const assignmentResponse = await app.inject({
      method: "POST",
      url: `/api/v1/campaigns/${campaign.id}/assign`,
      payload: { subjectKey: "measured-buyer@example.test" },
    });
    expect(assignmentResponse.json()).toMatchObject({ eligible: true, cohort: "TREATMENT" });
    const assignmentId = assignmentResponse.json().assignmentId as string;

    const pending = await capturedPayment(99900, "CREATED");
    await bindOrder(campaign.id, assignmentId, pending.orderId);
    const pendingResult = await app.inject({
      method: "POST",
      url: `/api/v1/campaigns/${campaign.id}/conversions`,
      payload: { assignmentId, paymentId: pending.id },
    });
    expect(pendingResult.statusCode).toBe(409);

    const firstPayment = await capturedPayment(150000, "CREATED");
    await bindOrder(campaign.id, assignmentId, firstPayment.orderId);
    await capture(firstPayment);
    const first = await app.inject({
      method: "POST",
      url: `/api/v1/campaigns/${campaign.id}/conversions`,
      payload: { assignmentId, paymentId: firstPayment.id },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ incentiveCostMinor: 60, observedRevenueMinor: 150000 });

    const duplicate = await app.inject({
      method: "POST",
      url: `/api/v1/campaigns/${campaign.id}/conversions`,
      payload: { assignmentId, paymentId: firstPayment.id },
    });
    expect(duplicate.statusCode).toBe(409);

    const secondPayment = await capturedPayment(200000, "CREATED");
    await bindOrder(campaign.id, assignmentId, secondPayment.orderId);
    await capture(secondPayment);
    const overBudget = await app.inject({
      method: "POST",
      url: `/api/v1/campaigns/${campaign.id}/conversions`,
      payload: { assignmentId, paymentId: secondPayment.id },
    });
    expect(overBudget.statusCode).toBe(403);

    const metrics = await app.inject({ method: "GET", url: `/api/v1/campaigns/${campaign.id}/metrics` });
    expect(metrics.statusCode).toBe(200);
    expect(metrics.json().campaign.spentMinor).toBe(60);
    expect(metrics.json().treatment).toMatchObject({ conversions: 1, observedRevenueMinor: 150000 });
  });
});
