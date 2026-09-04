/**
 * Seller-side commerce overview.
 *
 * WHAT WAS WRONG WITH THE VERSION THIS REPLACED
 *
 * It was a single inline route handler that fetched the 100 most recent
 * orders and then derived the business's headline figures from that page:
 *
 *   - `averageOrderValueMinor` averaged EVERY order status, so a cancelled
 *     basket and a failed payment both dragged the mean of what customers
 *     actually pay.
 *   - the same average was computed over 100 rows, so it reported the AOV
 *     of a recent window while being labelled the AOV of the business.
 *   - `orderCount` returned `orders.length`, which cannot exceed 100 no
 *     matter how many orders exist. A merchant with 4,000 orders was told
 *     they had 100.
 *   - `lifetimeValueMinor` summed each customer's orders in any status, so
 *     a customer who abandoned three expensive baskets outranked one who
 *     paid for two.
 *
 * None of these fail loudly. They produce plausible numbers that quietly
 * disagreed with the Revenue Opportunity Engine, which computes from PAID
 * orders — leaving two screens in the same console stating different
 * revenue for the same merchant.
 *
 * THE RULE HERE
 *
 * Money means PAID. Every amount and every average is derived from orders
 * in status `PAID` and from provider-confirmed captured payments. Counts
 * are whole-history aggregates computed by the database, never the length
 * of a page. The recent-orders list is still a bounded window, and now
 * says so in the payload rather than pretending to be the whole history.
 */
import type { PrismaClient } from "@prisma/client";
import type { MerchantCommerceOverviewDTO } from "@razorgrowth/contracts";
import { AGENT_ORIGINATED_SOURCES, EXTERNAL_AGENT_SOURCES } from "../commerce/operations-service.js";

/** The order feed is a screenful, not a report. Named so the response can
 * tell the console what it is looking at. */
export const RECENT_ORDER_LIMIT = 100;

export async function getMerchantCommerceOverview(
  prisma: PrismaClient,
  merchantId: string,
): Promise<MerchantCommerceOverviewDTO> {
  const [merchant, recentOrders, customers, captured, orderCount, paidBySource, paidAggregate] = await Promise.all([
    prisma.merchant.findUniqueOrThrow({ where: { id: merchantId }, select: { defaultCurrency: true } }),

    prisma.order.findMany({
      where: { merchantId },
      orderBy: { createdAt: "desc" },
      take: RECENT_ORDER_LIMIT,
      include: {
        customer: { select: { id: true, displayName: true, email: true, segment: true } },
        items: { select: { productNameSnapshot: true, variantTitleSnapshot: true, quantity: true, lineTotalMinor: true } },
        payments: { orderBy: { createdAt: "desc" }, take: 1, select: { state: true } },
      },
    }),

    prisma.customer.findMany({
      where: { merchantId },
      orderBy: { updatedAt: "desc" },
      include: { orders: { select: { totalAmountMinor: true, status: true, createdAt: true } } },
    }),

    prisma.payment.aggregate({
      where: { order: { merchantId }, state: "CAPTURED" },
      _sum: { amountMinor: true },
      _count: true,
    }),

    prisma.order.count({ where: { merchantId } }),

    // PART 18 — attribution, grouped in the database rather than derived
    // from the capped `recentOrders` page above. A share computed from the
    // most recent hundred orders is not the merchant's share, and would
    // drift every time an order was placed.
    prisma.order.groupBy({
      by: ["source"],
      where: { merchantId, status: "PAID" },
      _count: true,
      _sum: { totalAmountMinor: true },
    }),

    // The average the database computes over every PAID order — not the
    // average of the page above.
    prisma.order.aggregate({
      where: { merchantId, status: "PAID" },
      _avg: { totalAmountMinor: true },
      _count: true,
    }),
  ]);

  /**
   * `Order.source` is a free String, not an enum, and the data proves why
   * that matters: both "direct" and "DIRECT_BUYER" exist in the seeded
   * catalogue. Classification is therefore an explicit allowlist shared
   * with `operations-service.ts` — never a substring guess at "AI" or
   * "AGENT", which would misfile the first source anyone named awkwardly.
   *
   * Anything unrecognised counts as human. A new agent source added later
   * would be under-reported until it is listed, and under-reporting the
   * agent is the safe direction for a figure whose whole purpose is to
   * claim credit for the agent.
   */
  const attribution = {
    ownAgentPaidOrderCount: 0,
    ownAgentPaidRevenueMinor: 0,
    externalAgentPaidOrderCount: 0,
    externalAgentPaidRevenueMinor: 0,
    humanPaidOrderCount: 0,
    humanPaidRevenueMinor: 0,
  };
  for (const row of paidBySource) {
    const count = row._count;
    const revenue = row._sum.totalAmountMinor ?? 0;
    const source = row.source ?? "";
    if (AGENT_ORIGINATED_SOURCES.has(source)) {
      attribution.ownAgentPaidOrderCount += count;
      attribution.ownAgentPaidRevenueMinor += revenue;
    } else if (EXTERNAL_AGENT_SOURCES.has(source)) {
      attribution.externalAgentPaidOrderCount += count;
      attribution.externalAgentPaidRevenueMinor += revenue;
    } else {
      attribution.humanPaidOrderCount += count;
      attribution.humanPaidRevenueMinor += revenue;
    }
  }

  return {
    agentAttribution: attribution,
    analytics: {
      receivedRevenueMinor: captured._sum.amountMinor ?? 0,
      capturedPaymentCount: captured._count,
      orderCount,
      paidOrderCount: paidAggregate._count,
      customerCount: customers.length,
      // `_avg` is null when nothing matched. Zero is the honest answer for
      // "the average paid order of a merchant with no paid orders"; the
      // count sits beside it so a reader can tell zero-because-none from
      // zero-because-free.
      averageOrderValueMinor: Math.round(paidAggregate._avg.totalAmountMinor ?? 0),
      currency: merchant.defaultCurrency,
    },

    recentOrders: recentOrders.map((order) => ({
      id: order.id,
      status: order.status,
      totalAmountMinor: order.totalAmountMinor,
      currency: order.currency,
      source: order.source,
      createdAt: order.createdAt.toISOString(),
      customer: order.customer,
      paymentState: order.payments[0]?.state ?? null,
      items: order.items,
    })),
    recentOrderLimit: RECENT_ORDER_LIMIT,

    customers: customers.map((customer) => {
      const paidOrders = customer.orders.filter((order) => order.status === "PAID");
      return {
        id: customer.id,
        displayName: customer.displayName,
        email: customer.email,
        segment: customer.segment,
        orderCount: customer.orders.length,
        paidOrderCount: paidOrders.length,
        lifetimeValueMinor: paidOrders.reduce((sum, order) => sum + order.totalAmountMinor, 0),
        lastPaidOrderAt: paidOrders.reduce<string | null>((latest, order) => {
          const value = order.createdAt.toISOString();
          return !latest || value > latest ? value : latest;
        }, null),
      };
    }),
  };
}
