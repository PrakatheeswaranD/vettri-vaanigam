/**
 * Assembles the evidence the Revenue Opportunity Engine reasons over.
 *
 * THE DIVISION OF LABOUR
 *
 * This file is allowed to know about Prisma. It is not allowed to decide
 * anything. Every threshold, every rate, every score and every refusal to
 * produce an estimate lives in `@razorgrowth/domain`'s
 * `revenue-opportunity.ts`, which has never heard of a database. That
 * split is what makes the engine testable against hand-written facts and
 * what stops "how we query" from quietly becoming "what we claim".
 *
 * TWO THINGS THIS FILE IS CAREFUL ABOUT
 *
 *  1. PAID means PAID. Lifetime value, average order value and repeat
 *     cadence are computed from orders in status `PAID` only. Summing
 *     every order regardless of status — which is what the previous
 *     `/merchant/commerce-overview` route did — counts cancelled and
 *     failed orders as customer value and overstates the business.
 *
 *  2. Recovery eligibility is not re-decided here. Each failed payment is
 *     passed through the domain's `evaluateRecoveryEligibility`, the same
 *     function the actual recovery execution path uses, so an opportunity
 *     can never be offered for something the executor would refuse.
 */
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  detectRevenueOpportunities,
  summariseRevenueOpportunities,
  evaluateRecoveryEligibility,
  isPaymentFailureCategory,
  calculateRevenueGrowthScore,
  calculateAiBuyerCapabilityScore,
  computeCampaignLift,
  observedOfferLiftBps,
  type MerchantRevenueEvidence,
  type CustomerPurchaseFact,
  type ProductPerformanceFact,
  type FailedPaymentFact,
  type UnverifiedPaymentFact,
  type StalledCheckoutFact,
  type RevenueOpportunity,
  type RevenueOpportunityTotals,
  type CompositeScore,
  type CurrencyCode,
} from "@razorgrowth/domain";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_HOUR = 60 * 60 * 1000;

/** Guards against a clock skew producing a negative age, which would
 * make an old opportunity look maximally urgent. */
function ageDays(from: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - from.getTime()) / MS_PER_DAY));
}

function ageHours(from: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - from.getTime()) / MS_PER_HOUR));
}

/** Median of a non-empty numeric list. Even-length lists take the lower
 * of the two middle values, so the result is always an observation that
 * actually occurred rather than an interpolated value. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)]!;
}

export interface RevenueOpportunityReport {
  opportunities: RevenueOpportunity[];
  totals: RevenueOpportunityTotals;
  growthScore: CompositeScore;
  aiBuyerScore: CompositeScore;
  /** Echoed so the console can show what the engine was reasoning over
   * rather than asking the merchant to take the output on trust. */
  observed: {
    currency: CurrencyCode;
    capturedRevenueMinor: number;
    averageOrderValueMinor: number;
    paidOrderCount: number;
    ordersWithPaymentAttempt: number;
    failedPaymentCount: number;
    recoveredPaymentCount: number;
    customerCount: number;
    repeatCustomerCount: number;
    agentVisibleProductCount: number;
    transactableProductCount: number;
  };
  generatedAt: string;
}

