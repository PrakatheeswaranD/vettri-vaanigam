/**
 * Merchant Agent API (PART 04 §79-§81).
 *
 * Deliberately narrow: propose, read one, list recent, and read the
 * non-secret growth configuration a jury/demo panel can inspect.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { growthProposalRequestSchema, merchantGrowthConfigSchema } from "@razorgrowth/contracts";
import { prisma } from "../../db/client.js";
import { getDemoMerchantId } from "../authorization/demo-context.js";
import { getGrowthConfig } from "./repository.js";
import { getGrowthProposal, listGrowthProposals, proposeGrowthAction } from "./service.js";

const proposalParamsSchema = z.object({ id: z.string().uuid() });
const listQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) });

export function registerMerchantAgentRoutes(app: FastifyInstance, prefix: string): void {
  app.post(`${prefix}/merchant-agent/growth/proposals`, async (request) => {
    const merchantId = await getDemoMerchantId(prisma);
    const body = growthProposalRequestSchema.parse(request.body);
    return proposeGrowthAction(prisma, { merchantId, ...body });
  });

  app.get(`${prefix}/merchant-agent/growth/proposals`, async (request) => {
    const merchantId = await getDemoMerchantId(prisma);
    const query = listQuerySchema.parse(request.query);
    return { items: await listGrowthProposals(prisma, merchantId, query.limit) };
  });

  app.get(`${prefix}/merchant-agent/growth/proposals/:id`, async (request) => {
    const merchantId = await getDemoMerchantId(prisma);
    const params = proposalParamsSchema.parse(request.params);
    return getGrowthProposal(prisma, merchantId, params.id);
  });

  app.get(`${prefix}/merchant-agent/growth/config`, async () => {
    const merchantId = await getDemoMerchantId(prisma);
    const config = await getGrowthConfig(prisma, merchantId);
    return merchantGrowthConfigSchema.parse({
      growthActionsEnabled: config.growthActionsEnabled,
      crossSellEnabled: config.crossSellEnabled,
      upsellEnabled: config.upsellEnabled,
      bundleEnabled: config.bundleEnabled,
      boundedOffersEnabled: config.boundedOffersEnabled,
      maxUpsellIncreaseBps: config.maxUpsellIncreaseBps,
      maxProposedDiscountBps: config.maxProposedDiscountBps,
      maxCrossSellItems: config.maxCrossSellItems,
      maxBundleItems: config.maxBundleItems,
      currency: config.currency,
    });
  });
}
