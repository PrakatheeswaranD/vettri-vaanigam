import type { Approval, ExecutionAuthorization, PolicyEvaluation } from "@prisma/client";
import type { ApprovalDTO, ExecutionAuthorizationDTO, PolicyDecisionDTO } from "@razorgrowth/contracts";
import { POLICY_SCHEMA_VERSION } from "@razorgrowth/contracts";

export function toPolicyDecisionDTO(row: PolicyEvaluation): PolicyDecisionDTO {
  return {
    id: row.id,
    schemaVersion: POLICY_SCHEMA_VERSION,
    proposalId: row.proposalId,
    merchantId: row.merchantId,
    workflowId: row.workflowId,
    outcome: row.outcome,
    reasonCodes: row.reasonCodes as PolicyDecisionDTO["reasonCodes"],
    explanation: row.explanation,
    evaluatedPolicyVersion: row.evaluatedPolicyVersion,
    evaluatedValues: row.evaluatedValues as PolicyDecisionDTO["evaluatedValues"],
    proposalFingerprint: row.proposalFingerprint,
    fingerprintVersion: row.fingerprintVersion,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toApprovalDTO(row: Approval): ApprovalDTO {
  return {
    id: row.id,
    proposalId: row.proposalId,
    proposalFingerprint: row.proposalFingerprint,
    merchantId: row.merchantId,
    policyDecisionId: row.policyEvaluationId,
    evaluatedPolicyVersion: row.evaluatedPolicyVersion,
    decision: row.decision,
    reason: row.reason,
    approverId: row.approverId,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  };
}

export function toExecutionAuthorizationDTO(row: ExecutionAuthorization): ExecutionAuthorizationDTO {
  return {
    id: row.id,
    proposalId: row.proposalId,
    proposalFingerprint: row.proposalFingerprint,
    merchantId: row.merchantId,
    policyDecisionId: row.policyEvaluationId,
    approvalId: row.approvalId,
    authorizedActionType: row.authorizedActionType,
    financialBounds: row.financialBounds as ExecutionAuthorizationDTO["financialBounds"],
    issuedAt: row.issuedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    status: row.status,
    authorizationVersion: row.authorizationVersion,
    createdAt: row.createdAt.toISOString(),
  };
}
