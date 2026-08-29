/**
 * Approval Service (PART 05 §29-§36, §70, §92, §98; PART 10 §1).
 *
 * The ONLY place a human approval decision is recorded. `approverId` is
 * always server-derived from the authenticated session (the route layer
 * passes `request.merchantUserId`) — never a value the client sends in
 * the request body, so a request cannot forge who "approved" something.
 * RBAC (`requireApprovalRole`) is enforced at the route layer before this
 * function is ever called. Every decision is bound to the exact proposal
 * fingerprint that was true at policy-evaluation time (§30); if the
 * proposal ever differs from that, approval is refused rather than
 * silently applied to different terms.
 */
import { randomUUID } from "node:crypto";
import type { ApprovalDecisionDTO, ApprovalDTO, GrowthActionProposalDTO, PolicyDecisionDTO } from "@razorgrowth/contracts";
import { isValidProposalTransition, systemClock } from "@razorgrowth/domain";
import { AppError } from "../../http/errors.js";
import { logger } from "../../observability/logger.js";
import { appendLedgerEvent, withLedgerConcurrencyRetry } from "../audit/ledger.js";
import { toGrowthActionProposalDTO } from "../merchant-agent/mapper.js";
import { toApprovalDTO, toPolicyDecisionDTO } from "./mapper.js";
import {
  createApproval,
  findApprovalByProposal,
  findLatestPolicyEvaluation,
  findProposalForGovernance,
  getMerchantPolicy,
  listPendingApprovals,
  updateProposalGovernanceState,
} from "./repository.js";
import { fingerprintFromProposal } from "./service.js";
import type { PrismaClient } from "@prisma/client";

const CONFLICT_ERROR_CODE = "P2002";

function isApprovalUniqueConflict(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: string }).code === CONFLICT_ERROR_CODE &&
    JSON.stringify((err as { meta?: unknown }).meta ?? {}).includes("proposalId")
  );
}

export async function decideApproval(
  prisma: PrismaClient,
  merchantId: string,
  proposalId: string,
  decision: ApprovalDecisionDTO,
  reason: string | undefined,
  approverId: string,
): Promise<ApprovalDTO> {
  const proposal = await findProposalForGovernance(prisma, merchantId, proposalId);
  if (!proposal) throw AppError.notFound(`Growth action proposal not found: ${proposalId}`);

  if (proposal.status !== "PENDING_APPROVAL") {
    if (proposal.status === "APPROVED" || proposal.status === "APPROVAL_REJECTED") {
      const existing = await findApprovalByProposal(prisma, proposalId);
      throw new AppError(
        "APPROVAL_ALREADY_DECIDED",
        `This proposal was already ${proposal.status === "APPROVED" ? "approved" : "rejected"}.`,
        { existingApprovalId: existing?.id ?? null },
      );
    }
    throw new AppError("INVALID_STATE_TRANSITION", `Proposal is in status "${proposal.status}" and is not awaiting approval.`);
  }

  const policyEvaluation = await findLatestPolicyEvaluation(prisma, proposalId);
  if (!policyEvaluation || policyEvaluation.outcome !== "REQUIRE_APPROVAL") {
    throw AppError.conflict("Proposal has no pending REQUIRE_APPROVAL policy decision to act on.");
  }

  const fingerprint = fingerprintFromProposal(proposal);
  if (fingerprint !== policyEvaluation.proposalFingerprint) {
    throw new AppError("PROPOSAL_CHANGED", "The proposal changed since it was policy-evaluated; re-evaluate before deciding.");
  }

  const policy = await getMerchantPolicy(prisma, merchantId);
  const now = systemClock.now();
  const expiresAt = new Date(now.getTime() + policy.approvalValidityMinutes * 60_000);
  const nextStatus = decision === "APPROVED" ? "APPROVED" : "APPROVAL_REJECTED";

  if (!isValidProposalTransition(proposal.status, nextStatus)) {
    throw new AppError("INVALID_STATE_TRANSITION", `Cannot transition proposal from "${proposal.status}" to "${nextStatus}".`);
  }

  try {
    const approvalRow = await withLedgerConcurrencyRetry(prisma, async (tx) => {
      const row = await createApproval(tx, {
        id: randomUUID(),
        proposalId,
        proposalFingerprint: fingerprint,
        merchantId,
        policyEvaluationId: policyEvaluation.id,
        evaluatedPolicyVersion: policyEvaluation.evaluatedPolicyVersion,
        decision,
        reason: reason ?? null,
        approverId,
        expiresAt,
      });

      await updateProposalGovernanceState(tx, proposalId, { status: nextStatus, approvalId: row.id });

      await appendLedgerEvent(tx, {
        workflowId: proposal.traceId,
        merchantId,
        actorType: "MERCHANT_USER",
        actionType: decision === "APPROVED" ? "APPROVAL_APPROVED" : "APPROVAL_REJECTED",
        conciseReason: reason
          ? `${decision === "APPROVED" ? "Approved" : "Rejected"}: ${reason}`
          : `Merchant ${decision === "APPROVED" ? "approved" : "rejected"} the proposal.`,
        relatedEntityType: "Approval",
        relatedEntityId: row.id,
        metadata: { proposalId, policyDecisionId: policyEvaluation.id },
      });

      return row;
    });

    logger.info({ event: `approval.${decision.toLowerCase()}`, merchantId, proposalId, approvalId: approvalRow.id }, "Approval decided");
    return toApprovalDTO(approvalRow);
  } catch (err) {
    if (isApprovalUniqueConflict(err)) {
      // A concurrent request already recorded a decision for this exact
      // proposal (PART 05 §35-§36). If it recorded the SAME decision this
      // request also wanted, treat it as an idempotent success (a
      // double-click retry); if it recorded a DIFFERENT decision, this is
      // a genuine conflict the client must see.
      const existing = await findApprovalByProposal(prisma, proposalId);
      if (existing && existing.decision === decision) {
        return toApprovalDTO(existing);
      }
      throw new AppError(
        "APPROVAL_ALREADY_DECIDED",
        "This proposal was already decided by a concurrent request.",
        { existingDecision: existing?.decision ?? null },
      );
    }
    throw err;
  }
}

export interface PendingApprovalItem {
  proposal: GrowthActionProposalDTO;
  policyDecision: PolicyDecisionDTO | null;
}

export async function listPendingApprovalItems(prisma: PrismaClient, merchantId: string, limit: number): Promise<PendingApprovalItem[]> {
  const proposals = await listPendingApprovals(prisma, merchantId, limit);
  return Promise.all(
    proposals.map(async (proposal) => {
      const decision = proposal.latestPolicyDecisionId ? await findLatestPolicyEvaluation(prisma, proposal.id) : null;
      return {
        proposal: toGrowthActionProposalDTO(proposal),
        policyDecision: decision ? toPolicyDecisionDTO(decision) : null,
      };
    }),
  );
}
