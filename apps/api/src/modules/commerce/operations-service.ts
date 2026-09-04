/**
 * 🛍 Commerce — the merchant's operational data layer, and the agent's.
 *
 * WHAT THIS ANSWERS, AND WHAT IT REFUSES TO ANSWER
 *
 * Commerce answers *what is true right now*: this product's stock and
 * sales, this customer's behaviour, this order's state, this payment's
 * state. Growth answers *what should I do about it*. Two questions, one
 * answer each.
 *
 * So every view here carries an `opportunities` array that is NOT computed
 * in this file. It is `getRevenueOpportunityReport`'s own output, indexed
 * by `subjectIds` and attached to the rows it names. This module never
 * detects an opportunity, never scores one, and never estimates a value.
 *
 * That is the whole anti-duplication rule, stated once: a figure that
 * would otherwise be derived twice is derived ONCE and referenced from the
 * other place. This console has already shipped two screens stating
 * different revenue for the same merchant (see
 * `commerce-overview-service.ts`), and the cause both times was a second
 * derivation that looked harmless.
 *
 * WHAT "PAID" MEANS HERE
 *
 * The same thing it means everywhere else in this codebase: an order in
 * status PAID, and provider-confirmed captured payments. Performance
 * figures count no abandoned basket and no failed payment. Counts are
 * whole-history and computed by the database, never the length of a
 * returned page — every response says what window it is.
 */
import type { PrismaClient, Prisma } from "@prisma/client";
import type {
  AttachedOpportunityDTO,
  CommerceCustomersResponseDTO,
  CommerceOrdersResponseDTO,
  CommercePaymentsResponseDTO,
  CommerceProductsResponseDTO,
} from "@razorgrowth/contracts";
import { getRevenueOpportunityReport } from "../growth/revenue-evidence-service.js";
import { analyzeCatalog } from "../catalog/quality-analyzer.js";
import { toolForOpportunityType } from "../merchant-agent/tools.js";

/** A screenful, not a report. Named so a response can say what it is. */
export const COMMERCE_PAGE_LIMIT = 100;

/**
 * Order sources the AGENT originates, as opposed to sources a human or an
 * external protocol originates.
 *
 * `AGENT_GATEWAY` is deliberately NOT here. An order that arrived through
 * the agent gateway was placed by somebody else's buyer agent against this
 * merchant's catalogue — real agentic commerce, and not something this
 * merchant's own Merchant Agent did. Counting it as the merchant agent's
 * work would be the console taking credit for a third party's traffic.
 */
export const AGENT_ORIGINATED_SOURCES = new Set([
  "AI_CROSS_SELL",
  "AI_UPSELL",
  "AI_BUNDLE",
  "AI_BOUNDED_OFFER",
  "AI_RECOVERY",
]);

/**
 * Orders placed by SOMEBODY ELSE'S buyer agent against this catalogue.
 *
 * Real agentic commerce and worth surfacing — but separately from the
 * merchant's own agent, for the reason stated above: a console must not
 * report a third party's traffic as its own agent's work.
 */
export const EXTERNAL_AGENT_SOURCES = new Set(["AGENT_GATEWAY"]);

const SOURCE_LABEL: Record<string, string> = {
  DIRECT_BUYER: "Direct sale",
  AI_CROSS_SELL: "Agent cross-sell",
  AI_UPSELL: "Agent upsell",
  AI_BUNDLE: "Agent bundle",
  AI_BOUNDED_OFFER: "Agent bounded offer",
  AI_RECOVERY: "Agent payment recovery",
  AGENT_GATEWAY: "External buyer agent",
  direct: "Direct sale",
};

function labelForSource(source: string | null): string {
  if (!source) return "Direct sale";
  return SOURCE_LABEL[source] ?? source.replaceAll("_", " ").toLowerCase();
}

/* ═══════════════════════════════════════════════════════════════════════
 * The opportunity index — Growth's output, attached to Commerce rows
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * Builds `subjectId -> findings` from a report the engine has already
 * produced.
 *
 * One engine call serves all four views, and every field is copied
 * verbatim. If this ever starts *deriving* something instead of copying
 * it, the two screens can disagree again.
 */
