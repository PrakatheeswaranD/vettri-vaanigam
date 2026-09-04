import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../db/client.js";
import { AppError } from "../../http/errors.js";
import { getAuthenticatedMerchantId } from "../authorization/demo-context.js";
import { requireApprovalRole, requireOwnerRole } from "../auth/middleware.js";
import { appendLedgerEvent } from "../audit/ledger.js";
import { getRevenueOpportunityReport } from "../growth/revenue-evidence-service.js";
import { getGrowthConfig } from "../merchant-agent/repository.js";

function weekStartUtc(now = new Date()): Date {
  const result = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = result.getUTCDay();
  result.setUTCDate(result.getUTCDate() - (day === 0 ? 6 : day - 1));
  return result;
}

export function nextAllowedSend(startHour: number, endHour: number, now = new Date()): Date {
  const hour = now.getUTCHours();
  const isQuiet = startHour > endHour ? hour >= startHour || hour < endHour : hour >= startHour && hour < endHour;
  if (!isQuiet) return now;
  const next = new Date(now);
  if (startHour > endHour && hour >= startHour) next.setUTCDate(next.getUTCDate() + 1);
  next.setUTCHours(endHour, 0, 0, 0);
  return next;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

const communicationTypes = new Set(["REPEAT_PURCHASE", "CUSTOMER_REACTIVATION", "ABANDONED_CHECKOUT_RECOVERY"]);

export function registerGrowthPlanRoutes(app: FastifyInstance, prefix: string): void {
  app.get(`${prefix}/growth-plans/current`, async (request) => {
    const merchantId = getAuthenticatedMerchantId(request);
    return prisma.growthPlan.findUnique({
      where: { merchantId_weekStart: { merchantId, weekStart: weekStartUtc() } },
      include: { items: { orderBy: [{ priority: "desc" }, { createdAt: "asc" }] } },
    });
  });

  app.post(`${prefix}/growth-plans/generate`, async (request, reply) => {
    const merchantId = getAuthenticatedMerchantId(request);
    requireApprovalRole(request);
    const existing = await prisma.growthPlan.findUnique({
      where: { merchantId_weekStart: { merchantId, weekStart: weekStartUtc() } },
      include: { items: { orderBy: { priority: "desc" } } },
    });
    if (existing) return reply.send(existing);
    const [report, config] = await Promise.all([getRevenueOpportunityReport(prisma, merchantId), getGrowthConfig(prisma, merchantId)]);
    const excluded = new Set([...stringArray(config.excludedProductIds), ...stringArray(config.excludedCustomerIds)]);
    const candidates = report.opportunities
      .filter((item) => item.policy.outcome !== "BLOCKED" && item.status !== "ACTIONED" && !item.subjectIds.some((id) => excluded.has(id)))
      .slice(0, 12);
    const expectedRevenueMinor = candidates.reduce((sum, item) => sum + (item.expectedEffect.expectedIncrementalValue?.amountMinor ?? 0), 0);
    const plan = await prisma.growthPlan.upsert({
      where: { merchantId_weekStart: { merchantId, weekStart: weekStartUtc() } },
      // A weekly snapshot is immutable: regeneration must never erase an
      // approval, completed work, or the IDs used for execution deduplication.
      update: {},
      create: {
        merchantId,
        weekStart: weekStartUtc(),
        summary: `This week the agent found ${candidates.length} governed opportunities worth approximately ${expectedRevenueMinor} minor units in expected incremental revenue.`,
        estimatedRevenueMinor: expectedRevenueMinor,
        estimatedProfitMinor: null,
        items: {
          create: candidates.map((item) => ({
            opportunityId: item.id,
            opportunityType: item.type,
            title: item.title,
            proposedAction: item.proposedAction,
            subjectIds: item.subjectIds,
            priority: item.score.priority,
            confidence: item.confidence,
            customersAffected: item.customersAffected,
            expectedRevenueMinor: item.expectedEffect.expectedIncrementalValue?.amountMinor ?? null,
            expectedProfitMinor: null,
          })),
        },
      },
      include: { items: { orderBy: { priority: "desc" } } },
    });
    await appendLedgerEvent(prisma, {
      workflowId: `growth-plan-${plan.id}`,
      merchantId,
      actorType: "MERCHANT_AGENT",
      actionType: "WEEKLY_GROWTH_PLAN_PROPOSED",
      status: "PROPOSED",
      conciseReason: plan.summary,
      relatedEntityType: "GrowthPlan",
      relatedEntityId: plan.id,
      metadata: { opportunityCount: candidates.length, estimatedRevenueMinor: expectedRevenueMinor },
      executedAt: new Date(),
    });
    return reply.status(201).send(plan);
  });

  app.post(`${prefix}/growth-plans/:planId/approve`, async (request) => {
    const merchantId = getAuthenticatedMerchantId(request);
    requireOwnerRole(request);
    const { planId } = request.params as { planId: string };
    const requested = z.object({ budgetMinor: z.number().int().min(0), maxCustomerContacts: z.number().int().min(0) }).parse(request.body);
    const [plan, config] = await Promise.all([
      prisma.growthPlan.findFirst({ where: { id: planId, merchantId }, include: { items: true } }),
      getGrowthConfig(prisma, merchantId),
    ]);
    if (!plan) throw AppError.notFound(`No growth plan ${planId}.`);
    if (plan.status !== "PENDING_APPROVAL") throw AppError.conflict("Only a pending weekly plan can be approved.");
    if (!config.growthActionsEnabled) throw new AppError("POLICY_DENIED", "Growth actions are disabled.");
    if (requested.budgetMinor > config.weeklyCampaignBudgetMinor) throw new AppError("POLICY_DENIED", "Plan budget exceeds the weekly campaign boundary.");
    const contactCeiling = config.maxCustomersContactedPerDay * 7;
    if (requested.maxCustomerContacts > contactCeiling) throw new AppError("POLICY_DENIED", "Plan contacts exceed the weekly portfolio boundary.");

    const approved = await prisma.$transaction(async (tx) => {
      const claimed = await tx.growthPlan.updateMany({
        where: { id: planId, merchantId, status: "PENDING_APPROVAL" },
        data: { status: "APPROVED", approvedBudgetMinor: requested.budgetMinor, approvedCustomerContacts: requested.maxCustomerContacts, approvedById: request.merchantUserId, approvedAt: new Date() },
      });
      if (claimed.count !== 1) throw AppError.conflict("This plan was already decided.");
      for (const item of plan.items) {
        await tx.agentJob.upsert({
          where: { idempotencyKey: `growth-plan:${planId}:${item.id}` },
          update: {},
          create: { merchantId, type: communicationTypes.has(item.opportunityType) ? "OUTBOUND_COMMUNICATION" : "GROWTH_ACTION", payload: { planId, planItemId: item.id }, idempotencyKey: `growth-plan:${planId}:${item.id}` },
        });
      }
      await appendLedgerEvent(tx, {
      workflowId: `growth-plan-${plan.id}`,
      merchantId,
      actorType: "MERCHANT_USER",
      actionType: "WEEKLY_GROWTH_PLAN_AUTHORIZED",
      status: "APPROVED",
      conciseReason: `Weekly plan approved once with a ${requested.budgetMinor} minor-unit budget and ${requested.maxCustomerContacts}-customer contact ceiling.`,
      relatedEntityType: "GrowthPlan",
      relatedEntityId: plan.id,
      metadata: requested,
      executedAt: new Date(),
      });
      return tx.growthPlan.findUniqueOrThrow({ where: { id: planId }, include: { items: true } });
    });
    return approved;
  });

  app.post(`${prefix}/growth-plans/:planId/run`, async (request) => {
    const merchantId = getAuthenticatedMerchantId(request);
    requireApprovalRole(request);
    const { planId } = request.params as { planId: string };
    const plan = await prisma.growthPlan.findFirst({ where: { id: planId, merchantId }, include: { items: true } });
    if (!plan) throw AppError.notFound(`No growth plan ${planId}.`);
    if (!['APPROVED', 'EXECUTING'].includes(plan.status)) throw AppError.conflict("Approve this weekly plan before running it.");
    const config = await getGrowthConfig(prisma, merchantId);
    if (!config.growthActionsEnabled) throw new AppError("POLICY_DENIED", "Growth actions are disabled.");
    if (plan.approvedBudgetMinor > config.weeklyCampaignBudgetMinor || plan.approvedCustomerContacts > config.maxCustomersContactedPerDay * 7) {
      throw new AppError("POLICY_DENIED", "The approved plan exceeds the current boundaries. Review it before proceeding.");
    }
    const jobs = await prisma.agentJob.findMany({ where: { merchantId, status: "QUEUED", nextAttemptAt: { lte: new Date() }, payload: { path: ["planId"], equals: planId } }, orderBy: { createdAt: "asc" } });
    const completed = 0;
    let waiting = 0;
    for (const job of jobs) {
      const claimed = await prisma.agentJob.updateMany({ where: { id: job.id, status: "QUEUED", lockedAt: null, nextAttemptAt: { lte: new Date() } }, data: { status: "RUNNING", lockedAt: new Date(), attempts: { increment: 1 } } });
      if (claimed.count !== 1) continue;
      const payload = job.payload as { planItemId: string };
      const item = plan.items.find((candidate) => candidate.id === payload.planItemId);
      try {
        if (!item) throw new Error("The job references a missing plan item.");
        if (job.type === "OUTBOUND_COMMUNICATION") {
          const excludedCustomerIds = stringArray(config.excludedCustomerIds);
          const channels = stringArray(config.outboundChannels);
          const subjects = stringArray(item.subjectIds);
          const recipients = item.opportunityType === "ABANDONED_CHECKOUT_RECOVERY"
            ? (await prisma.order.findMany({ where: { merchantId, id: { in: subjects } }, select: { customerId: true } })).map((order) => order.customerId).filter((id): id is string => id !== null)
            : subjects;
          const customerIds = [...new Set(recipients)].filter((id) => !excludedCustomerIds.includes(id)).slice(0, plan.approvedCustomerContacts);
          for (const customerId of customerIds) {
            const customer = await prisma.customer.findFirst({ where: { id: customerId, merchantId } });
            if (!customer) continue;
            const channel = channels[0];
            if (!channel) continue;
            const consent = customer.marketingConsent as Record<string, boolean>;
            if (config.consentRequired && consent[channel] !== true) continue;
            // Serializable predicate reads prevent concurrent plan jobs from
            // collectively exceeding a contact ceiling. A conflict retries the
            // durable job; its message idempotency keys preserve prior work.
            await prisma.$transaction(async (tx) => {
              const now = new Date();
              const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
              const active = { merchantId, status: { not: "CANCELLED" } };
              const idempotencyKey = `plan-item:${item.id}:customer:${customerId}:channel:${channel}`;
              if (await tx.outboundMessage.findUnique({ where: { idempotencyKey } })) return;
              const contacts = await tx.outboundMessage.count({ where: { ...active, customerId, createdAt: { gte: new Date(now.getTime() - 7 * 86_400_000) } } });
              const dailyContacts = await tx.outboundMessage.count({ where: { ...active, createdAt: { gte: dayStart } } });
              const planContacts = await tx.outboundMessage.count({ where: { ...active, planItem: { planId } } });
              const recentContact = await tx.outboundMessage.findFirst({ where: { ...active, customerId, createdAt: { gt: new Date(now.getTime() - config.campaignCooldownHours * 3_600_000) } }, select: { id: true } });
              if (contacts >= config.maxContactsPerCustomerPerWeek || dailyContacts >= config.maxCustomersContactedPerDay || planContacts >= plan.approvedCustomerContacts || recentContact) return;
              await tx.outboundMessage.create({
                data: { merchantId, customerId, planItemId: item.id, channel, purpose: item.opportunityType, content: item.title, consentEvidence: { channel, granted: consent[channel] === true, checkedAt: now.toISOString() }, idempotencyKey, nextAttemptAt: nextAllowedSend(config.quietHoursStart, config.quietHoursEnd, now) },
              });
            }, { isolationLevel: "Serializable" });
          }
          const queued = await prisma.outboundMessage.count({ where: { merchantId, planItemId: item.id } });
          await prisma.growthPlanItem.update({ where: { id: item.id }, data: { status: queued > 0 ? "QUEUED" : "BLOCKED", result: queued > 0 ? `${queued} message drafts queued. Delivery is pending a configured provider adapter.` : "No eligible, consented recipients within the contact boundaries." } });
          waiting += 1;
        } else {
          await prisma.growthPlanItem.update({ where: { id: item.id }, data: { status: "BLOCKED", result: "This action requires an integrated executor with per-action policy and budget enforcement. No action has been executed." } });
          waiting += 1;
        }
        await prisma.agentJob.update({ where: { id: job.id }, data: { status: "COMPLETED", lockedAt: null } });
      } catch (error) {
        const attempts = job.attempts + 1;
        await prisma.agentJob.update({ where: { id: job.id }, data: { status: attempts >= job.maxAttempts ? "DEAD_LETTER" : "QUEUED", lockedAt: null, lastError: error instanceof Error ? error.message : "Unknown job failure", nextAttemptAt: new Date(Date.now() + Math.min(3_600_000, 2 ** attempts * 1_000)) } });
      }
    }
    const remaining = await prisma.agentJob.count({ where: { merchantId, payload: { path: ["planId"], equals: planId }, status: { in: ["QUEUED", "RUNNING"] } } });
    const unresolved = await prisma.growthPlanItem.count({ where: { planId, status: { notIn: ["COMPLETED", "CANCELLED"] } } });
    const updated = await prisma.growthPlan.update({ where: { id: planId }, data: { status: remaining === 0 && unresolved === 0 ? "COMPLETED" : remaining > 0 ? "EXECUTING" : "WAITING" }, include: { items: true } });
    return { plan: updated, completed, waiting, remaining };
  });

  app.patch(`${prefix}/customers/:customerId/communication-consent`, async (request) => {
    const merchantId = getAuthenticatedMerchantId(request);
    requireApprovalRole(request);
    const { customerId } = request.params as { customerId: string };
    const body = z.object({ channel: z.enum(["EMAIL", "WHATSAPP", "SMS", "PUSH", "BUYER_AGENT"]), granted: z.boolean() }).parse(request.body);
    const customer = await prisma.customer.findFirst({ where: { id: customerId, merchantId } });
    if (!customer) throw AppError.notFound(`No customer ${customerId}.`);
    const previous = customer.marketingConsent as Record<string, boolean>;
    return prisma.customer.update({ where: { id: customerId }, data: { marketingConsent: { ...previous, [body.channel]: body.granted } } });
  });

  app.get(`${prefix}/outbound-messages`, async (request) => {
    const merchantId = getAuthenticatedMerchantId(request);
    return { items: await prisma.outboundMessage.findMany({ where: { merchantId }, orderBy: { createdAt: "desc" }, take: 100 }) };
  });

  app.post(`${prefix}/outbound-messages/:messageId/events`, async (request) => {
    const merchantId = getAuthenticatedMerchantId(request);
    requireApprovalRole(request);
    const { messageId } = request.params as { messageId: string };
    const message = await prisma.outboundMessage.findFirst({ where: { id: messageId, merchantId } });
    if (!message) throw AppError.notFound(`No outbound message ${messageId}.`);
    // A merchant assertion (even with a reference string) is not provider
    // evidence. Only authenticated callbacks and captured-order attribution
    // may eventually write these states; no adapter is installed here yet.
    throw new AppError("POLICY_DENIED", "Delivery and conversion events require verified provider evidence; manual status assertions are not accepted.");
  });
}
