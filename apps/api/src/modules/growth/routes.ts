import type { FastifyInstance } from "fastify";
import type { GrowthSummaryDTO } from "@razorgrowth/contracts";
import { prisma } from "../../db/client.js";
import { getAuthenticatedMerchantId } from "../authorization/demo-context.js";
import { getGrowthSummary } from "./summary-service.js";
import { getRevenueOpportunityReport } from "./revenue-evidence-service.js";

export function registerGrowthRoutes(app: FastifyInstance, prefix: string): void {
  /**
   * The Revenue Opportunity Engine's full report. Computed on read rather
   * than cached: it is derived entirely from current rows, so a stale
   * cached opportunity would be worse than the query cost of a fresh one.
   */
  app.get(`${prefix}/growth/revenue-opportunities`, async (request) => {
    const merchantId = getAuthenticatedMerchantId(request);
    return getRevenueOpportunityReport(prisma, merchantId);
  });

  app.get(`${prefix}/growth/summary`, async (request): Promise<GrowthSummaryDTO> => {
    const merchantId = getAuthenticatedMerchantId(request);
    return getGrowthSummary(prisma, merchantId);
  });
}
