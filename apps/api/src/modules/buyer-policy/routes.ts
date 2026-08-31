import type { FastifyInstance } from "fastify";
import { buyerSpendingPolicyUpdateSchema, type BuyerSpendingPolicyDTO } from "@razorgrowth/contracts";
import { prisma } from "../../db/client.js";
import { getAuthenticatedMerchantId } from "../authorization/demo-context.js";
import { requireOwnerRole } from "../auth/middleware.js";

function toDTO(row: { id: string; currency: string; autonomousPurchaseLimitMinor: number; dailyLimitMinor: number; allowedCategories: unknown; approvalRequiredAboveLimit: boolean; updatedAt: Date }): BuyerSpendingPolicyDTO {
  return {
    id: row.id,
    currency: row.currency as BuyerSpendingPolicyDTO["currency"],
    autonomousPurchaseLimitMinor: row.autonomousPurchaseLimitMinor,
    dailyLimitMinor: row.dailyLimitMinor,
    allowedCategories: Array.isArray(row.allowedCategories) ? row.allowedCategories.filter((item): item is string => typeof item === "string") : [],
    approvalRequiredAboveLimit: row.approvalRequiredAboveLimit,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function registerBuyerPolicyRoutes(app: FastifyInstance, prefix: string): void {
  app.get(`${prefix}/buyer/policy`, async (request) => {
    const merchantId = getAuthenticatedMerchantId(request);
    const row = await prisma.buyerSpendingPolicy.upsert({ where: { merchantId }, update: {}, create: { merchantId, allowedCategories: ["Electronics/Laptop", "Books", "Accessories"] } });
    return toDTO(row);
  });
  app.put(`${prefix}/buyer/policy`, async (request) => {
    if (request.merchantUserRole !== "CUSTOMER") requireOwnerRole(request);
    const merchantId = getAuthenticatedMerchantId(request);
    const body = buyerSpendingPolicyUpdateSchema.parse(request.body);
    const row = await prisma.buyerSpendingPolicy.upsert({ where: { merchantId }, update: body, create: { merchantId, ...body } });
    return toDTO(row);
  });
}
