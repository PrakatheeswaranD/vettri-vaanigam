import type { FastifyInstance } from "fastify";
import { buyerSpendingPolicyUpdateSchema, type BuyerSpendingPolicyDTO } from "@razorgrowth/contracts";
import { prisma } from "../../db/client.js";
import { getBuyerContextId } from "../authorization/demo-context.js";
import { requireOwnerRole } from "../auth/middleware.js";
import { resolveBuyerPolicy } from "./resolve-policy.js";
import { getBuyerActivity } from "../buyer-agent/activity-service.js";
import { CUSTOMER_AGENT_ID } from "./negotiation-service.js";

/** A JSON column is `unknown` until something checks it. */
function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function toDTO(row: {
  id: string;
  currency: string;
  autonomousPurchaseLimitMinor: number;
  dailyLimitMinor: number;
  allowedCategories: unknown;
  allowAllCategories: boolean;
  approvalRequiredAboveLimit: boolean;
  maxPurchaseAmountMinor: number;
  restrictedCategories: unknown;
  preferredCategories: unknown;
  autoPurchaseEnabled: boolean;
  restrictedMerchantIds: unknown;
  updatedAt: Date;
}): BuyerSpendingPolicyDTO {
  return {
    id: row.id,
    currency: row.currency as BuyerSpendingPolicyDTO["currency"],
    autonomousPurchaseLimitMinor: row.autonomousPurchaseLimitMinor,
    dailyLimitMinor: row.dailyLimitMinor,
    allowedCategories: stringList(row.allowedCategories),
    allowAllCategories: row.allowAllCategories,
    approvalRequiredAboveLimit: row.approvalRequiredAboveLimit,
    maxPurchaseAmountMinor: row.maxPurchaseAmountMinor,
    restrictedCategories: stringList(row.restrictedCategories),
    preferredCategories: stringList(row.preferredCategories),
    autoPurchaseEnabled: row.autoPurchaseEnabled,
    restrictedMerchantIds: stringList(row.restrictedMerchantIds),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function registerBuyerPolicyRoutes(app: FastifyInstance, prefix: string): void {
  /**
   * What this buyer's agent actually did, read from the audit ledger.
   *
   * Scoped to workflows this buyer's own decisions and conversations
   * created — never by merchant, which would leak a seller's internal
   * activity into a shopper's feed.
   */
  app.get(`${prefix}/buyer/activity`, async (request) => {
    const buyerContext = getBuyerContextId(request);
    return getBuyerActivity(prisma, buyerContext, CUSTOMER_AGENT_ID);
  });

  app.get(`${prefix}/buyer/policy`, async (request) => {
    const buyerContext = getBuyerContextId(request);
    // Seeded from real purchasable categories, never the old fixed list —
    // see resolve-policy.ts for why a "safe" default that blocks every
    // legitimate purchase is the more dangerous of the two options.
    const row = await resolveBuyerPolicy(buyerContext);
    return toDTO(row);
  });
  app.put(`${prefix}/buyer/policy`, async (request) => {
    if (request.merchantUserRole !== "CUSTOMER") requireOwnerRole(request);
    const buyerContext = getBuyerContextId(request);
    const body = buyerSpendingPolicyUpdateSchema.parse(request.body);
    const row = await prisma.buyerSpendingPolicy.upsert({ where: { customerAccountId: buyerContext }, update: body, create: { customerAccountId: buyerContext, ...body } });
    return toDTO(row);
  });
}
