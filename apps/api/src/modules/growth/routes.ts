import type { FastifyInstance } from "fastify";
import type { GrowthSummaryDTO } from "@razorgrowth/contracts";
import { prisma } from "../../db/client.js";
import { getAuthenticatedMerchantId } from "../authorization/demo-context.js";
import { listGrowthOpportunities } from "./service.js";
import { getGrowthSummary } from "./summary-service.js";

export function registerGrowthRoutes(app: FastifyInstance, prefix: string): void {
  app.get(`${prefix}/growth/opportunities`, async (request) => {
    const merchantId = getAuthenticatedMerchantId(request);
    return { items: await listGrowthOpportunities(prisma, merchantId) };
  });

  app.get(`${prefix}/growth/summary`, async (request): Promise<GrowthSummaryDTO> => {
    const merchantId = getAuthenticatedMerchantId(request);
    return getGrowthSummary(prisma, merchantId);
  });
}