async function collectMerchantRevenueEvidence(
  prisma: PrismaClient,
  merchantId: string,
  now: Date = new Date(),
): Promise<MerchantRevenueEvidence> {
  const merchant = await prisma.merchant.findUniqueOrThrow({
    where: { id: merchantId },
    select: { defaultCurrency: true },
  });
  const currency = merchant.defaultCurrency as CurrencyCode;

  const [orders, payments, customers, products, growthConfig, policy, readiness] = await Promise.all([
    prisma.order.findMany({
      where: { merchantId },
      select: { id: true, status: true, customerId: true, totalAmountMinor: true, currency: true, createdAt: true },
    }),
    prisma.payment.findMany({
      where: { merchantId },
      select: {
        id: true,
        orderId: true,
        state: true,
        amountMinor: true,
        currency: true,
        attemptNumber: true,
        failureCategory: true,
        failureCode: true,
        createdAt: true,
        failedAt: true,
        // Needed to tell an UNKNOWN payment that CAN be reconciled from
        // one that cannot: with no provider reference there is nothing to
        // ask the provider about.
        providerPaymentId: true,
        providerOrderId: true,
      },
    }),
    prisma.customer.findMany({
      where: { merchantId },
      select: { id: true, displayName: true },
    }),
    prisma.product.findMany({
      where: { merchantId },
      select: {
        id: true,
        name: true,
        status: true,
        promotionEligibility: true,
        variants: {
          select: { id: true, active: true, priceMinor: true, attributes: true, inventory: { select: { variantId: true } } },
        },
        relationshipsAsSource: { select: { id: true } },
      },
    }),
    prisma.merchantGrowthConfig.findUnique({ where: { merchantId } }),
    prisma.merchantPolicy.findUnique({ where: { merchantId } }),
    prisma.readinessSnapshot.findFirst({
      where: { merchantId },
      orderBy: { createdAt: "desc" },
      select: { overallScore: true },
    }),
  ]);

  const ordersById = new Map(orders.map((o) => [o.id, o]));

  /* --- Payment-derived facts ------------------------------------------- */

  /**
   * Payments whose outcome was never established with the provider.
   *
   * This engine filtered `state === "FAILED"` and nothing else, so an
   * UNKNOWN payment was detected by no detector and worked by no cycle.
   * The demo merchant had four of them: money neither recovered nor
   * written off, on no screen and in no queue.
   */
  const unverifiedPayments: UnverifiedPaymentFact[] = payments
    .filter((p) => p.state === "UNKNOWN")
    .map((p) => ({
      paymentId: p.id,
      orderId: p.orderId,
      customerId: ordersById.get(p.orderId)?.customerId ?? null,
      amountMinor: p.amountMinor,
      currency: p.currency as CurrencyCode,
      ageDays: ageDays(p.createdAt, now),
      hasProviderReference: Boolean(p.providerPaymentId ?? p.providerOrderId),
    }));

  const failedPaymentRows = payments.filter((p) => p.state === "FAILED");
  const recoveredPaymentCount = payments.filter((p) => p.state === "CAPTURED" && p.attemptNumber > 1).length;

  // Prior recovery attempts per order, so an order already retried to its
  // limit is never offered as a fresh opportunity.
  const attemptsByOrder = new Map<string, number>();
  for (const p of payments) {
    if (p.attemptNumber > 1) attemptsByOrder.set(p.orderId, Math.max(attemptsByOrder.get(p.orderId) ?? 0, p.attemptNumber - 1));
  }
  const maxRecoveryAttempts = policy?.maxRecoveryAttempts ?? 1;

  const failedPayments: FailedPaymentFact[] = failedPaymentRows.map((p) => {
    const order = ordersById.get(p.orderId);
    // The persisted category is the authoritative one; `failureCode` is
    // only a fallback for rows written before categorisation existed.
    const rawCategory = p.failureCategory ?? p.failureCode;
    const failureCategory = rawCategory && isPaymentFailureCategory(rawCategory) ? rawCategory : null;

    const decision = evaluateRecoveryEligibility({
      paymentState: p.state,
      failureCategory,
      orderStatus: order?.status ?? "CANCELLED",
      recoveryAttemptCount: attemptsByOrder.get(p.orderId) ?? 0,
      maxRecoveryAttempts,
    });

    return {
      paymentId: p.id,
      orderId: p.orderId,
      customerId: order?.customerId ?? null,
      amountMinor: p.amountMinor,
      currency: p.currency as CurrencyCode,
      // Report the raw stored value when it is outside the closed
      // taxonomy, rather than hiding it — the merchant should see what
      // the provider actually said.
      failureCategory: rawCategory,
      recoveryEligible: decision.outcome === "ELIGIBLE",
      recoveryBlockedReason: decision.outcome === "ELIGIBLE" ? null : decision.reasonCodes[0] ?? null,
      ageDays: ageDays(p.failedAt ?? p.createdAt, now),
    };
  });

  // A checkout that created a payment and never resolved it. Only the
  // LATEST attempt per order counts, so an order that failed and was then
  // retried does not appear twice.
  const latestPaymentByOrder = new Map<string, (typeof payments)[number]>();
  for (const p of payments) {
    const existing = latestPaymentByOrder.get(p.orderId);
    if (!existing || p.attemptNumber > existing.attemptNumber || p.createdAt > existing.createdAt) {
      latestPaymentByOrder.set(p.orderId, p);
    }
  }
  const stalledCheckouts: StalledCheckoutFact[] = [...latestPaymentByOrder.values()]
    .filter((p) => p.state === "CREATED")
    .map((p) => ({
      orderId: p.orderId,
      customerId: ordersById.get(p.orderId)?.customerId ?? null,
      amountMinor: p.amountMinor,
      currency: p.currency as CurrencyCode,
      ageHours: ageHours(p.createdAt, now),
    }));

  /* --- Order-derived facts --------------------------------------------- */

  const paidOrders = orders.filter((o) => o.status === "PAID");
  const paidOrderCount = paidOrders.length;
  const averageOrderValueMinor = paidOrderCount
    ? Math.round(paidOrders.reduce((sum, o) => sum + o.totalAmountMinor, 0) / paidOrderCount)
    : 0;
  const ordersWithPaymentAttempt = new Set(payments.map((p) => p.orderId)).size;

  /* --- Customer-derived facts ------------------------------------------ */

  const paidOrdersByCustomer = new Map<string, Date[]>();
  const paidValueByCustomer = new Map<string, number>();
  for (const order of paidOrders) {
    if (!order.customerId) continue;
    const dates = paidOrdersByCustomer.get(order.customerId) ?? [];
    dates.push(order.createdAt);
    paidOrdersByCustomer.set(order.customerId, dates);
    paidValueByCustomer.set(order.customerId, (paidValueByCustomer.get(order.customerId) ?? 0) + order.totalAmountMinor);
  }

  const customerFacts: CustomerPurchaseFact[] = customers.map((c) => {
    const dates = (paidOrdersByCustomer.get(c.id) ?? []).sort((a, b) => a.getTime() - b.getTime());
    const gaps: number[] = [];
    for (let i = 1; i < dates.length; i += 1) {
      gaps.push(Math.max(0, Math.round((dates[i]!.getTime() - dates[i - 1]!.getTime()) / MS_PER_DAY)));
    }
    const last = dates[dates.length - 1] ?? null;
    return {
      customerId: c.id,
      displayName: c.displayName,
      paidOrderCount: dates.length,
      lifetimeValueMinor: paidValueByCustomer.get(c.id) ?? 0,
      daysSinceLastPaidOrder: last ? ageDays(last, now) : null,
      medianOrderGapDays: gaps.length > 0 ? median(gaps) : null,
    };
  });

  /* --- Product-derived facts ------------------------------------------- */

  // Units sold per product, from PAID orders only — an item in a failed
  // order was never bought.
  const paidOrderIds = paidOrders.map((o) => o.id);
  const soldItems = paidOrderIds.length
    ? await prisma.orderItem.findMany({
        where: { orderId: { in: paidOrderIds } },
        select: { quantity: true, variant: { select: { productId: true } } },
      })
    : [];
  const unitsByProduct = new Map<string, number>();
  for (const item of soldItems) {
    const productId = item.variant.productId;
    unitsByProduct.set(productId, (unitsByProduct.get(productId) ?? 0) + item.quantity);
  }

  /**
   * Subjects the agent has already proposed something for.
   *
   * A proposal records what it acted on through `sourcePaymentId`,
   * `sourceOrderId` and `primaryProductId`. Collecting all three means an
   * opportunity can report ACTIONED whether it was about a payment, an
   * order or a product, without each detector having to know which column
   * its own subjects live in.
   */
  /**
   * LEARN — the offer lift this merchant has actually measured.
   *
   * Campaigns already hash-bucketed every subject into CONTROL or
   * TREATMENT before any offer was made, which is a real holdout and the
   * only basis in this product for a causal claim. Nothing had ever read
   * it back. Feeding it in here is what lets the ELIGIBLE_OFFER detector
   * stop withholding its estimate once the merchant has earned one, and
   * keeps it withholding when they have not.
   */
  const campaignAssignments = await prisma.campaignAssignment.findMany({
    where: { campaign: { merchantId } },
    select: { campaignId: true, cohort: true, impressionCount: true, conversionCount: true, observedRevenueMinor: true },
  });
  const byCampaign = new Map<string, typeof campaignAssignments>();
  for (const row of campaignAssignments) {
    const bucket = byCampaign.get(row.campaignId);
    if (bucket) bucket.push(row);
    else byCampaign.set(row.campaignId, [row]);
  }
  const measuredLifts = [...byCampaign.values()].map((rows) => {
    const summarise = (cohort: string) => {
      const inCohort = rows.filter((r) => r.cohort === cohort);
      return {
        subjects: inCohort.length,
        impressions: inCohort.reduce((sum, r) => sum + r.impressionCount, 0),
        conversions: inCohort.reduce((sum, r) => sum + r.conversionCount, 0),
        observedRevenueMinor: inCohort.reduce((sum, r) => sum + r.observedRevenueMinor, 0),
      };
    };
    return computeCampaignLift(summarise("TREATMENT"), summarise("CONTROL"));
  });

  const proposals = await prisma.growthActionProposal.findMany({
    where: { merchantId },
    select: { primaryProductId: true, sourcePaymentId: true, sourceOrderId: true },
  });
  const actedOnSubjectIds = [
    ...new Set(
      proposals.flatMap((p) => [p.primaryProductId, p.sourcePaymentId, p.sourceOrderId].filter((id): id is string => Boolean(id))),
    ),
  ];

  const productFacts: ProductPerformanceFact[] = products.map((p) => {
    const activeVariants = p.variants.filter((v) => v.active);
    const priced = activeVariants.filter((v) => v.priceMinor > 0);
    return {
      productId: p.id,
      name: p.name,
      unitsSold: unitsByProduct.get(p.id) ?? 0,
      entryPriceMinor: priced.length > 0 ? Math.min(...priced.map((v) => v.priceMinor)) : null,
      // The dearest active priced variant. Together with the cheapest it
      // is the merchant's own price ladder, which is the only defensible
      // basis for an upsell — see `detectUpsell`.
      topPriceMinor: priced.length > 0 ? Math.max(...priced.map((v) => v.priceMinor)) : null,
      currency,
      outgoingRelationshipCount: p.relationshipsAsSource.length,
      // Every active variant must carry attributes — one unmatched
      // variant is still a variant an agent cannot reason about.
      hasStructuredAttributes:
        activeVariants.length > 0 &&
        activeVariants.every((v) => Object.keys((v.attributes as Record<string, unknown> | null) ?? {}).length > 0),
      // A missing inventory ROW is unknown stock, which is distinct from
      // a recorded zero. An agent will not commit to either, but only the
      // former is a data gap the merchant can close.
      hasRecordedInventory: activeVariants.length > 0 && activeVariants.every((v) => v.inventory !== null),
      agentVisible: p.status === "ACTIVE",
      // The merchant's own flag. The engine never decides a product is
      // promotable; it only notices one they marked promotable that has
      // no offer on it.
      promotionEligible: p.promotionEligibility === "ELIGIBLE",
    };
  });

  return {
    currency,
    averageOrderValueMinor,
    paidOrderCount,
    ordersWithPaymentAttempt,
    failedPaymentCount: failedPaymentRows.length,
    recoveredPaymentCount,
    failedPayments,
    unverifiedPayments,
    stalledCheckouts,
    customers: customerFacts,
    products: productFacts,
    growthActionsEnabled: growthConfig?.growthActionsEnabled ?? true,
    crossSellEnabled: growthConfig?.crossSellEnabled ?? true,
    upsellEnabled: growthConfig?.upsellEnabled ?? true,
    // The merchant's own auto-approval ceiling IS the approval threshold.
    // Falling back to 0 rather than infinity means an unconfigured
    // merchant gets "everything needs approval", which is the safe
    // direction to be wrong in.
    approvalThresholdMinor: policy?.autoApprovalOrderAmountMinor ?? 0,
    boundedOffersEnabled: growthConfig?.boundedOffersEnabled ?? true,
    observedOfferLiftBps: observedOfferLiftBps(measuredLifts),
    // Which subjects already carry an agent proposal. Read from the same
    // `GrowthActionProposal` table governance reads, so an opportunity's
    // status can never disagree with what the approvals queue shows.
    actedOnSubjectIds,
    readinessScore: readiness?.overallScore ?? null,
    readinessBlockers: [],
  };
}

