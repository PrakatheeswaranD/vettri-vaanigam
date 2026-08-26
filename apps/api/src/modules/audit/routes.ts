import type { FastifyInstance } from "fastify";
import { paginationQuerySchema, agentActorTypeSchema, agentActionStatusSchema } from "@razorgrowth/contracts";
import { z } from "zod";
import { prisma } from "../../db/client.js";
import { getDemoMerchantId } from "../authorization/demo-context.js";
import { getWorkflowTrace, listLedgerEntries, verifyLedgerWorkflow } from "./service.js";

const listQuerySchema = paginationQuerySchema.extend({
  actorType: agentActorTypeSchema.optional(),
  status: agentActionStatusSchema.optional(),
  workflowId: z.string().uuid().optional(),
});

const workflowParamsSchema = z.object({ workflowId: z.string().uuid() });

export function registerLedgerRoutes(app: FastifyInstance, prefix: string): void {
  app.get(`${prefix}/ledger`, async (request) => {
    const merchantId = await getDemoMerchantId(prisma);
    const query = listQuerySchema.parse(request.query);
    return listLedgerEntries(prisma, { merchantId, ...query });
  });

  // PART 05 §62 — read-only integrity check, no auth beyond the existing
  // single-demo-merchant model; never mutates ledger rows.
  app.get(`${prefix}/action-ledger/workflows/:workflowId/verify`, async (request) => {
    const params = workflowParamsSchema.parse(request.params);
    return verifyLedgerWorkflow(prisma, params.workflowId);
  });

  // PART 08 §72, §107 — the financial-flow trace view: one workflow's
  // complete, ordered story, derived entirely from already-persisted
  // ledger rows.
  app.get(`${prefix}/action-ledger/workflows/:workflowId/trace`, async (request) => {
    const params = workflowParamsSchema.parse(request.params);
    return getWorkflowTrace(prisma, params.workflowId);
  });
}
