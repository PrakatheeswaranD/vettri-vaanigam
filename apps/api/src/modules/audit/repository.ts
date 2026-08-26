import type { AgentActionStatus, AgentActorType, Prisma, PrismaClient } from "@prisma/client";

export interface LedgerListFilters {
  merchantId: string;
  actorType?: AgentActorType;
  status?: AgentActionStatus;
  workflowId?: string;
  page: number;
  limit: number;
}

export async function listAgentActions(prisma: PrismaClient, filters: LedgerListFilters) {
  const where: Prisma.AgentActionWhereInput = {
    merchantId: filters.merchantId,
    ...(filters.actorType ? { actorType: filters.actorType } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.workflowId ? { workflowId: filters.workflowId } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.agentAction.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (filters.page - 1) * filters.limit,
      take: filters.limit,
    }),
    prisma.agentAction.count({ where }),
  ]);

  return { items, total };
}