/**
 * The full report: ranked opportunities, portfolio totals that never mix
 * value classifications, and both scores.
 */
export async function getRevenueOpportunityReport(
  prisma: PrismaClient,
  merchantId: string,
  now: Date = new Date(),
): Promise<RevenueOpportunityReport> {
  const evidence = await collectMerchantRevenueEvidence(prisma, merchantId, now);
  const opportunities = detectRevenueOpportunities(evidence);
  const totals = summariseRevenueOpportunities(opportunities, evidence.currency);

  const capturedRevenueMinor = await prisma.payment
    .aggregate({ where: { merchantId, state: "CAPTURED" }, _sum: { amountMinor: true } })
    .then((r) => r._sum.amountMinor ?? 0);

  const agentVisible = evidence.products.filter((p) => p.agentVisible);
  const transactable = agentVisible.filter(
    (p) => p.entryPriceMinor !== null && p.hasStructuredAttributes && p.hasRecordedInventory,
  );
  const selling = agentVisible.filter((p) => p.unitsSold > 0);
  const repeatCustomerCount = evidence.customers.filter((c) => c.paidOrderCount >= 2).length;

  const [proposalsCreated, proposalsExecuted] = await Promise.all([
    prisma.growthActionProposal.count({ where: { merchantId } }),
    prisma.growthActionProposal.count({ where: { merchantId, status: "AUTHORIZED" } }),
  ]);

  const uncapturedAtRiskMinor =
    evidence.failedPayments.filter((p) => p.recoveryEligible).reduce((sum, p) => sum + p.amountMinor, 0) +
    evidence.stalledCheckouts.reduce((sum, c) => sum + c.amountMinor, 0);

  const growthScore = calculateRevenueGrowthScore({
    ordersWithPaymentAttempt: evidence.ordersWithPaymentAttempt,
    paidOrderCount: evidence.paidOrderCount,
    failedPaymentCount: evidence.failedPaymentCount,
    recoveredPaymentCount: evidence.recoveredPaymentCount,
    capturedRevenueMinor,
    uncapturedAtRiskMinor,
    customerCount: evidence.customers.length,
    repeatCustomerCount,
    agentVisibleProductCount: agentVisible.length,
    transactableProductCount: transactable.length,
    sellingProductCount: selling.length,
    sellingProductsWithRelationshipCount: selling.filter((p) => p.outgoingRelationshipCount > 0).length,
    proposalsExecuted,
    proposalsCreated,
  });

  const aiBuyerScore = await calculateAiBuyerScoreFor(prisma, merchantId, {
    transactableProductCount: transactable.length,
    agentVisibleProductCount: agentVisible.length,
  });

  return {
    opportunities,
    totals,
    growthScore,
    aiBuyerScore,
    observed: {
      currency: evidence.currency,
      capturedRevenueMinor,
      averageOrderValueMinor: evidence.averageOrderValueMinor,
      paidOrderCount: evidence.paidOrderCount,
      ordersWithPaymentAttempt: evidence.ordersWithPaymentAttempt,
      failedPaymentCount: evidence.failedPaymentCount,
      recoveredPaymentCount: evidence.recoveredPaymentCount,
      customerCount: evidence.customers.length,
      repeatCustomerCount,
      agentVisibleProductCount: agentVisible.length,
      transactableProductCount: transactable.length,
    },
    generatedAt: now.toISOString(),
  };
}