async function buildOpportunityIndex(
  prisma: PrismaClient,
  merchantId: string,
): Promise<Map<string, AttachedOpportunityDTO[]>> {
  const { opportunities } = await getRevenueOpportunityReport(prisma, merchantId);
  const index = new Map<string, AttachedOpportunityDTO[]>();

  for (const o of opportunities) {
    const attached: AttachedOpportunityDTO = {
      id: o.id,
      type: o.type,
      title: o.title,
      whyDetected: o.whyDetected,
      actionLabel: o.actionLabel,
      priority: o.score.priority,
      approvalRequired: o.approvalRequired,
      policyOutcome: o.policy.outcome,
      status: o.status,
      // Named from the one registry the autonomous cycle also dispatches
      // through, so "what would the agent do about this" has a single
      // answer rather than one per screen.
      tool: toolForOpportunityType(o.type),
    };
    for (const subjectId of o.subjectIds) {
      const existing = index.get(subjectId);
      if (existing) existing.push(attached);
      else index.set(subjectId, [attached]);
    }
  }

  // Highest priority first within each row, so a merchant reading one
  // order sees the same ordering Growth would have shown them.
  for (const list of index.values()) list.sort((a, b) => b.priority - a.priority);
  return index;
}

function opportunitiesFor(index: Map<string, AttachedOpportunityDTO[]>, ...ids: (string | null)[]): AttachedOpportunityDTO[] {
  const seen = new Set<string>();
  const out: AttachedOpportunityDTO[] = [];
  for (const id of ids) {
    if (!id) continue;
    for (const o of index.get(id) ?? []) {
      if (seen.has(o.id)) continue;
      seen.add(o.id);
      out.push(o);
    }
  }
  return out.sort((a, b) => b.priority - a.priority);
}

/* ═══════════════════════════════════════════════════════════════════════
 * PRODUCTS — catalog + performance + AI-readiness
 * ══════════════════════════════════════════════════════════════════════ */

