import type { FastifyInstance } from "fastify";
import { paginationQuerySchema, agentActorTypeSchema, agentActionStatusSchema } from "@razorgrowth/contracts";
import { z } from "zod";
import { prisma } from "../../db/client.js";
import { getAuthenticatedMerchantId } from "../authorization/demo-context.js";
import { getWorkflowTrace, listLedgerEntries, verifyLedgerWorkflow } from "./service.js";

const listQuerySchema = paginationQuerySchema.extend({
  actorType: agentActorTypeSchema.optional(),
  status: agentActionStatusSchema.optional(),
  workflowId: z.string().uuid().optional(),
});

const workflowParamsSchema = z.object({ workflowId: z.string().uuid() });

export function registerLedgerRoutes(app: FastifyInstance, prefix: string): void {
  app.get(`${prefix}/ledger`, async (request) => {
    const merchantId = getAuthenticatedMerchantId(request);
    const query = listQuerySchema.parse(request.query);
    return listLedgerEntries(prisma, { merchantId, ...query });
  });

  // PART 05 §62 — read-only integrity check scoped to the authenticated
  // merchant; never mutates ledger rows or reveals another tenant's chain.
  app.get(`${prefix}/action-ledger/workflows/:workflowId/verify`, async (request) => {
    const merchantId = getAuthenticatedMerchantId(request);
    const params = workflowParamsSchema.parse(request.params);
    return verifyLedgerWorkflow(prisma, merchantId, params.workflowId);
  });

  // PART 08 §72, §107 — the financial-flow trace view: one workflow's
  // complete, ordered story, derived entirely from already-persisted
  // ledger rows.
  app.get(`${prefix}/action-ledger/workflows/:workflowId/trace`, async (request) => {
    const merchantId = getAuthenticatedMerchantId(request);
    const params = workflowParamsSchema.parse(request.params);
    return getWorkflowTrace(prisma, merchantId, params.workflowId);
  });
}