/**
 * WHY THESE TWO COUNTS ARE RAW SQL AND NOT `where: { merchantId }`.
 *
 * Neither a buyer conversation nor a recommendation record is owned by a
 * seller. A conversation belongs to the SHOPPER having it, and a
 * marketplace answer routinely spans several merchants' catalogues — so
 * there is no column on either table that means "this merchant". The only
 * honest link is the one the recommendation actually made: which PRODUCTS
 * it put in front of the shopper, and who owns them.
 *
 * Both counts previously read `where: { merchantId }` against tables whose
 * `merchantId` held the shopper's context id. Every RecommendationRecord
 * row in the demo database was filed under the shopper; the merchant-scoped
 * query matched none of them and the score reported zero for two components
 * worth 35 of its 100 points — a merchant with 45 real recommendations
 * against their catalogue was told they had none. A count that can only ever
 * return zero is worse than a missing metric, because it reads as an answer.
 */
function reachedThisMerchant(merchantId: string) {
  return Prisma.sql`EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(rr."recommendedProductIds") AS pid
    JOIN "Product" p ON p."id" = pid AND p."merchantId" = ${merchantId}
  )`;
}

async function countRecommendationsReaching(prisma: PrismaClient, merchantId: string): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ count: bigint }>>(
    Prisma.sql`SELECT COUNT(*)::bigint AS count FROM "RecommendationRecord" rr WHERE ${reachedThisMerchant(merchantId)}`,
  );
  return Number(rows[0]?.count ?? 0);
}

