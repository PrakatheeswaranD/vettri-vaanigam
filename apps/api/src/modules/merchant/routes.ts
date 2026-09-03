import type { FastifyInstance } from "fastify";
import { merchantPolicyUpdateSchema } from "@razorgrowth/contracts";
import { prisma } from "../../db/client.js";
import { requireOwnerRole } from "../auth/middleware.js";
import { getAuthenticatedMerchantId } from "../authorization/demo-context.js";
import { getMerchantProfile, getMerchantPolicyView, getMerchantStats, updateMerchantPolicyView } from "./service.js";
import { getMerchantCommerceOverview } from "./commerce-overview-service.js";

export function registerMerchantRoutes(app: FastifyInstance, prefix: string): void {
  app.get(`${prefix}/merchant`, async (request) => {
    const merchantId = getAuthenticatedMerchantId(request);
    return getMerchantProfile(prisma, merchantId);
  });

  // PART 05 §11-§13, §74 — the real data the Policy Engine reads.
  app.get(`${prefix}/merchant/policy`, async (request) => {
    const merchantId = getAuthenticatedMerchantId(request);
    return getMerchantPolicyView(prisma, merchantId);
  });

  // PART 05 §75-§76 — the only way policy may change: full server
  // validation, a version increment, and an audit event. No partial/
  // frontend-only edits.
  app.patch(`${prefix}/merchant/policy`, async (request) => {
    const merchantId = getAuthenticatedMerchantId(request);
    requireOwnerRole(request);
    const body = merchantPolicyUpdateSchema.parse(request.body);
    return updateMerchantPolicyView(prisma, merchantId, body);
  });

  app.get(`${prefix}/merchant/stats`, async (request) => {
    const merchantId = getAuthenticatedMerchantId(request);
    return getMerchantStats(prisma, merchantId);
  });

  app.get(`${prefix}/merchant/commerce-overview`, async (request) => {
    const merchantId = getAuthenticatedMerchantId(request);
    return getMerchantCommerceOverview(prisma, merchantId);
  });
}
