import type { GrowthActionProposal } from "@prisma/client";
import { MERCHANT_GROWTH_SCHEMA_VERSION, type GrowthActionProposalDTO } from "@razorgrowth/contracts";

/**
 * PART 05 §23-§25 — `policyStatus` mirrors the latest governance outcome
 * derived purely from `status` (no extra join needed for the common
 * case). `AUTHORIZED` is reachable via two paths — an automatic `ALLOW`,
 * or a `REQUIRE_APPROVAL` that a merchant then `APPROVED` — and
 * `approvalId` (set only on the approval path) disambiguates which one
 * actually happened.
 */
function derivePolicyStatus(row: GrowthActionProposal): GrowthActionProposalDTO["policyStatus"] {
  switch (row.status) {
    case "PROPOSED":
    case "REJECTED_VALIDATION":
      return "NOT_EVALUATED";
    case "ALLOWED":
      return "ALLOW";
    case "POLICY_DENIED":
      return "DENY";
    case "PENDING_APPROVAL":
    case "APPROVAL_REJECTED":
    case "APPROVED":
      return "REQUIRE_APPROVAL";
    case "AUTHORIZED":
      return row.approvalId ? "REQUIRE_APPROVAL" : "ALLOW";
    default:
      return "NOT_EVALUATED";
  }
}

export function toGrowthActionProposalDTO(row: GrowthActionProposal): GrowthActionProposalDTO {
  return {
    id: row.id,
    schemaVersion: MERCHANT_GROWTH_SCHEMA_VERSION,
    merchantId: row.merchantId,
    conversationId: row.conversationId,
    recommendationId: row.recommendationId,
    primaryProductId: row.primaryProductId,
    actionType: row.actionType,
    relatedProductIds: row.relatedProductIds as string[],
    offer:
      row.offerKind !== null
        ? { kind: row.offerKind, percentageBps: row.offerPercentageBps, amountMinor: row.offerAmountMinor }
        : null,
    offerCalculation: row.offerCalculation as GrowthActionProposalDTO["offerCalculation"],
    opportunity: row.opportunity as GrowthActionProposalDTO["opportunity"],
    evidence: row.evidence as GrowthActionProposalDTO["evidence"],
    reasonCodes: row.reasonCodes as GrowthActionProposalDTO["reasonCodes"],
    explanation: row.explanation,
    mode: row.mode,
    status: row.status,
    policyStatus: derivePolicyStatus(row),
    latestPolicyDecisionId: row.latestPolicyDecisionId,
    approvalId: row.approvalId,
    executionAuthorizationId: row.executionAuthorizationId,
    rejectionReason: row.rejectionReason,
    blockedOpportunities: row.blockedOpportunities as GrowthActionProposalDTO["blockedOpportunities"],
    traceId: row.traceId,
    createdAt: row.createdAt.toISOString(),
    recoveryAction: row.recoveryAction as GrowthActionProposalDTO["recoveryAction"],
    sourceOrderId: row.sourceOrderId,
    sourcePaymentId: row.sourcePaymentId,
    sourceCheckoutId: row.sourceCheckoutId,
  };
}
