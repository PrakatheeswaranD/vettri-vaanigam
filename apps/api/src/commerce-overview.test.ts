/**
 * `/merchant/commerce-overview` — the figures a merchant reads as "how the
 * business is doing".
 *
 * These assertions exist because the previous implementation was wrong in
 * a way no test could catch: it derived headline figures from a page of
 * the 100 most recent orders, in any status. It never threw, never logged,
 * and produced numbers that looked entirely reasonable — an average order
 * value dragged down by cancelled baskets, and an order count that
 * silently saturated at 100.
 *
 * So each test here pins a property that a page-derived or
 * status-blind implementation cannot satisfy.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildAuthedTestApp, getTestMerchantId } from "./test-helpers/test-app.js";
import { prisma } from "./db/client.js";
import { RECENT_ORDER_LIMIT } from "./modules/merchant/commerce-overview-service.js";
import type { MerchantCommerceOverviewDTO } from "@razorgrowth/contracts";

let app: FastifyInstance;
let merchantId: string;

beforeAll(async () => {
  app = await buildAuthedTestApp();
  merchantId = await getTestMerchantId(prisma);
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

async function overview(): Promise<MerchantCommerceOverviewDTO> {
  const res = await app.inject({ method: "GET", url: "/api/v1/merchant/commerce-overview" });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as MerchantCommerceOverviewDTO;
}

describe("GET /merchant/commerce-overview", () => {
  it("counts every order, not just the page it returns", async () => {
    const body = await overview();
    const trueCount = await prisma.order.count({ where: { merchantId } });

    expect(body.analytics.orderCount).toBe(trueCount);
    // The specific failure mode: a count that equals the page size is the
    // signature of `orders.length` standing in for a real count.
    if (trueCount > RECENT_ORDER_LIMIT) {
      expect(body.analytics.orderCount).toBeGreaterThan(RECENT_ORDER_LIMIT);
      expect(body.recentOrders.length).toBe(RECENT_ORDER_LIMIT);
    }
  });

  it("averages PAID orders only, over all history", async () => {
    const body = await overview();
    const paid = await prisma.order.findMany({
      where: { merchantId, status: "PAID" },
      select: { totalAmountMinor: true },
    });

    expect(body.analytics.paidOrderCount).toBe(paid.length);
    const expectedAverage = paid.length
      ? Math.round(paid.reduce((sum, order) => sum + order.totalAmountMinor, 0) / paid.length)
      : 0;
    expect(body.analytics.averageOrderValueMinor).toBe(expectedAverage);
  });

  it("never counts an unpaid order as customer value", async () => {
    const body = await overview();

    for (const customer of body.customers) {
      const paidTotal = await prisma.order.aggregate({
        where: { customerId: customer.id, status: "PAID" },
        _sum: { totalAmountMinor: true },
        _count: true,
      });
      expect(customer.lifetimeValueMinor).toBe(paidTotal._sum.totalAmountMinor ?? 0);
      expect(customer.paidOrderCount).toBe(paidTotal._count);
      // A customer cannot have paid for more orders than they placed.
      expect(customer.paidOrderCount).toBeLessThanOrEqual(customer.orderCount);
    }
  });

  it("agrees with the Revenue Opportunity Engine on captured revenue", async () => {
    // The two screens disagreed by construction before this: one summed
    // every order, the other only captured payments. A merchant reading
    // both saw two different businesses.
    const body = await overview();
    const engine = await app.inject({ method: "GET", url: "/api/v1/growth/revenue-opportunities" });
    expect(engine.statusCode).toBe(200);
    const observed = (engine.json() as { observed: { capturedRevenueMinor: number; averageOrderValueMinor: number } }).observed;

    expect(body.analytics.receivedRevenueMinor).toBe(observed.capturedRevenueMinor);
    expect(body.analytics.averageOrderValueMinor).toBe(observed.averageOrderValueMinor);
  });

  it("states the currency rather than assuming rupees", async () => {
    const body = await overview();
    const merchant = await prisma.merchant.findUniqueOrThrow({ where: { id: merchantId } });
    expect(body.analytics.currency).toBe(merchant.defaultCurrency);
  });
});
