/**
 * PART 05 governance API — deliberately narrow (§34, §107-§108). Every
 * route resolves the authenticated merchant server-side
 * (`getAuthenticatedMerchantId`, PART 10 §1); no route ever accepts a
 * client-supplied merchant/approver identity (§33, §98).
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { approvalDecisionSchema, approvalRequestBodySchema, policyEvaluateRequestSchema } from "@razorgrowth/contracts";
import { prisma } from "../../db/client.js";
import { getAuthenticatedMerchantId } from "../authorization/demo-context.js";
import { requireApprovalRole } from "../auth/middleware.js";
import { evaluateProposalPolicy, getPolicyDecision } from "./service.js";
import { issueExecutionAuthorization, getExecutionAuthorization } from "./authorization-service.js";
import { decideApproval, listPendingApprovalItems } from "./approval-service.js";

const idParamsSchema = z.object({ id: z.string().uuid() });
const proposalParamsSchema = z.object({ proposalId: z.string().uuid() });
const pendingQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) });

export function registerPolicyRoutes(app: FastifyInstance, prefix: string): void {
  // Evaluates policy for a proposal and, on ALLOW, immediately attempts to
  // issue execution authorization in the same round trip (PART 05 §115) —
  // composed here at the route layer rather than inside the Policy Engine
  // itself, so `evaluateProposalPolicy` never depends on the authorization
  // service (avoids a circular dependency between the two services).
  app.post(`${prefix}/policy/evaluate`, async (request) => {
    const merchantId = getAuthenticatedMerchantId(request);
    const body = policyEvaluateRequestSchema.parse(request.body);
    const decision = await evaluateProposalPolicy(prisma, merchantId, body.proposalId);
    const authorization = decision.outcome === "ALLOW" ? await issueExecutionAuthorization(prisma, merchantId, body.proposalId) : null;
    return { decision, authorization };
  });

  app.get(`${prefix}/policy/decisions/:id`, async (request) => {
    const merchantId = getAuthenticatedMerchantId(request);
    const params = idParamsSchema.parse(request.params);
    return getPolicyDecision(prisma, merchantId, params.id);
  });

  app.post(`${prefix}/approvals/:proposalId/approve`, async (request) => {
    requireApprovalRole(request);
    const merchantId = getAuthenticatedMerchantId(request);
    const params = proposalParamsSchema.parse(request.params);
    const body = approvalRequestBodySchema.parse(request.body ?? {});
    const approval = await decideApproval(prisma, merchantId, params.proposalId, approvalDecisionSchema.parse("APPROVED"), body.reason, request.merchantUserId);
    const authorization = await issueExecutionAuthorization(prisma, merchantId, params.proposalId);
    return { approval, authorization };
  });

  app.post(`${prefix}/approvals/:proposalId/reject`, async (request) => {
    requireApprovalRole(request);
    const merchantId = getAuthenticatedMerchantId(request);
    const params = proposalParamsSchema.parse(request.params);
    const body = approvalRequestBodySchema.parse(request.body ?? {});
    return { approval: await decideApproval(prisma, merchantId, params.proposalId, approvalDecisionSchema.parse("REJECTED"), body.reason, request.merchantUserId) };
  });

  app.get(`${prefix}/approvals/pending`, async (request) => {
    const merchantId = getAuthenticatedMerchantId(request);
    const query = pendingQuerySchema.parse(request.query);
    return { items: await listPendingApprovalItems(prisma, merchantId, query.limit) };
  });

  // Manual retry of authorization issuance — meaningful when an earlier
  // automatic attempt (right after ALLOW/approve) failed revalidation and
  // the underlying condition has since been fixed (PART 05 §43, §151).
  app.post(`${prefix}/execution-authorizations/:proposalId/issue`, async (request) => {
    const merchantId = getAuthenticatedMerchantId(request);
    const params = proposalParamsSchema.parse(request.params);
    return issueExecutionAuthorization(prisma, merchantId, params.proposalId);
  });

  app.get(`${prefix}/execution-authorizations/:id`, async (request) => {
    const merchantId = getAuthenticatedMerchantId(request);
    const params = idParamsSchema.parse(request.params);
    return getExecutionAuthorization(prisma, merchantId, params.id);
  });
}
