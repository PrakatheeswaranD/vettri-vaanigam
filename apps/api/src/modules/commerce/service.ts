import type { PrismaClient } from "@prisma/client";
import { listOrdersWithLatestPayment } from "./repository.js";
import { toTransactionDTO } from "./mapper.js";

export interface ListTransactionsParams {
  merchantId: string;
  page: number;
  limit: number;
}

export async function listTransactions(prisma: PrismaClient, params: ListTransactionsParams) {
  const { items, total } = await listOrdersWithLatestPayment(prisma, params);
  return {
    items: items.map(toTransactionDTO),
    pagination: {
      page: params.page,
      limit: params.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / params.limit)),
    },
  };
}
