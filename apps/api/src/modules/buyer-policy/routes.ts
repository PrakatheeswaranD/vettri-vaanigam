import type { FastifyInstance } from "fastify";
import { buyerSpendingPolicyUpdateSchema, type BuyerSpendingPolicyDTO } from "@razorgrowth/contracts";
import { prisma } from "../../db/client.js";
import { getAuthenticatedMerchantId } from "../authorization/demo-context.js";
import { requireOwnerRole } from "../auth/middleware.js";
import { resolveBuyerPolicy } from "./resolve-policy.js";

function toDTO(row: { id: string; currency: string; autonomousPurchaseLimitMinor: number; dailyLimitMinor: number; allowedCategories: unknown; allowAllCategories: boolean; approvalRequiredAboveLimit: boolean; updatedAt: Date }): BuyerSpendingPolicyDTO {
  return {
    id: row.id,
    currency: row.currency as BuyerSpendingPolicyDTO["currency"],
    autonomousPurchaseLimitMinor: row.autonomousPurchaseLimitMinor,
    dailyLimitMinor: row.dailyLimitMinor,
    allowedCategories: Array.isArray(row.allowedCategories) ? row.allowedCategories.filter((item): item is string => typeof item === "string") : [],
    allowAllCategories: row.allowAllCategories,
    approvalRequiredAboveLimit: row.approvalRequiredAboveLimit,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function registerBuyerPolicyRoutes(app: FastifyInstance, prefix: string): void {
  app.get(`${prefix}/buyer/policy`, async (request) => {
    const merchantId = getAuthenticatedMerchantId(request);
    // Seeded from real purchasable categories, never the old fixed list —
    // see resolve-policy.ts for why a "safe" default that blocks every
    // legitimate purchase is the more dangerous of the two options.
    const row = await resolveBuyerPolicy(merchantId);
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
