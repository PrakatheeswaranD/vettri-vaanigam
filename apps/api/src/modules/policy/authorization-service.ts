/**
 * Execution Authorization Service (PART 05 §37-§48, §72).
 *
 * Answers exactly one question: "given policy + any required approval +
 * current state, may a future execution layer proceed?" It never executes
 * anything (§73) — PART 06/07 will load an issued `ExecutionAuthorization`
 * by ID and revalidate it again before touching commerce/payment state.
 * Every check below can independently refuse issuance; a refusal is a
 * normal, structured, auditable outcome (`AuthorizationDenialDTO`), never
 * an unhandled error, because "not yet authorized" is an expected result,
 * not a bug.
 */
import { randomUUID } from "node:crypto";
import type { Approval } from "@prisma/client";
import type { AuthorizationDenialReasonCodeDTO, AuthorizationResultDTO } from "@razorgrowth/contracts";
import { systemClock } from "@razorgrowth/domain";
import { AppError } from "../../http/errors.js";
import { logger } from "../../observability/logger.js";
import { appendLedgerEvent, withLedgerConcurrencyRetry } from "../audit/ledger.js";
import { toExecutionAuthorizationDTO } from "./mapper.js";
import {
  createExecutionAuthorization,
  findActiveExecutionAuthorization,
  findApprovalByProposal,
  findExecutionAuthorizationById,
  findLatestPolicyEvaluation,
  findProposalForGovernance,
  getMerchantPolicy,
  updateProposalGovernanceState,
} from "./repository.js";
import {
  deriveDiscountBps,
  deriveProposalCurrency,
  evaluateProposalPolicy,
  fingerprintFromProposal,
  proposalOpportunity,
  revalidateCommerceFacts,
} from "./service.js";
import type { PrismaClient } from "@prisma/client";

async function denyAuthorization(
  prisma: PrismaClient,
  params: { workflowId: string; merchantId: string; proposalId: string },
  reasonCode: AuthorizationDenialReasonCodeDTO,
  explanation: string,
): Promise<AuthorizationResultDTO> {
  await appendLedgerEvent(prisma, {
    workflowId: params.workflowId,
    merchantId: params.merchantId,
    actorType: "SYSTEM",
    actionType: "EXECUTION_AUTHORIZATION_DENIED",
    conciseReason: explanation,
    relatedEntityType: "GrowthActionProposal",
    relatedEntityId: params.proposalId,
    metadata: { proposalId: params.proposalId, reasonCode },
  });
  logger.info({ event: "authorization.denied", merchantId: params.merchantId, proposalId: params.proposalId, reasonCode }, explanation);
  return { denied: true, reasonCode, explanation };
}

const NEVER_AUTHORIZABLE_STATUSES = new Set(["POLICY_DENIED", "REJECTED_VALIDATION", "APPROVAL_REJECTED"]);
const NOT_YET_READY_STATUSES = new Set(["PROPOSED", "PENDING_APPROVAL"]);

const AUTHORIZATION_CONFLICT_CODE = "P2002";

function isAuthorizationUniqueConflict(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: string }).code === AUTHORIZATION_CONFLICT_CODE &&
    JSON.stringify((err as { meta?: unknown }).meta ?? {}).includes("proposalId")
  );
}

/**
 * Attempts to issue (or idempotently return) an `ExecutionAuthorization`
 * for one proposal. Called automatically right after a policy ALLOW and
 * right after a merchant APPROVED decision, and can also be retried
 * manually (`POST /execution-authorizations/:proposalId/issue`) if an
 * earlier automatic attempt failed revalidation.
 */