export async function getCommerceProducts(
  prisma: PrismaClient,
  merchantId: string,
  limit = COMMERCE_PAGE_LIMIT,
): Promise<CommerceProductsResponseDTO> {
  const [merchant, products, total, index, catalogue] = await Promise.all([
    prisma.merchant.findUniqueOrThrow({ where: { id: merchantId }, select: { defaultCurrency: true } }),
    prisma.product.findMany({
      where: { merchantId, status: "ACTIVE" },
      orderBy: { name: "asc" },
      take: limit,
      include: { variants: { where: { active: true }, include: { inventory: true } } },
    }),
    prisma.product.count({ where: { merchantId, status: "ACTIVE" } }),
    buildOpportunityIndex(prisma, merchantId),
    // The SAME analyzer the readiness console and the catalogue-gap
    // service read. A second readiness derivation here would be a third
    // opinion about the same products.
    analyzeCatalog(prisma, merchantId),
  ]);

  const readinessByProduct = new Map(catalogue.perProduct.map((p) => [p.productId, p.readiness]));

  /**
   * Performance, counted in the database over PAID orders only.
   *
   * Grouped in one query rather than per product: 200 products would
   * otherwise be 200 round trips, and the figures must agree with each
   * other anyway.
   */
  // An order line references a VARIANT, never a product — the only join
  // from a sale back to a product runs through `ProductVariant.productId`.
  // Doing it in one pass rather than per product: 200 products would
  // otherwise be 200 round trips for figures that must agree anyway.
  const variantToProduct = new Map<string, string>();
  for (const product of products) {
    for (const variant of product.variants) variantToProduct.set(variant.id, product.id);
  }

  const soldRows = variantToProduct.size
    ? await prisma.orderItem.findMany({
        where: { variantId: { in: [...variantToProduct.keys()] }, order: { merchantId, status: "PAID" } },
        select: {
          variantId: true,
          quantity: true,
          lineTotalMinor: true,
          orderId: true,
          order: { select: { createdAt: true } },
        },
      })
    : [];

  const performanceByProduct = new Map<string, { units: number; revenue: number; orders: Set<string>; lastSoldAt: Date | null }>();
  for (const row of soldRows) {
    const productId = variantToProduct.get(row.variantId);
    if (!productId) continue;
    const acc =
      performanceByProduct.get(productId) ?? { units: 0, revenue: 0, orders: new Set<string>(), lastSoldAt: null };
    acc.units += row.quantity;
    acc.revenue += row.lineTotalMinor;
    acc.orders.add(row.orderId);
    if (!acc.lastSoldAt || row.order.createdAt > acc.lastSoldAt) acc.lastSoldAt = row.order.createdAt;
    performanceByProduct.set(productId, acc);
  }

  return {
    currency: merchant.defaultCurrency,
    window: { returned: products.length, total, limit },
    products: products.map((product) => {
      const sold = performanceByProduct.get(product.id);
      const unitsSold = sold?.units ?? 0;
      const revenueMinor = sold?.revenue ?? 0;
      const readiness = readinessByProduct.get(product.id);

      return {
        productId: product.id,
        performance: {
          unitsSold,
          revenueMinor,
          // Distinct ORDERS, not line items: a basket containing two
          // variants of the same product is one order, and counting it
          // twice would inflate every multi-variant product.
          paidOrderCount: sold?.orders.size ?? 0,
          lastSoldAt: sold?.lastSoldAt?.toISOString() ?? null,
          // Never 0 for "never sold" — an average over no observations is
          // not a number, and printing zero would read as "sells for
          // nothing".
          averageSellingPriceMinor: unitsSold > 0 ? Math.round(revenueMinor / unitsSold) : null,
        },
        aiReadiness: {
          // A product the analyzer did not return is one with no active
          // variants; NOT_READY is what the engine itself would say, and
          // is stated rather than left undefined.
          state: readiness?.state ?? "NOT_READY",
          missingCritical: readiness?.missingCritical ?? ["No active purchasable variant"],
          missingImportant: readiness?.missingImportant ?? [],
        },
        opportunities: opportunitiesFor(index, product.id),
      };
    }),
  };
}

/* ═══════════════════════════════════════════════════════════════════════
 * CUSTOMERS — observable behaviour + eligible growth opportunities
 * ══════════════════════════════════════════════════════════════════════ */

function medianOf(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1]! + sorted[mid]!) / 2) : sorted[mid]!;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export async function getCommerceCustomers(
  prisma: PrismaClient,
  merchantId: string,
  limit = COMMERCE_PAGE_LIMIT,
): Promise<CommerceCustomersResponseDTO> {
  const [merchant, customers, total, index] = await Promise.all([
    prisma.merchant.findUniqueOrThrow({ where: { id: merchantId }, select: { defaultCurrency: true } }),
    prisma.customer.findMany({
      where: { merchantId },
      orderBy: { createdAt: "asc" },
      take: limit,
      include: {
        orders: {
          select: { id: true, status: true, totalAmountMinor: true, createdAt: true, source: true },
          orderBy: { createdAt: "asc" },
        },
      },
    }),
    prisma.customer.count({ where: { merchantId } }),
    buildOpportunityIndex(prisma, merchantId),
  ]);

  return {
    currency: merchant.defaultCurrency,
    window: { returned: customers.length, total, limit },
    customers: customers.map((customer) => {
      const paid = customer.orders.filter((o) => o.status === "PAID");
      const lifetimeValueMinor = paid.reduce((sum, o) => sum + o.totalAmountMinor, 0);

      // Gaps between consecutive PAID orders, in days. Needs two points,
      // and says null rather than zero when it does not have them.
      const gaps: number[] = [];
      for (let i = 1; i < paid.length; i += 1) {
        gaps.push(Math.round((paid[i]!.createdAt.getTime() - paid[i - 1]!.createdAt.getTime()) / DAY_MS));
      }

      const first = paid[0]?.createdAt ?? null;
      const last = paid[paid.length - 1]?.createdAt ?? null;

      return {
        id: customer.id,
        displayName: customer.displayName,
        email: customer.email,
        segment: customer.segment,
        currency: merchant.defaultCurrency,
        behaviour: {
          paidOrderCount: paid.length,
          orderCount: customer.orders.length,
          lifetimeValueMinor,
          averageOrderValueMinor: paid.length > 0 ? Math.round(lifetimeValueMinor / paid.length) : null,
          firstPaidOrderAt: first?.toISOString() ?? null,
          lastPaidOrderAt: last?.toISOString() ?? null,
          observedSpanDays:
            first && last && paid.length >= 2 ? Math.round((last.getTime() - first.getTime()) / DAY_MS) : null,
          medianGapDays: gaps.length > 0 ? medianOf(gaps) : null,
          agentAttributedOrderCount: paid.filter((o) => o.source && AGENT_ORIGINATED_SOURCES.has(o.source)).length,
        },
        opportunities: opportunitiesFor(index, customer.id),
      };
    }),
  };
}

