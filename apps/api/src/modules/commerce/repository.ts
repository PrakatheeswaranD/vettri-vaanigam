import type { Prisma, PrismaClient } from "@prisma/client";

const orderWithLatestPayment = {
  include: {
    customer: true,
    payments: { orderBy: { createdAt: "desc" as const }, take: 1 },
  },
} satisfies Prisma.OrderDefaultArgs;

export interface TransactionListFilters {
  merchantId: string;
  page: number;
  limit: number;
}

export async function listOrdersWithLatestPayment(prisma: PrismaClient, filters: TransactionListFilters) {
  const where: Prisma.OrderWhereInput = { merchantId: filters.merchantId };

  const [items, total] = await Promise.all([
    prisma.order.findMany({
      where,
      ...orderWithLatestPayment,
      orderBy: { createdAt: "desc" },
      skip: (filters.page - 1) * filters.limit,
      take: filters.limit,
    }),
    prisma.order.count({ where }),
  ]);

  return { items, total };
}