export async function issueExecutionAuthorization(
  prisma: PrismaClient,
  merchantId: string,
  proposalId: string,
): Promise<AuthorizationResultDTO> {
  let proposal = await findProposalForGovernance(prisma, merchantId, proposalId);
  if (!proposal) throw AppError.notFound(`Growth action proposal not found: ${proposalId}`);

  const now = systemClock.now();

  // Reconcile any existing ACTIVE authorization against the CURRENT
  // proposal before trusting it (PART 05 §42, §48). An idempotent return
  // is only correct if NOTHING has changed since it was issued — an
  // authorization whose proposal has since been altered underneath it is
  // just as invalid as one that expired, even though it's still marked
  // ACTIVE, so both cases retire the row rather than blindly reusing it.
  const existingActive = await findActiveExecutionAuthorization(prisma, proposalId);
  if (existingActive) {
    const stillCurrent = fingerprintFromProposal(proposal) === existingActive.proposalFingerprint;
    const stillFresh = existingActive.expiresAt.getTime() > now.getTime();
    if (stillCurrent && stillFresh) {
      return toExecutionAuthorizationDTO(existingActive); // truly idempotent — nothing changed
    }

    const retiredStatus = !stillFresh ? "EXPIRED" : "REVOKED";
    const retiredEventType = !stillFresh ? "EXECUTION_AUTHORIZATION_EXPIRED" : "EXECUTION_AUTHORIZATION_REVOKED";
    const retiredReason = !stillFresh
      ? "Execution authorization expired without being consumed."
      : "Execution authorization revoked: the underlying proposal changed after it was issued.";
    await withLedgerConcurrencyRetry(prisma, async (tx) => {
      await tx.executionAuthorization.update({ where: { id: existingActive.id }, data: { status: retiredStatus } });
      await updateProposalGovernanceState(tx, proposalId, { status: proposal!.status, executionAuthorizationId: null });
      await appendLedgerEvent(tx, {
        workflowId: proposal!.traceId,
        merchantId,
        actorType: "SYSTEM",
        actionType: retiredEventType,
        conciseReason: retiredReason,
        relatedEntityType: "ExecutionAuthorization",
        relatedEntityId: existingActive.id,
        metadata: { proposalId },
      });
    });

    if (!stillCurrent) {
      // A changed proposal is refused outright rather than falling
      // through to a fresh issuance attempt — the policy/approval
      // decisions on record were made against terms that no longer exist.
      return denyAuthorization(
        prisma,
        { workflowId: proposal.traceId, merchantId, proposalId },
        "PROPOSAL_CHANGED",
        "The proposal's financially meaningful content has changed since execution authorization was issued; the previous authorization has been revoked.",
      );
    }
    // Expired-but-otherwise-unchanged: fall through and attempt a fresh
    // issuance below using the same still-valid policy/approval decision.
  }

  if (NOT_YET_READY_STATUSES.has(proposal.status)) {
    throw new AppError(
      "AUTHORIZATION_NOT_ALLOWED",
      `Proposal is in status "${proposal.status}"; policy evaluation and any required approval must resolve first.`,
    );
  }
  if (NEVER_AUTHORIZABLE_STATUSES.has(proposal.status)) {
    throw new AppError("AUTHORIZATION_NOT_ALLOWED", `Proposal is in terminal status "${proposal.status}" and can never be authorized.`);
  }

  let policyEvaluation = await findLatestPolicyEvaluation(prisma, proposalId);
  if (!policyEvaluation) {
    throw AppError.conflict("Proposal has no policy decision yet; evaluate policy before requesting authorization.");
  }
  const currentPolicy = await getMerchantPolicy(prisma, merchantId);

  // PART 05 §46-§47 — a decision evaluated under a since-changed policy
  // version is re-evaluated fresh rather than trusted as-is. Re-evaluation
  // may move the proposal back to PENDING_APPROVAL or POLICY_DENIED even
  // if it was previously ALLOWED/APPROVED — a materially changed policy
  // means any prior human approval no longer covers the current terms.
  if (policyEvaluation.evaluatedPolicyVersion !== currentPolicy.policyVersion) {
    logger.info(
      { event: "authorization.stale_policy_reevaluating", merchantId, proposalId, evaluatedVersion: policyEvaluation.evaluatedPolicyVersion, currentVersion: currentPolicy.policyVersion },
      "Policy version is stale; re-evaluating before authorization",
    );
    await evaluateProposalPolicy(prisma, merchantId, proposalId);
    proposal = await findProposalForGovernance(prisma, merchantId, proposalId);
    policyEvaluation = await findLatestPolicyEvaluation(prisma, proposalId);
    if (!proposal || !policyEvaluation) throw AppError.conflict("Proposal disappeared during re-evaluation.");
    if (proposal.status === "POLICY_DENIED") {
      return denyAuthorization(prisma, { workflowId: proposal.traceId, merchantId, proposalId }, "POLICY_VERSION_STALE", "Policy was re-evaluated under the current version and now denies this proposal.");
    }
    if (proposal.status === "PENDING_APPROVAL") {
      return denyAuthorization(prisma, { workflowId: proposal.traceId, merchantId, proposalId }, "POLICY_VERSION_STALE", "Policy was re-evaluated under the current version and now requires a fresh merchant approval.");
    }
  }

  const fingerprint = fingerprintFromProposal(proposal);
  if (fingerprint !== policyEvaluation.proposalFingerprint) {
    return denyAuthorization(prisma, { workflowId: proposal.traceId, merchantId, proposalId }, "PROPOSAL_CHANGED", "The proposal's financially meaningful content has changed since it was policy-evaluated.");
  }

  let approval: Approval | null = null;
  if (policyEvaluation.outcome === "DENY") {
    return denyAuthorization(prisma, { workflowId: proposal.traceId, merchantId, proposalId }, "POLICY_DENIED", "Policy denied this proposal; it can never be authorized.");
  }
  if (policyEvaluation.outcome === "REQUIRE_APPROVAL") {
    approval = await findApprovalByProposal(prisma, proposalId);
    if (!approval || approval.decision !== "APPROVED") {
      return denyAuthorization(prisma, { workflowId: proposal.traceId, merchantId, proposalId }, "APPROVAL_MISSING_OR_REJECTED", "This proposal requires merchant approval, and no valid approval exists.");
    }
    if (approval.proposalFingerprint !== fingerprint) {
      return denyAuthorization(prisma, { workflowId: proposal.traceId, merchantId, proposalId }, "PROPOSAL_CHANGED", "The proposal changed after approval was granted; the approval no longer applies.");
    }
    if (approval.expiresAt.getTime() <= now.getTime()) {
      return denyAuthorization(prisma, { workflowId: proposal.traceId, merchantId, proposalId }, "APPROVAL_EXPIRED", "The merchant's approval has expired.");
    }
  }

  const commerce = await revalidateCommerceFacts(prisma, merchantId, proposal.primaryProductId);
  if (!commerce.eligible) {
    return denyAuthorization(prisma, { workflowId: proposal.traceId, merchantId, proposalId }, "PRODUCT_NOT_ELIGIBLE", "The primary product is no longer agent-visible.");
  }
  if (!commerce.available) {
    return denyAuthorization(prisma, { workflowId: proposal.traceId, merchantId, proposalId }, "PRODUCT_NOT_AVAILABLE", "The primary product is no longer purchasable.");
  }
  const proposalCurrency = deriveProposalCurrency(proposal, currentPolicy.currency);
  if (commerce.currency && commerce.currency !== proposalCurrency) {
    return denyAuthorization(prisma, { workflowId: proposal.traceId, merchantId, proposalId }, "CURRENCY_MISMATCH", "The product's current currency no longer matches the proposal's currency.");
  }

  const { discountBps, discountMinor } = deriveDiscountBps(proposal);
  const orderAmountMinor = proposalOpportunity(proposal)?.potentialBasketMinor ?? null;
  const expiresAt = new Date(now.getTime() + currentPolicy.authorizationValidityMinutes * 60_000);

  try {
    const authRow = await withLedgerConcurrencyRetry(prisma, async (tx) => {
      const row = await createExecutionAuthorization(tx, {
        id: randomUUID(),
        proposalId: proposal!.id,
        proposalFingerprint: fingerprint,
        merchantId,
        policyEvaluationId: policyEvaluation!.id,
        approvalId: approval?.id ?? null,
        authorizedActionType: proposal!.actionType!,
        financialBounds: { actionType: proposal!.actionType, discountBps, discountMinor, orderAmountMinor, currency: proposalCurrency } as never,
        expiresAt,
        status: "ACTIVE",
      });
      await updateProposalGovernanceState(tx, proposal!.id, { status: "AUTHORIZED", executionAuthorizationId: row.id });
      await appendLedgerEvent(tx, {
        workflowId: proposal!.traceId,
        merchantId,
        actorType: "SYSTEM",
        actionType: "EXECUTION_AUTHORIZATION_ISSUED",
        conciseReason: `Execution authorization issued for ${proposal!.actionType}, active until ${expiresAt.toISOString()}.`,
        relatedEntityType: "ExecutionAuthorization",
        relatedEntityId: row.id,
        metadata: { proposalId: proposal!.id, policyDecisionId: policyEvaluation!.id, approvalId: approval?.id ?? null },
      });
      return row;
    });

    logger.info({ event: "authorization.issued", merchantId, proposalId, authorizationId: authRow.id }, "Execution authorization issued");
    return toExecutionAuthorizationDTO(authRow);
  } catch (err) {
    if (isAuthorizationUniqueConflict(err)) {
      // A concurrent request already issued the ACTIVE authorization for
      // this exact proposal (PART 05 §69, §96) — idempotent return of
      // whichever one won the race, never a duplicate.
      const winner = await findActiveExecutionAuthorization(prisma, proposalId);
      if (winner) return toExecutionAuthorizationDTO(winner);
    }
    throw err;
  }
}

export async function getExecutionAuthorization(prisma: PrismaClient, merchantId: string, id: string) {
  const row = await findExecutionAuthorizationById(prisma, merchantId, id);
  if (!row) throw AppError.notFound(`Execution authorization not found: ${id}`);
  return toExecutionAuthorizationDTO(row);
}