/* ═══════════════════════════════════════════════════════════════════════
 * ORDERS — order state + revenue + payment state + agent attribution
 * ══════════════════════════════════════════════════════════════════════ */

export async function getCommerceOrders(
  prisma: PrismaClient,
  merchantId: string,
  limit = COMMERCE_PAGE_LIMIT,
): Promise<CommerceOrdersResponseDTO> {
  const agentSources = [...AGENT_ORIGINATED_SOURCES] as Prisma.OrderWhereInput["source"][] as string[];

  const [merchant, orders, total, paidOrderCount, agentAttributedOrderCount, agentCaptured, index] = await Promise.all([
    prisma.merchant.findUniqueOrThrow({ where: { id: merchantId }, select: { defaultCurrency: true } }),
    prisma.order.findMany({
      where: { merchantId },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        items: true,
        customer: { select: { id: true, displayName: true, email: true } },
        payments: { orderBy: { createdAt: "desc" } },
      },
    }),
    prisma.order.count({ where: { merchantId } }),
    prisma.order.count({ where: { merchantId, status: "PAID" } }),
    prisma.order.count({ where: { merchantId, source: { in: agentSources } } }),
    // Agent-attributed revenue is CAPTURED money, not order totals. An
    // order total is what was asked for; captured is what arrived.
    prisma.payment.aggregate({
      where: { merchantId, state: "CAPTURED", order: { source: { in: agentSources } } },
      _sum: { amountMinor: true },
    }),
    buildOpportunityIndex(prisma, merchantId),
  ]);

  return {
    currency: merchant.defaultCurrency,
    window: { returned: orders.length, total, limit },
    totals: {
      paidOrderCount,
      agentAttributedOrderCount,
      agentAttributedCapturedMinor: agentCaptured._sum.amountMinor ?? 0,
    },
    orders: orders.map((order) => {
      const latestPayment = order.payments[0] ?? null;
      const capturedMinor = order.payments
        .filter((p) => p.state === "CAPTURED")
        .reduce((sum, p) => sum + p.amountMinor, 0);

      return {
        id: order.id,
        status: order.status,
        createdAt: order.createdAt.toISOString(),
        totalAmountMinor: order.totalAmountMinor,
        currency: order.currency,
        capturedMinor,
        customer: order.customer,
        payment: latestPayment
          ? {
              id: latestPayment.id,
              state: latestPayment.state,
              attemptNumber: latestPayment.attemptNumber,
              failureCategory: latestPayment.failureCategory,
            }
          : null,
        attribution: {
          source: order.source,
          label: labelForSource(order.source),
          agentAttributed: Boolean(order.source && AGENT_ORIGINATED_SOURCES.has(order.source)),
          // A recorded column, not an inference. `OrderItem.growthProposalId`
          // is written when a line enters a basket because an agent
          // proposal put it there, so "which agent action caused this
          // order" is answered by the row itself. Null for a direct sale,
          // which is the truthful answer rather than a guess.
          proposalId: order.items.find((item) => item.growthProposalId)?.growthProposalId ?? null,
        },
        items: order.items.map((item) => ({
          variantId: item.variantId,
          productNameSnapshot: item.productNameSnapshot,
          variantTitleSnapshot: item.variantTitleSnapshot,
          quantity: item.quantity,
          lineTotalMinor: item.lineTotalMinor,
        })),
        opportunities: opportunitiesFor(index, order.id, latestPayment?.id ?? null),
      };
    }),
  };
}

