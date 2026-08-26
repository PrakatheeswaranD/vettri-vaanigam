import type { PrismaClient } from "@prisma/client";

export function listOpportunities(prisma: PrismaClient, merchantId: string) {
  return prisma.growthOpportunity.findMany({
    where: { merchantId },
    orderBy: { createdAt: "desc" },
  });
}