/** Distinct conversations that produced at least one recommendation of this
 * merchant's products. `withIntent` narrows to those that also reached a
 * structured intent, which is what the intent-extraction component scores. */
async function countConversationsReaching(prisma: PrismaClient, merchantId: string, withIntent: boolean): Promise<number> {
  const intentClause = withIntent ? Prisma.sql`AND c."currentIntent" IS NOT NULL` : Prisma.empty;
  const rows = await prisma.$queryRaw<Array<{ count: bigint }>>(
    Prisma.sql`
      SELECT COUNT(DISTINCT c."id")::bigint AS count
      FROM "BuyerConversation" c
      JOIN "RecommendationRecord" rr ON rr."conversationId" = c."id"
      WHERE ${reachedThisMerchant(merchantId)} ${intentClause}`,
  );
  return Number(rows[0]?.count ?? 0);
}

/**
 * The AI Buyer score counts things that HAVE HAPPENED. Each count below
 * is a row that only exists because the corresponding capability actually
 * ran — which is the difference between this and a feature checklist.
 */
async function calculateAiBuyerScoreFor(
  prisma: PrismaClient,
  merchantId: string,
  catalogue: { transactableProductCount: number; agentVisibleProductCount: number },
): Promise<CompositeScore> {
  const [
    conversationCount,
    conversationsWithExtractedIntent,
    groundedRecommendationCount,
    gatewayDecisionCount,
    gatewayDenialCount,
    agentAttributedPaymentAttempts,
    agentAttributedCaptures,
    verifiedMandateCount,
  ] = await Promise.all([
    countConversationsReaching(prisma, merchantId, false),
    countConversationsReaching(prisma, merchantId, true),
    countRecommendationsReaching(prisma, merchantId),
    prisma.decisionRecord.count({ where: { merchantId } }),
    prisma.decisionRecord.count({ where: { merchantId, outcome: { in: ["DECLINE", "STEP_UP"] } } }),
    prisma.payment.count({ where: { merchantId, order: { source: { not: null } } } }),
    prisma.payment.count({ where: { merchantId, state: "CAPTURED", order: { source: { not: null } } } }),
    prisma.spendMandateNonce.count({ where: { merchantId } }),
  ]);

  return calculateAiBuyerCapabilityScore({
    conversationCount,
    conversationsWithExtractedIntent,
    groundedRecommendationCount,
    transactableProductCount: catalogue.transactableProductCount,
    agentVisibleProductCount: catalogue.agentVisibleProductCount,
    gatewayDecisionCount,
    gatewayDenialCount,
    agentAttributedPaymentAttempts,
    agentAttributedCaptures,
    verifiedMandateCount,
  });
}
