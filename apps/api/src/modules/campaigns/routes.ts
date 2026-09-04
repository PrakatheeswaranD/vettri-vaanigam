import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../db/client.js";
import { computeCampaignLift } from "@razorgrowth/domain";
import { AppError } from "../../http/errors.js";
import { getAuthenticatedMerchantId } from "../authorization/demo-context.js";
import { requireApprovalRole, requireOwnerRole } from "../auth/middleware.js";
import { appendLedgerEvent } from "../audit/ledger.js";
import { stableSensitiveFingerprint } from "../privacy/redaction.js";

const createCampaignSchema = z
  .object({
    name: z.string().min(1).max(120),
    actionType: z.enum(["CROSS_SELL", "UPSELL", "BUNDLE", "BOUNDED_OFFER", "RECOVERY"]),
    budgetMinor: z.number().int().min(0).max(1_000_000_000),
    incentiveMinorPerConversion: z.number().int().min(0).max(1_000_000_000),
    maxUsesPerSubject: z.number().int().min(1).max(100).default(1),
    controlPercentBps: z.number().int().min(0).max(9_000).default(1_000),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
  })
  .refine((body) => body.endsAt > body.startsAt, { message: "endsAt must be after startsAt" })
  .refine((body) => body.incentiveMinorPerConversion <= body.budgetMinor, {
    message: "incentiveMinorPerConversion cannot exceed budgetMinor",
  });

function campaignIsRunning(campaign: { status: string; startsAt: Date; endsAt: Date; spentMinor: number; budgetMinor: number }) {
  const now = Date.now();
  return (
    campaign.status === "ACTIVE" &&
    campaign.startsAt.getTime() <= now &&
    campaign.endsAt.getTime() > now &&
    campaign.spentMinor < campaign.budgetMinor
  );
}

function cohortFor(campaignId: string, subjectKeyHash: string, controlPercentBps: number): "CONTROL" | "TREATMENT" {
  const bucket = Number.parseInt(stableSensitiveFingerprint(`${campaignId}:${subjectKeyHash}`).slice(0, 8), 16) % 10_000;
  return bucket < controlPercentBps ? "CONTROL" : "TREATMENT";
}

