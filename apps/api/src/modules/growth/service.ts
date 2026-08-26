import type { PrismaClient } from "@prisma/client";
import { listOpportunities } from "./repository.js";
import { toGrowthOpportunityDTO } from "./mapper.js";

export async function listGrowthOpportunities(prisma: PrismaClient, merchantId: string) {
  const opportunities = await listOpportunities(prisma, merchantId);
  return opportunities.map(toGrowthOpportunityDTO);
}
