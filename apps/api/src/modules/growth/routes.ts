import type { FastifyInstance } from "fastify";
import { prisma } from "../../db/client.js";
import { getDemoMerchantId } from "../authorization/demo-context.js";
import { listGrowthOpportunities } from "./service.js";

export function registerGrowthRoutes(app: FastifyInstance, prefix: string): void {
  app.get(`${prefix}/growth/opportunities`, async () => {
    const merchantId = await getDemoMerchantId(prisma);
    return { items: await listGrowthOpportunities(prisma, merchantId) };
  });
}