export function registerCampaignRoutes(app: FastifyInstance, prefix: string): void {
  app.post(`${prefix}/campaigns`, async (request, reply) => {
    const merchantId = getAuthenticatedMerchantId(request);
    requireOwnerRole(request);
    const body = createCampaignSchema.parse(request.body);
    const campaign = await prisma.campaign.create({
      data: { ...body, merchantId, createdById: request.merchantUserId },
    });
    await appendLedgerEvent(prisma, {
      workflowId: `campaign-${campaign.id}`,
      merchantId,
      actorType: "MERCHANT_USER",
      actionType: "CAMPAIGN_CREATED",
      status: "PROPOSED",
      conciseReason: `Campaign "${campaign.name}" created with a bounded budget of ${campaign.budgetMinor} minor units.`,
      relatedEntityType: "Campaign",
      relatedEntityId: campaign.id,
      executedAt: new Date(),
    });
    return reply.status(201).send(campaign);
  });

  app.get(`${prefix}/campaigns`, async (request) => {
    const merchantId = getAuthenticatedMerchantId(request);
    return {
      items: await prisma.campaign.findMany({ where: { merchantId }, orderBy: { createdAt: "desc" }, take: 100 }),
    };
  });

  app.post(`${prefix}/campaigns/:campaignId/status`, async (request) => {
    const merchantId = getAuthenticatedMerchantId(request);
    requireOwnerRole(request);
    const { campaignId } = request.params as { campaignId: string };
    const body = z.object({ status: z.enum(["ACTIVE", "PAUSED", "COMPLETED"]) }).parse(request.body);
    const existing = await prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!existing || existing.merchantId !== merchantId) throw AppError.notFound(`No campaign ${campaignId}.`);
    if (existing.status === "COMPLETED") throw AppError.conflict("A completed campaign is final.");

    const updated = await prisma.campaign.update({ where: { id: campaignId }, data: { status: body.status } });
    await appendLedgerEvent(prisma, {
      workflowId: `campaign-${campaignId}`,
      merchantId,
      actorType: "MERCHANT_USER",
      actionType: `CAMPAIGN_${body.status}`,
      status: body.status === "PAUSED" ? "REJECTED" : "EXECUTED",
      conciseReason: `Campaign status changed from ${existing.status} to ${body.status} by an owner.`,
      relatedEntityType: "Campaign",
      relatedEntityId: campaignId,
      executedAt: new Date(),
    });
    return updated;
  });

  app.post(`${prefix}/campaigns/:campaignId/assign`, async (request) => {
    const merchantId = getAuthenticatedMerchantId(request);
    requireApprovalRole(request);
    const { campaignId } = request.params as { campaignId: string };
    const { subjectKey } = z.object({ subjectKey: z.string().min(1).max(320) }).parse(request.body);
    const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign || campaign.merchantId !== merchantId) throw AppError.notFound(`No campaign ${campaignId}.`);
    if (!campaignIsRunning(campaign)) {
      return { eligible: false, reason: "CAMPAIGN_NOT_RUNNING", cohort: null };
    }

    const subjectKeyHash = stableSensitiveFingerprint(subjectKey.trim().toLowerCase());
    const cohort = cohortFor(campaign.id, subjectKeyHash, campaign.controlPercentBps);
    const assignment = await prisma.campaignAssignment.upsert({
      where: { campaignId_subjectKeyHash: { campaignId, subjectKeyHash } },
      create: { campaignId, subjectKeyHash, cohort, impressionCount: 1 },
      update: { impressionCount: { increment: 1 } },
    });
    return {
      assignmentId: assignment.id,
      eligible: assignment.cohort === "TREATMENT" && assignment.conversionCount < campaign.maxUsesPerSubject,
      cohort: assignment.cohort,
      // CONTROL is explicit so the caller cannot accidentally render the
      // offer while still believing the request succeeded.
      reason:
        assignment.cohort === "CONTROL"
          ? "CONTROL_GROUP_NO_OFFER"
          : assignment.conversionCount >= campaign.maxUsesPerSubject
            ? "SUBJECT_USE_LIMIT_REACHED"
            : "TREATMENT_ELIGIBLE",
    };
  });

  app.post(`${prefix}/campaigns/:campaignId/attributions`, async (request, reply) => {
    const merchantId = getAuthenticatedMerchantId(request);
    requireApprovalRole(request);
    const { campaignId } = request.params as { campaignId: string };
    const body = z.object({ assignmentId: z.string().uuid(), orderId: z.string().uuid() }).parse(request.body);
    const [campaign, assignment, order] = await Promise.all([
      prisma.campaign.findUnique({ where: { id: campaignId } }),
      prisma.campaignAssignment.findUnique({ where: { id: body.assignmentId } }),
      prisma.order.findUnique({ where: { id: body.orderId } }),
    ]);
    if (
      !campaign || campaign.merchantId !== merchantId ||
      !assignment || assignment.campaignId !== campaignId ||
      !order || order.merchantId !== merchantId
    ) {
      throw AppError.notFound("Eligible campaign assignment and order were not found.");
    }
    if (!campaignIsRunning(campaign)) throw AppError.conflict("This campaign is not running.");
    if (order.status !== "PENDING" && order.status !== "PAYMENT_PENDING") {
      throw AppError.conflict("Campaign attribution must be bound before payment is captured.");
    }
    if (order.createdAt.getTime() < assignment.createdAt.getTime()) {
      throw AppError.conflict("An order created before assignment cannot be attributed to this campaign.");
    }
    const attribution = await prisma.campaignOrderAttribution.create({
      data: { campaignId, assignmentId: assignment.id, orderId: order.id },
    }).catch((error) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw AppError.conflict("This order is already bound to a campaign attribution.");
      }
      throw error;
    });
    await appendLedgerEvent(prisma, {
      workflowId: `campaign-${campaignId}`,
      merchantId,
      actorType: "SYSTEM",
      actionType: "CAMPAIGN_ORDER_ATTRIBUTED",
      status: "EXECUTED",
      conciseReason: `${assignment.cohort === "CONTROL" ? "Holdout observation" : "Treatment assignment"} ${assignment.id} was bound to order ${order.id} before capture.`,
      relatedEntityType: "CampaignOrderAttribution",
      relatedEntityId: attribution.id,
      executedAt: attribution.boundAt,
    });
    return reply.status(201).send(attribution);
  });

  app.post(`${prefix}/campaigns/:campaignId/conversions`, async (request) => {
    const merchantId = getAuthenticatedMerchantId(request);
    requireApprovalRole(request);
    const { campaignId } = request.params as { campaignId: string };
    const body = z
      .object({
        assignmentId: z.string().uuid(),
        paymentId: z.string().uuid(),
      })
      .parse(request.body);

    let result: Awaited<ReturnType<typeof recordConversion>>;
    try {
      result = await recordConversion();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw AppError.conflict("This captured payment has already been attributed to a campaign conversion.");
      }
      throw error;
    }

    async function recordConversion() {
      return prisma.$transaction(async (tx) => {
      const campaign = await tx.campaign.findUnique({ where: { id: campaignId } });
      const assignment = await tx.campaignAssignment.findUnique({ where: { id: body.assignmentId } });
      const payment = await tx.payment.findUnique({
        where: { id: body.paymentId },
        include: { order: { include: { items: { include: { variant: { select: { costMinor: true } } } } } } },
      });
      if (!campaign || campaign.merchantId !== merchantId || !assignment || assignment.campaignId !== campaignId) {
        throw AppError.notFound("Campaign assignment not found.");
      }
      if (!payment || payment.merchantId !== merchantId || payment.order.merchantId !== merchantId) {
        throw AppError.notFound("Captured payment evidence not found.");
      }
      if (payment.state !== "CAPTURED") {
        throw AppError.conflict("Campaign revenue can be observed only from a captured payment.");
      }
      const attribution = await tx.campaignOrderAttribution.findUnique({ where: { orderId: payment.order.id } });
      if (
        !attribution ||
        attribution.campaignId !== campaignId ||
        attribution.assignmentId !== assignment.id ||
        attribution.boundAt.getTime() > (payment.capturedAt?.getTime() ?? 0) ||
        payment.order.createdAt.getTime() < assignment.createdAt.getTime()
      ) {
        throw AppError.conflict("This payment is not backed by a pre-capture order attribution for the assignment.");
      }
      const alreadyAttributed = await tx.campaignConversion.findUnique({ where: { paymentId: payment.id } });
      if (alreadyAttributed) {
        throw AppError.conflict("This captured payment has already been attributed to a campaign conversion.");
      }
      if (!campaignIsRunning(campaign)) throw AppError.conflict("This campaign is not running.");

      const assignmentClaim = await tx.campaignAssignment.updateMany({
        where: {
          id: assignment.id,
          conversionCount: { lt: campaign.maxUsesPerSubject },
        },
        data: {
          conversionCount: { increment: 1 },
          observedRevenueMinor: { increment: payment.order.totalAmountMinor },
        },
      });
      if (assignmentClaim.count !== 1) {
        throw AppError.conflict("This subject has reached the campaign use limit.");
      }

      const incentiveCostMinor = assignment.cohort === "TREATMENT" ? campaign.incentiveMinorPerConversion : 0;
      if (incentiveCostMinor > 0) {
        const budgetClaim = await tx.campaign.updateMany({
          where: {
            id: campaignId,
            status: "ACTIVE",
            startsAt: { lte: new Date() },
            endsAt: { gt: new Date() },
            spentMinor: { lte: campaign.budgetMinor - incentiveCostMinor },
          },
          data: { spentMinor: { increment: incentiveCostMinor } },
        });
        if (budgetClaim.count !== 1) {
          throw new AppError("POLICY_DENIED", "This conversion would exceed the campaign budget.");
        }
      }

      const config = await tx.merchantGrowthConfig.findUnique({ where: { merchantId } });
      const knownCosts = payment.order.items.length > 0 && payment.order.items.every((item) => item.variant.costMinor !== null);
      const productCostMinor = knownCosts
        ? payment.order.items.reduce((sum, item) => sum + (item.variant.costMinor ?? 0) * item.quantity, 0)
        : null;
      const shippingMinor = config?.defaultShippingCostMinor ?? 0;
      const paymentFeeMinor = Math.round(payment.order.totalAmountMinor * (config?.paymentFeeBps ?? 200) / 10_000);
      const returnCostMinor = Math.round(payment.order.totalAmountMinor * (config?.expectedReturnRateBps ?? 0) / 10_000);
      const contributionMinor = productCostMinor === null
        ? null
        : payment.order.totalAmountMinor - productCostMinor - shippingMinor - paymentFeeMinor - returnCostMinor - incentiveCostMinor;

      const conversion = await tx.campaignConversion.create({
        data: {
          campaignId,
          assignmentId: assignment.id,
          paymentId: payment.id,
          orderId: payment.order.id,
          attributionId: attribution.id,
          incentiveCostMinor,
          observedRevenueMinor: payment.order.totalAmountMinor,
          observedProductCostMinor: productCostMinor,
          observedShippingCostMinor: shippingMinor,
          observedPaymentFeeMinor: paymentFeeMinor,
          expectedReturnCostMinor: returnCostMinor,
          observedContributionMinor: contributionMinor,
        },
      });
      return { conversion, assignmentId: assignment.id };
      });
    }

    await appendLedgerEvent(prisma, {
      workflowId: `campaign-${campaignId}`,
      merchantId,
      actorType: "SYSTEM",
      actionType: "CAMPAIGN_CONVERSION_RECORDED",
      status: "EXECUTED",
      conciseReason: `Recorded one campaign conversion from captured payment ${body.paymentId}; incentive cost ${result.conversion.incentiveCostMinor}, observed revenue ${result.conversion.observedRevenueMinor} minor units.`,
      relatedEntityType: "CampaignConversion",
      relatedEntityId: result.conversion.id,
      metadata: { assignmentId: result.assignmentId, paymentId: body.paymentId },
      executedAt: new Date(),
    });

    // Automatic stop-loss is evaluated only from an actual holdout. A
    // campaign is never paused because of an unmeasured hunch.
    const [stopConfig, stopCampaign, stopAssignments] = await Promise.all([
      prisma.merchantGrowthConfig.findUnique({ where: { merchantId } }),
      prisma.campaign.findUnique({ where: { id: campaignId } }),
      prisma.campaignAssignment.findMany({ where: { campaignId } }),
    ]);
    if (stopCampaign?.status === "ACTIVE" && stopCampaign.budgetMinor > 0) {
      const cohort = (name: string) => {
        const rows = stopAssignments.filter((row) => row.cohort === name);
        return {
          subjects: rows.length,
          impressions: rows.reduce((sum, row) => sum + row.impressionCount, 0),
          conversions: rows.reduce((sum, row) => sum + row.conversionCount, 0),
          observedRevenueMinor: rows.reduce((sum, row) => sum + row.observedRevenueMinor, 0),
        };
      };
      const lift = computeCampaignLift(cohort("TREATMENT"), cohort("CONTROL"));
      const spentBps = Math.round(stopCampaign.spentMinor * 10_000 / stopCampaign.budgetMinor);
      const stopAt = stopConfig?.automaticStopLossBps ?? 2_000;
      if (lift.basis === "MEASURED_AGAINST_HOLDOUT" && (lift.liftBps ?? 0) < 0 && spentBps >= stopAt) {
        const paused = await prisma.campaign.updateMany({ where: { id: campaignId, status: "ACTIVE" }, data: { status: "PAUSED" } });
        if (paused.count === 1) {
          await appendLedgerEvent(prisma, {
            workflowId: `campaign-${campaignId}`,
            merchantId,
            actorType: "SYSTEM",
            actionType: "CAMPAIGN_AUTO_PAUSED",
            status: "REJECTED",
            conciseReason: `Campaign automatically paused: measured conversion lift was ${lift.liftBps} bps and spend reached ${spentBps} bps of budget.`,
            relatedEntityType: "Campaign",
            relatedEntityId: campaignId,
            metadata: { liftBps: lift.liftBps, statisticalConfidenceBps: lift.statisticalConfidenceBps, spentBps, stopAtBps: stopAt },
            executedAt: new Date(),
          });
        }
      }
    }
    return result.conversion;
  });

  app.get(`${prefix}/campaigns-summary`, async (request) => {
    const merchantId = getAuthenticatedMerchantId(request);
    const campaigns = await prisma.campaign.findMany({
      where: { merchantId },
      include: { assignments: true, conversions: { select: { assignmentId: true, observedContributionMinor: true, incentiveCostMinor: true } } },
    });
    let estimatedIncrementalRevenueMinor = 0;
    let estimatedIncrementalMarginMinor = 0;
    let measuredCampaigns = 0;
    let allMeasuredMarginsKnown = true;
    let warnings = 0;
    for (const campaign of campaigns) {
      const cohort = (name: string) => {
        const rows = campaign.assignments.filter((row) => row.cohort === name);
        return { subjects: rows.length, impressions: rows.reduce((sum, row) => sum + row.impressionCount, 0), conversions: rows.reduce((sum, row) => sum + row.conversionCount, 0), observedRevenueMinor: rows.reduce((sum, row) => sum + row.observedRevenueMinor, 0) };
      };
      const treatment = cohort("TREATMENT");
      const control = cohort("CONTROL");
      const lift = computeCampaignLift(treatment, control);
      if (lift.basis !== "MEASURED_AGAINST_HOLDOUT") continue;
      measuredCampaigns += 1;
      // Compare revenue per assigned subject; repeat impressions are not
      // independent customers. This is a holdout estimate, not proven causality.
      estimatedIncrementalRevenueMinor += Math.round(treatment.observedRevenueMinor - control.observedRevenueMinor * treatment.subjects / control.subjects);
      if ((lift.liftBps ?? 0) <= 0) warnings += 1;
      const knownMargins = campaign.conversions.length > 0 && campaign.conversions.every((conversion) => conversion.observedContributionMinor !== null);
      if (!knownMargins) allMeasuredMarginsKnown = false;
      if (knownMargins && control.subjects > 0) {
        const contributionFor = (name: string) => campaign.conversions
          .filter((conversion) => campaign.assignments.some((assignment) => assignment.id === conversion.assignmentId && assignment.cohort === name))
          .reduce((sum, conversion) => sum + (conversion.observedContributionMinor ?? 0), 0);
        estimatedIncrementalMarginMinor += Math.round(contributionFor("TREATMENT") - contributionFor("CONTROL") * treatment.subjects / control.subjects);
      }
    }
    return { estimatedIncrementalRevenueMinor: measuredCampaigns > 0 ? estimatedIncrementalRevenueMinor : null, estimatedIncrementalMarginMinor: measuredCampaigns > 0 && allMeasuredMarginsKnown ? estimatedIncrementalMarginMinor : null, measuredCampaigns, warnings, currency: "INR" as const };
  });

  app.get(`${prefix}/campaigns/:campaignId/metrics`, async (request) => {
    const merchantId = getAuthenticatedMerchantId(request);
    const { campaignId } = request.params as { campaignId: string };
    const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign || campaign.merchantId !== merchantId) throw AppError.notFound(`No campaign ${campaignId}.`);
    const assignments = await prisma.campaignAssignment.findMany({
      where: { campaignId },
      include: { conversions: { select: { observedContributionMinor: true, incentiveCostMinor: true } } },
    });
    const summarize = (cohort: string) => {
      const rows = assignments.filter((row) => row.cohort === cohort);
      const impressions = rows.reduce((sum, row) => sum + row.impressionCount, 0);
      const conversions = rows.reduce((sum, row) => sum + row.conversionCount, 0);
      return {
        subjects: rows.length,
        impressions,
        conversions,
        conversionRateBps: impressions === 0 ? 0 : Math.floor((conversions * 10_000) / impressions),
        observedRevenueMinor: rows.reduce((sum, row) => sum + row.observedRevenueMinor, 0),
        observedContributionMinor: rows.every((row) => row.conversions.every((conversion) => conversion.observedContributionMinor !== null))
          ? rows.reduce((sum, row) => sum + row.conversions.reduce((inner, conversion) => inner + (conversion.observedContributionMinor ?? 0), 0), 0)
          : null,
        incentiveCostMinor: rows.reduce((sum, row) => sum + row.conversions.reduce((inner, conversion) => inner + conversion.incentiveCostMinor, 0), 0),
      };
    };
    const treatment = summarize("TREATMENT");
    const control = summarize("CONTROL");
    // The holdout was always assigned and never compared. Computing the
    // difference here — in the one place a real control group exists —
    // is what turns "we ran a campaign" into "the offer caused this".
    const lift = computeCampaignLift(treatment, control);
    const incrementalMarginMinor = lift.basis === "MEASURED_AGAINST_HOLDOUT" && treatment.observedContributionMinor !== null && control.observedContributionMinor !== null && control.impressions > 0
      ? Math.round(treatment.observedContributionMinor - control.observedContributionMinor * treatment.impressions / control.impressions)
      : null;
    const cannibalisationRisk = lift.basis !== "MEASURED_AGAINST_HOLDOUT"
      ? "UNKNOWN"
      : (lift.liftBps ?? 0) <= 0 || (lift.attributableRevenueMinor ?? 0) <= treatment.incentiveCostMinor
        ? "HIGH"
        : "LOW";
    return { campaign, treatment, control, lift, profit: { incrementalMarginMinor, cannibalisationRisk, costsComplete: treatment.observedContributionMinor !== null && control.observedContributionMinor !== null } };
  });
}
