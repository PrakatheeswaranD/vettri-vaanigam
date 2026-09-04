/**
 * Automatic Campaign Attribution and Conversion Engine.
 * Automatically connects Subject Assignment -> Order Creation -> Payment Capture -> Conversion.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { appendLedgerEvent } from "../audit/ledger.js";
import { stableSensitiveFingerprint } from "../privacy/redaction.js";

type DbClient = PrismaClient | Prisma.TransactionClient;

function campaignIsRunning(campaign: { status: string; startsAt: Date; endsAt: Date; spentMinor: number; budgetMinor: number }) {
  const now = Date.now();
  return (
    campaign.status === "ACTIVE" &&
    campaign.startsAt.getTime() <= now &&
    campaign.endsAt.getTime() > now &&
    campaign.spentMinor < campaign.budgetMinor
  );
}

/**
 * Automatically binds an order to its pre-existing campaign assignment.
 * Holdout orders are observed too; they receive no offer and no incentive.
 */
export async function tryAutoAttributeOrder(
  db: DbClient,
  params: {
    merchantId: string;
    orderId: string;
    subjectKey: string;
  },
): Promise<void> {
  const subjectKeyHash = stableSensitiveFingerprint(params.subjectKey);

  const assignment = await db.campaignAssignment.findFirst({
    where: {
      subjectKeyHash,
      campaign: {
        merchantId: params.merchantId,
        status: "ACTIVE",
        startsAt: { lte: new Date() },
        endsAt: { gt: new Date() },
      },
    },
    include: {
      campaign: true,
    },
    orderBy: { createdAt: "desc" },
  });

  if (!assignment || !campaignIsRunning(assignment.campaign)) {
    return;
  }

  // Check if subject has reached conversion limit
  if (assignment.conversionCount >= assignment.campaign.maxUsesPerSubject) {
    return;
  }

  // Ensure order is not already attributed
  const existingAttribution = await db.campaignOrderAttribution.findUnique({
    where: { orderId: params.orderId },
  });

  if (existingAttribution) {
    return;
  }

  try {
    const attribution = await db.campaignOrderAttribution.create({
      data: {
        campaignId: assignment.campaignId,
        assignmentId: assignment.id,
        orderId: params.orderId,
      },
    });

    await appendLedgerEvent(db, {
      workflowId: `campaign-${assignment.campaignId}`,
      merchantId: params.merchantId,
      actorType: "SYSTEM",
      actionType: "CAMPAIGN_ORDER_ATTRIBUTED",
      conciseReason: `Auto-attribution: ${assignment.cohort === "CONTROL" ? "holdout" : "treatment"} assignment ${assignment.id} was bound to order ${params.orderId}.`,
      relatedEntityType: "CampaignOrderAttribution",
      relatedEntityId: attribution.id,
      executedAt: attribution.boundAt,
    }).catch(() => undefined);
  } catch {
    // Unique constraint race safely ignored
  }
}

/**
 * Automatically records campaign conversion when a payment is captured.
 */
export async function tryAutoConvertCampaignOnPaymentCapture(
  db: DbClient,
  paymentId: string,
): Promise<void> {
  const payment = await db.payment.findUnique({
    where: { id: paymentId },
    include: {
      order: {
        include: {
          items: { include: { variant: { select: { costMinor: true } } } },
          campaignAttributions: {
            include: {
              campaign: true,
              assignment: true,
            },
          },
        },
      },
    },
  });

  if (!payment || payment.state !== "CAPTURED") {
    return;
  }

  const attribution = payment.order.campaignAttributions[0];
  if (!attribution) {
    return;
  }

  const { campaign, assignment } = attribution;
  if (!campaign || !assignment) {
    return;
  }

  const alreadyConverted = await db.campaignConversion.findUnique({
    where: { paymentId: payment.id },
  });

  if (alreadyConverted) {
    return;
  }

  try {
    const config = await db.merchantGrowthConfig.findUnique({ where: { merchantId: payment.merchantId } });
    const incentiveCostMinor = assignment.cohort === "TREATMENT" ? campaign.incentiveMinorPerConversion : 0;
    const knownCosts = payment.order.items.length > 0 && payment.order.items.every((item) => item.variant.costMinor !== null);
    const productCostMinor = knownCosts
      ? payment.order.items.reduce((sum, item) => sum + (item.variant.costMinor ?? 0) * item.quantity, 0)
      : null;
    const shippingMinor = config?.defaultShippingCostMinor ?? 0;
    const paymentFeeMinor = Math.round(payment.order.totalAmountMinor * (config?.paymentFeeBps ?? 200) / 10_000);
    const returnCostMinor = Math.round(payment.order.totalAmountMinor * (config?.expectedReturnRateBps ?? 0) / 10_000);
    const contributionMinor = productCostMinor === null ? null : payment.order.totalAmountMinor - productCostMinor - shippingMinor - paymentFeeMinor - returnCostMinor - incentiveCostMinor;
    const conversion = await db.campaignConversion.create({
      data: {
        campaignId: campaign.id,
        assignmentId: assignment.id,
        paymentId: payment.id,
        orderId: payment.orderId,
        attributionId: attribution.id,
        observedRevenueMinor: payment.order.totalAmountMinor,
        incentiveCostMinor,
        observedProductCostMinor: productCostMinor,
        observedShippingCostMinor: shippingMinor,
        observedPaymentFeeMinor: paymentFeeMinor,
        expectedReturnCostMinor: returnCostMinor,
        observedContributionMinor: contributionMinor,
      },
    });

    await db.campaignAssignment.update({
      where: { id: assignment.id },
      data: {
        conversionCount: { increment: 1 },
        observedRevenueMinor: { increment: payment.order.totalAmountMinor },
      },
    });

    if (incentiveCostMinor > 0) {
      await db.campaign.update({ where: { id: campaign.id }, data: { spentMinor: { increment: incentiveCostMinor } } });
    }

    await appendLedgerEvent(db, {
      workflowId: `campaign-${campaign.id}`,
      merchantId: payment.merchantId,
      actorType: "SYSTEM",
      actionType: "CAMPAIGN_PAYMENT_CAPTURED_CONVERSION",
      conciseReason: `Auto-conversion: Captured payment ${payment.id} produced ${payment.order.totalAmountMinor} minor observed revenue for campaign "${campaign.name}".`,
      relatedEntityType: "CampaignConversion",
      relatedEntityId: conversion.id,
      metadata: {
        observedRevenueMinor: payment.order.totalAmountMinor,
        incentiveCostMinor: campaign.incentiveMinorPerConversion,
      },
      executedAt: conversion.createdAt,
    }).catch(() => undefined);
  } catch {
    // Unique constraint race safely ignored
  }
}
