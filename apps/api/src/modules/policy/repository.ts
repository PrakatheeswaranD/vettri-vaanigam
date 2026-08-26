import type { Prisma, PrismaClient } from "@prisma/client";

const DEFAULT_MERCHANT_POLICY = {
  policyVersion: 1,
  currency: "INR" as const,
  maxDiscountBps: 1000,
  autoApprovalDiscountBps: 300,
  maxOrderAmountMinor: 5_000_000,
  autoApprovalOrderAmountMinor: 1_000_000,
  maxRecoveryAttempts: 2,
  proposalValidityMinutes: 30,
  approvalValidityMinutes: 15,
  authorizationValidityMinutes: 10,
};

/** Falls back to conservative defaults if a merchant somehow has no policy
 * row yet (mirrors `getGrowthConfig`'s own fallback convention) — never
 * crashes policy evaluation over missing configuration. */
export async function getMerchantPolicy(prisma: PrismaClient, merchantId: string) {
  const policy = await prisma.merchantPolicy.findUnique({ where: { merchantId } });
  return policy ?? { merchantId, ...DEFAULT_MERCHANT_POLICY, updatedAt: new Date() };
}

export interface MerchantPolicyUpdateInput {
  maxDiscountBps: number;
  autoApprovalDiscountBps: number;
  maxOrderAmountMinor: number;
  autoApprovalOrderAmountMinor: number;
  maxRecoveryAttempts: number;
  proposalValidityMinutes: number;
  approvalValidityMinutes: number;
  authorizationValidityMinutes: number;
}

/** PART 05 §12, §76 — every edit increments `policyVersion`, so a decision
 * already evaluated under the previous version can never be silently
 * treated as current. */
export async function updateMerchantPolicy(prisma: PrismaClient, merchantId: string, input: MerchantPolicyUpdateInput) {
  const current = await getMerchantPolicy(prisma, merchantId);
  return prisma.merchantPolicy.upsert({
    where: { merchantId },
    create: { merchantId, ...input, policyVersion: 1 },
    update: { ...input, policyVersion: current.policyVersion + 1 },
  });
}

export function findProposalForGovernance(prisma: PrismaClient, merchantId: string, proposalId: string) {
  return prisma.growthActionProposal.findFirst({ where: { id: proposalId, merchantId } });
}

export function createPolicyEvaluation(tx: Prisma.TransactionClient, data: Prisma.PolicyEvaluationUncheckedCreateInput) {
  return tx.policyEvaluation.create({ data });
}

export function findLatestPolicyEvaluation(prisma: PrismaClient, proposalId: string) {
  return prisma.policyEvaluation.findFirst({ where: { proposalId }, orderBy: { createdAt: "desc" } });
}

export function findPolicyEvaluationById(prisma: PrismaClient, merchantId: string, id: string) {
  return prisma.policyEvaluation.findFirst({ where: { id, merchantId } });
}

/** PART 05 §8, §90 / PART 08 §22 `RECOVERY_LIMIT_EXCEEDED` — counts prior
 * RECOVERY proposals that actually reached policy evaluation (a proposal
 * rejected at validation was never a real "attempt"). Two distinct
 * RECOVERY flavors are grouped by two distinct keys, never conflated:
 * `sourceOrderId` (PART 08 payment-failure recovery — takes precedence
 * when present, since a proposal for a payment-failure recovery always
 * sets it) or, failing that, `recommendationId` (PART 04's buyer-budget
 * recovery). Neither key present counts as zero prior attempts. */
export async function countPriorRecoveryAttempts(
  prisma: PrismaClient,
  merchantId: string,
  groupKey: { recommendationId: string | null; sourceOrderId: string | null },
  excludeProposalId: string,
): Promise<number> {
  if (groupKey.sourceOrderId) {
    return prisma.growthActionProposal.count({
      where: {
        merchantId,
        sourceOrderId: groupKey.sourceOrderId,
        actionType: "RECOVERY",
        id: { not: excludeProposalId },
        policyEvaluations: { some: {} },
      },
    });
  }
  if (!groupKey.recommendationId) return 0;
  return prisma.growthActionProposal.count({
    where: {
      merchantId,
      recommendationId: groupKey.recommendationId,
      actionType: "RECOVERY",
      id: { not: excludeProposalId },
      policyEvaluations: { some: {} },
    },
  });
}

export function createApproval(tx: Prisma.TransactionClient, data: Prisma.ApprovalUncheckedCreateInput) {
  return tx.approval.create({ data });
}

export function findApprovalByProposal(prisma: PrismaClient, proposalId: string) {
  return prisma.approval.findUnique({ where: { proposalId } });
}

export function createExecutionAuthorization(
  tx: Prisma.TransactionClient,
  data: Prisma.ExecutionAuthorizationUncheckedCreateInput,
) {
  return tx.executionAuthorization.create({ data });
}

export function findActiveExecutionAuthorization(prisma: PrismaClient, proposalId: string) {
  return prisma.executionAuthorization.findFirst({
    where: { proposalId, status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
  });
}

export function findExecutionAuthorizationById(prisma: PrismaClient, merchantId: string, id: string) {
  return prisma.executionAuthorization.findFirst({ where: { id, merchantId } });
}

/**
 * PART 06 §7-§8, §47 — atomically flips `ACTIVE -> CONSUMED`, guarded by
 * the WHERE clause rather than a read-then-write, so two concurrent
 * commerce executions racing on the same authorization can never both
 * succeed: Postgres serializes the two `UPDATE`s against the same row,
 * and whichever runs second sees `status != 'ACTIVE'` and affects zero
 * rows. The caller (`commerce/execution-service.ts`) must treat
 * `count !== 1` as a hard conflict and roll back the whole transaction —
 * never proceed as if consumption succeeded.
 */
export async function consumeExecutionAuthorization(tx: Prisma.TransactionClient, id: string): Promise<boolean> {
  const result = await tx.executionAuthorization.updateMany({
    where: { id, status: "ACTIVE" },
    data: { status: "CONSUMED" },
  });
  return result.count === 1;
}

export function listPendingApprovals(prisma: PrismaClient, merchantId: string, limit: number) {
  return prisma.growthActionProposal.findMany({
    where: { merchantId, status: "PENDING_APPROVAL" },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export interface ProposalGovernanceUpdate {
  status: Prisma.GrowthActionProposalUncheckedUpdateInput["status"];
  latestPolicyDecisionId?: string | null;
  approvalId?: string | null;
  executionAuthorizationId?: string | null;
}

export function updateProposalGovernanceState(
  tx: Prisma.TransactionClient,
  proposalId: string,
  update: ProposalGovernanceUpdate,
) {
  return tx.growthActionProposal.update({ where: { id: proposalId }, data: update });
}
