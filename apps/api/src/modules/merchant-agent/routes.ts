/**
 * Merchant Agent API (PART 04 §79-§81).
 *
 * Deliberately narrow: propose, read one, list recent, and read the
 * non-secret growth configuration a jury/demo panel can inspect.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  agentToolInvocationRequestSchema,
  agentToolInvocationResultSchema,
  agentToolsResponseSchema,
  growthProposalRequestSchema,
  merchantGrowthConfigSchema,
  merchantGrowthConfigUpdateSchema,
} from "@razorgrowth/contracts";
import { prisma } from "../../db/client.js";
import { AppError } from "../../http/errors.js";
import { AGENT_TOOLS, classifyToolError, findTool } from "./tools.js";
import { randomUUID } from "node:crypto";
import { getAuthenticatedMerchantId } from "../authorization/demo-context.js";
import { requireOwnerRole } from "../auth/middleware.js";
import { appendLedgerEvent } from "../audit/ledger.js";
import { getGrowthConfig, updateGrowthConfig } from "./repository.js";
import { getGrowthProposal, listGrowthProposals, proposeGrowthAction } from "./service.js";
import { runAutonomousCycle } from "./autonomous-run-service.js";
import { getAgentStatus } from "./status-service.js";

const proposalParamsSchema = z.object({ id: z.string().uuid() });
const listQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) });

export function registerMerchantAgentRoutes(app: FastifyInstance, prefix: string): void {
  /**
   * One autonomous cycle: detect, propose, validate, apply policy, and
   * then either execute inside the merchant's own automatic-approval
   * limits or stop and wait for them.
   *
   * A POST because it changes state — it can create proposals, issue
   * authorizations and open new checkouts. It is deliberately merchant-
   * triggered rather than a background timer: a scheduler that moves
   * money while nobody is looking is a different product decision, and
   * one this build has not asked its merchants to agree to.
   */
  app.post(`${prefix}/merchant-agent/run`, async (request) => {
    const merchantId = getAuthenticatedMerchantId(request);
    return runAutonomousCycle(prisma, merchantId);
  });

  /**
   * The agent's operating state — objective, detections, what it did on
   * its own, what is waiting on a human, what it executed, what was
   * verified, and what failed. A pure read model over existing rows.
   */
  app.get(`${prefix}/merchant-agent/status`, async (request) => {
    const merchantId = getAuthenticatedMerchantId(request);
    return getAgentStatus(prisma, merchantId);
  });

  app.post(`${prefix}/merchant-agent/growth/proposals`, async (request) => {
    const merchantId = getAuthenticatedMerchantId(request);
    const body = growthProposalRequestSchema.parse(request.body);
    return proposeGrowthAction(prisma, { merchantId, ...body });
  });

  app.get(`${prefix}/merchant-agent/growth/proposals`, async (request) => {
    const merchantId = getAuthenticatedMerchantId(request);
    const query = listQuerySchema.parse(request.query);
    return { items: await listGrowthProposals(prisma, merchantId, query.limit) };
  });

  app.get(`${prefix}/merchant-agent/growth/proposals/:id`, async (request) => {
    const merchantId = getAuthenticatedMerchantId(request);
    const params = proposalParamsSchema.parse(request.params);
    return getGrowthProposal(prisma, merchantId, params.id);
  });

  /**
   * The merchant's growth boundaries — the switches and ceilings inside
   * which the agent may act without asking.
   *
   * This was read-only, which left the console able to SHOW an envelope
   * nobody could change. Under a product whose whole premise is "the
   * merchant sets the boundaries and the agent works inside them", the
   * boundaries being immutable is the more serious half of that sentence
   * missing.
   *
   * OWNER only, and audited: raising a discount ceiling authorises every
   * future offer under it, which is the same class of decision as
   * changing spending policy.
   */
  app.patch(`${prefix}/merchant-agent/growth/config`, async (request) => {
    const merchantId = getAuthenticatedMerchantId(request);
    requireOwnerRole(request);
    const body = merchantGrowthConfigUpdateSchema.parse(request.body);
    const config = await updateGrowthConfig(prisma, merchantId, body);

    await appendLedgerEvent(prisma, {
      workflowId: randomUUID(),
      merchantId,
      actorType: "MERCHANT_USER",
      actionType: "GROWTH_BOUNDARIES_UPDATED",
      conciseReason: `Merchant changed the growth envelope the agent operates inside.`,
      relatedEntityType: "MerchantGrowthConfig",
      relatedEntityId: merchantId,
      metadata: { changes: body },
    });

    return merchantGrowthConfigSchema.parse({
      growthActionsEnabled: config.growthActionsEnabled,
      autonomousRunsEnabled: config.autonomousRunsEnabled,
      crossSellEnabled: config.crossSellEnabled,
      upsellEnabled: config.upsellEnabled,
      bundleEnabled: config.bundleEnabled,
      boundedOffersEnabled: config.boundedOffersEnabled,
      maxUpsellIncreaseBps: config.maxUpsellIncreaseBps,
      maxProposedDiscountBps: config.maxProposedDiscountBps,
      maxCrossSellItems: config.maxCrossSellItems,
      maxBundleItems: config.maxBundleItems,
      dailyDiscountBudgetMinor: config.dailyDiscountBudgetMinor,
      weeklyCampaignBudgetMinor: config.weeklyCampaignBudgetMinor,
      maxCustomersContactedPerDay: config.maxCustomersContactedPerDay,
      maxContactsPerCustomerPerWeek: config.maxContactsPerCustomerPerWeek,
      minCampaignMarginBps: config.minCampaignMarginBps,
      campaignCooldownHours: config.campaignCooldownHours,
      automaticStopLossBps: config.automaticStopLossBps,
      defaultShippingCostMinor: config.defaultShippingCostMinor,
      paymentFeeBps: config.paymentFeeBps,
      expectedReturnRateBps: config.expectedReturnRateBps,
      quietHoursStart: config.quietHoursStart,
      quietHoursEnd: config.quietHoursEnd,
      consentRequired: config.consentRequired,
      outboundChannels: config.outboundChannels,
      categoryDiscountLimits: config.categoryDiscountLimits,
      excludedProductIds: config.excludedProductIds,
      excludedCustomerIds: config.excludedCustomerIds,
      currency: config.currency,
    });
  });

  /**
   * What this agent can actually do, declared rather than described.
   *
   * The set of actions used to exist only as branches inside the cycle, so
   * nothing could answer "what is it able to do?" — not the console, not a
   * merchant, not a test. It is a registry now, and this is the registry.
   */
  app.get(`${prefix}/merchant-agent/tools`, async (request) => {
    getAuthenticatedMerchantId(request);
    return agentToolsResponseSchema.parse({ tools: AGENT_TOOLS });
  });

  /**
   * Run one tool against one subject, on the merchant's instruction.
   *
   * WHY THIS EXISTS ALONGSIDE THE CYCLE
   *
   * The agent already had these capabilities; the only way to reach one
   * was to navigate to the right screen and do the work by hand. A
   * merchant who wants exactly one payment reconciled should be able to
   * ask for that.
   *
   * It is the SAME handler the autonomous cycle calls. A tool that behaved
   * differently depending on who started it would be two tools wearing one
   * name, and the one nobody tests is the one that moves money wrong.
   *
   * OWNER-only, because a GOVERNED tool can put money in motion inside the
   * merchant's own limits, and choosing to spend one of those limits is an
   * owner's decision — the same bar as changing the limits themselves.
   */
  app.post(`${prefix}/merchant-agent/tools/:name`, async (request) => {
    const merchantId = getAuthenticatedMerchantId(request);
    requireOwnerRole(request);
    const { name } = z.object({ name: z.string().min(1) }).parse(request.params);
    const { subjectId } = agentToolInvocationRequestSchema.parse(request.body);

    const tool = findTool(name);
    if (!tool) {
      throw AppError.notFound(
        `No such agent tool: "${name}". Call GET /merchant-agent/tools for the ones that exist.`,
      );
    }

    const workflowId = randomUUID();
    await appendLedgerEvent(prisma, {
      workflowId,
      merchantId,
      actorType: "MERCHANT_USER",
      actionType: "AGENT_TOOL_INVOKED",
      conciseReason: `Merchant asked the agent to run "${tool.meta.name}" on ${tool.meta.subject} ${subjectId}.`,
      relatedEntityType: "AgentTool",
      relatedEntityId: subjectId,
      metadata: { tool: tool.meta.name, safety: tool.meta.safety },
    });

    // Never throws past this point: a tool that refuses is a recorded
    // outcome the merchant should read, not a 500 they have to interpret.
    let outcome;
    try {
      outcome = await tool.run({ prisma, merchantId, workflowId }, subjectId);
    } catch (error) {
      const classified = classifyToolError(error, { tool: tool.meta.name, merchantId, workflowId, subject: subjectId });
      outcome = { outcome: classified.outcome, detail: classified.detail };
    }

    return agentToolInvocationResultSchema.parse({
      tool: tool.meta.name,
      subjectId,
      outcome: outcome.outcome,
      detail: outcome.detail,
      proposalId: outcome.proposalId ?? null,
      authorizationId: outcome.authorizationId ?? null,
      changed: outcome.changed ?? null,
    });
  });

  app.get(`${prefix}/merchant-agent/growth/config`, async (request) => {
    const merchantId = getAuthenticatedMerchantId(request);
    const config = await getGrowthConfig(prisma, merchantId);
    return merchantGrowthConfigSchema.parse({
      growthActionsEnabled: config.growthActionsEnabled,
      autonomousRunsEnabled: config.autonomousRunsEnabled,
      crossSellEnabled: config.crossSellEnabled,
      upsellEnabled: config.upsellEnabled,
      bundleEnabled: config.bundleEnabled,
      boundedOffersEnabled: config.boundedOffersEnabled,
      maxUpsellIncreaseBps: config.maxUpsellIncreaseBps,
      maxProposedDiscountBps: config.maxProposedDiscountBps,
      maxCrossSellItems: config.maxCrossSellItems,
      maxBundleItems: config.maxBundleItems,
      dailyDiscountBudgetMinor: config.dailyDiscountBudgetMinor,
      weeklyCampaignBudgetMinor: config.weeklyCampaignBudgetMinor,
      maxCustomersContactedPerDay: config.maxCustomersContactedPerDay,
      maxContactsPerCustomerPerWeek: config.maxContactsPerCustomerPerWeek,
      minCampaignMarginBps: config.minCampaignMarginBps,
      campaignCooldownHours: config.campaignCooldownHours,
      automaticStopLossBps: config.automaticStopLossBps,
      defaultShippingCostMinor: config.defaultShippingCostMinor,
      paymentFeeBps: config.paymentFeeBps,
      expectedReturnRateBps: config.expectedReturnRateBps,
      quietHoursStart: config.quietHoursStart,
      quietHoursEnd: config.quietHoursEnd,
      consentRequired: config.consentRequired,
      outboundChannels: config.outboundChannels,
      categoryDiscountLimits: config.categoryDiscountLimits,
      excludedProductIds: config.excludedProductIds,
      excludedCustomerIds: config.excludedCustomerIds,
      currency: config.currency,
    });
  });
}
