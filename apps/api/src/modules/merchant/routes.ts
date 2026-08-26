import type { FastifyInstance } from "fastify";
import { merchantPolicyUpdateSchema } from "@razorgrowth/contracts";
import { prisma } from "../../db/client.js";
import { getDemoMerchantId } from "../authorization/demo-context.js";
import { getMerchantProfile, getMerchantPolicyView, getMerchantStats, updateMerchantPolicyView } from "./service.js";

export function registerMerchantRoutes(app: FastifyInstance, prefix: string): void {
  app.get(`${prefix}/merchant`, async () => {
    const merchantId = await getDemoMerchantId(prisma);
    return getMerchantProfile(prisma, merchantId);
  });

  // PART 05 §11-§13, §74 — the real data the Policy Engine reads.
  app.get(`${prefix}/merchant/policy`, async () => {
    const merchantId = await getDemoMerchantId(prisma);
    return getMerchantPolicyView(prisma, merchantId);
  });

  // PART 05 §75-§76 — the only way policy may change: full server
  // validation, a version increment, and an audit event. No partial/
  // frontend-only edits.
  app.patch(`${prefix}/merchant/policy`, async (request) => {
    const merchantId = await getDemoMerchantId(prisma);
    const body = merchantPolicyUpdateSchema.parse(request.body);
    return updateMerchantPolicyView(prisma, merchantId, body);
  });

  app.get(`${prefix}/merchant/stats`, async () => {
    const merchantId = await getDemoMerchantId(prisma);
    return getMerchantStats(prisma, merchantId);
  });
}