/* ═══════════════════════════════════════════════════════════════════════
 * PAYMENTS — payment state + recovery opportunities
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * Whether the merchant's record of a payment is known to match the
 * provider's.
 *
 * UNKNOWN is its own condition, not a flavour of failure. It means an
 * attempt happened and nobody has asked the provider how it ended. Those
 * payments were invisible to the Revenue Opportunity Engine — which
 * filters `state === "FAILED"` — so nothing detected them and nothing
 * acted on them. They simply sat, which is the worst state for a payment
 * to be in: the money is neither recovered nor written off.
 */
function verificationOf(state: string, lastReconciledAt: Date | null): "VERIFIED" | "UNVERIFIED" | "NOT_APPLICABLE" {
  if (state === "UNKNOWN") return "UNVERIFIED";
  if (state === "CAPTURED" || state === "FAILED" || state === "REFUNDED") return "VERIFIED";
  // CREATED / AUTHORIZED are in-flight: there is nothing yet to verify,
  // and calling that "unverified" would put every new checkout on a
  // remediation list.
  return lastReconciledAt ? "VERIFIED" : "NOT_APPLICABLE";
}

export async function getCommercePayments(
  prisma: PrismaClient,
  merchantId: string,
  limit = COMMERCE_PAGE_LIMIT,
): Promise<CommercePaymentsResponseDTO> {
  const [merchant, payments, total, captured, failedCount, unverifiedCount, index] = await Promise.all([
    prisma.merchant.findUniqueOrThrow({ where: { id: merchantId }, select: { defaultCurrency: true } }),
    prisma.payment.findMany({ where: { merchantId }, orderBy: { createdAt: "desc" }, take: limit }),
    prisma.payment.count({ where: { merchantId } }),
    prisma.payment.aggregate({ where: { merchantId, state: "CAPTURED" }, _sum: { amountMinor: true } }),
    prisma.payment.count({ where: { merchantId, state: "FAILED" } }),
    prisma.payment.count({ where: { merchantId, state: "UNKNOWN" } }),
    buildOpportunityIndex(prisma, merchantId),
  ]);

  const rows = payments.map((payment) => ({
    id: payment.id,
    orderId: payment.orderId,
    state: payment.state,
    amountMinor: payment.amountMinor,
    currency: payment.currency,
    provider: payment.provider,
    attemptNumber: payment.attemptNumber,
    createdAt: payment.createdAt.toISOString(),
    failureCode: payment.failureCode,
    failureCategory: payment.failureCategory,
    customerDebitStatus: payment.customerDebitStatus,
    merchantCreditStatus: payment.merchantCreditStatus,
    lastReconciledAt: payment.lastReconciledAt?.toISOString() ?? null,
    verification: verificationOf(payment.state, payment.lastReconciledAt),
    opportunities: opportunitiesFor(index, payment.id, payment.orderId),
  }));

  return {
    currency: merchant.defaultCurrency,
    window: { returned: rows.length, total, limit },
    totals: {
      capturedMinor: captured._sum.amountMinor ?? 0,
      failedCount,
      unverifiedCount,
      // What the agent could actually work on right now, counted over the
      // returned window because eligibility is a per-row judgement the
      // engine has already made.
      recoverableCount: rows.filter((r) => r.opportunities.some((o) => o.tool !== null)).length,
    },
    payments: rows,
  };
}
