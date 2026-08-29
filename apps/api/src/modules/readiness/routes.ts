import type { FastifyInstance } from "fastify";
import { readinessHistoryQuerySchema } from "@razorgrowth/contracts";
import { prisma } from "../../db/client.js";
import { getAuthenticatedMerchantId } from "../authorization/demo-context.js";
import { getLatestReadiness, getReadinessHistory, recalculateReadiness } from "./service.js";

export function registerReadinessRoutes(app: FastifyInstance, prefix: string): void {
  app.get(`${prefix}/readiness/latest`, async (request) => {
    const merchantId = getAuthenticatedMerchantId(request);
    return getLatestReadiness(prisma, merchantId);
  });

  app.get(`${prefix}/readiness/history`, async (request) => {
    const merchantId = getAuthenticatedMerchantId(request);
    const query = readinessHistoryQuerySchema.parse(request.query);
    return { items: await getReadinessHistory(prisma, merchantId, query.limit) };
  });

  // PART 02 §42, §70, §102 — deterministic recalculation, not an AI
  // action. Fastify serializes requests to a single handler instance per
  // route sequentially per connection, and the frontend additionally
  // disables the trigger button while a request is in flight (PART 02
  // §102) to prevent duplicate-click snapshot spam.
  app.post(`${prefix}/readiness/recalculate`, async (request) => {
    const merchantId = getAuthenticatedMerchantId(request);
    return recalculateReadiness(prisma, merchantId);
  });
}
