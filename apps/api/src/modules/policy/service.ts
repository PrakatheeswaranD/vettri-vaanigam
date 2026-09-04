/**
 * Deterministic Policy Engine orchestration (PART 05 §6-§22, §46-§47).
 *
 * This module's job is entirely data assembly and persistence around the
 * pure `evaluatePolicy` function in `@razorgrowth/domain` — it revalidates
 * authoritative commerce facts (never trusting anything the original AI
 * proposal claimed), builds the evaluation context, persists the decision,
 * transitions the proposal's governance status, and appends the ledger
 * event, all inside one transaction (§67). No AI provider is imported
 * here, directly or transitively (§100).
 */
import { randomUUID } from "node:crypto";
import type { GrowthActionProposal, Prisma, PrismaClient } from "@prisma/client";
import type { PolicyDecisionDTO } from "@razorgrowth/contracts";
import {
  evaluatePolicy,
  isValidProposalTransition,
  systemClock,
  type GrowthProposalStatus,
  type PolicyEvaluationInput,
} from "@razorgrowth/domain";
import { AppError } from "../../http/errors.js";
import { logger } from "../../observability/logger.js";
import { getAgentCatalogProduct } from "../agent-commerce/service.js";
import { getGrowthConfig } from "../merchant-agent/repository.js";
import { allowedActionTypes } from "../merchant-agent/service.js";
import { appendLedgerEvent, withLedgerConcurrencyRetry } from "../audit/ledger.js";
import { computeProposalFingerprint, PROPOSAL_FINGERPRINT_VERSION } from "./fingerprint.js";
import { toPolicyDecisionDTO } from "./mapper.js";
import {
  countPriorRecoveryAttempts,
  createPolicyEvaluation,
  findPolicyEvaluationById,
  findProposalForGovernance,
  getMerchantPolicy,
  updateProposalGovernanceState,
} from "./repository.js";

/** Statuses from which a (re-)evaluation is meaningful. `AUTHORIZED` is
 * excluded deliberately — once execution authorization has been issued,
 * re-deciding policy on the same proposal is out of scope for PART 05
 * (a changed policy after authorization is a PART 06/07 revocation
 * concern, not a re-evaluation one). */
const EVALUABLE_STATUSES: readonly GrowthProposalStatus[] = ["PROPOSED", "ALLOWED", "PENDING_APPROVAL", "APPROVED"];

interface CommerceFacts {
  eligible: boolean;
  available: boolean;
  currency: string | null;
}

/**
 * A JSON column is `unknown` until something checks it. Parsed once here
 * rather than cast at each use site: a malformed row should degrade to "no
 * restriction configured" in one obvious place, not throw from inside the
 * policy engine.
 */
function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function asNumberMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, number] => typeof entry[1] === "number"));
}

export async function revalidateCommerceFacts(prisma: PrismaClient, merchantId: string, productId: string): Promise<CommerceFacts> {
  try {
    const product = await getAgentCatalogProduct(prisma, merchantId, productId);
    return {
      eligible: true,
      available: product.commerce.purchasableVariantCount > 0,
      currency: product.commerce.currency,
    };
  } catch {
    // Not found / no longer ACTIVE / no longer agent-visible — never a
    // reason to throw here, just a fact the Policy Engine must see.
    return { eligible: false, available: false, currency: null };
  }
}

/**
 * The margin a discounted line would leave, in basis points.
 *
 * COMPUTED FROM THE MERCHANT'S OWN COST, OR NOT AT ALL.
 *
 * `(price - cost) / price`, using the CHEAPEST active variant — the one a
 * discount is most likely to push under the floor. Returns null when no
 * active variant records a cost, because a margin nobody recorded the
 * inputs for is not a number this may invent. The engine treats a null
 * margin as a breach when a floor is set, which is the conservative
 * reading and the one a floor implies.
 */
async function computeMarginBps(
  prisma: PrismaClient,
  merchantId: string,
  productId: string,
  discountBps: number | null,
): Promise<number | null> {
  const variant = await prisma.productVariant.findFirst({
    where: { productId, active: true, costMinor: { not: null }, product: { merchantId } },
    orderBy: { priceMinor: "asc" },
    select: { priceMinor: true, costMinor: true },
  });
  if (!variant || variant.costMinor === null || variant.priceMinor <= 0) return null;

  // The price AFTER the proposed discount — the floor is about what the
  // merchant would actually receive, not the list price.
  const effectivePriceMinor = Math.round(variant.priceMinor * (1 - (discountBps ?? 0) / 10_000));
  if (effectivePriceMinor <= 0) return 0;
  return Math.round(((effectivePriceMinor - variant.costMinor) / effectivePriceMinor) * 10_000);
}

/**
 * How many unattended actions this merchant's agent has already taken
 * today (UTC).
 *
 * Counted from `ExecutionAuthorization` rows ISSUED, not proposals
 * raised: a proposal the policy engine denied consumed none of the
 * merchant's autonomy budget, and counting it would let a run of denials
 * exhaust a limit that exists to bound what actually happens.
 */
async function countAutonomousActionsToday(prisma: PrismaClient, merchantId: string): Promise<number> {
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  return prisma.executionAuthorization.count({
    where: { merchantId, createdAt: { gte: startOfDay } },
  });
}

/**
 * Paid orders the customer this proposal targets already has, or null when
 * it targets nobody in particular.
 *
 * Null is not zero. A catalogue-wide cross-sell has no customer to be
 * ineligible, and treating "nobody" as "somebody with no history" would
 * deny every untargeted action the moment a merchant required one prior
 * order.
 */
async function countTargetCustomerPaidOrders(
  prisma: PrismaClient,
  merchantId: string,
  sourceOrderId: string | null,
): Promise<number | null> {
  if (!sourceOrderId) return null;
  const order = await prisma.order.findFirst({
    where: { id: sourceOrderId, merchantId },
    select: { customerId: true },
  });
  if (!order?.customerId) return null;
  return prisma.order.count({ where: { merchantId, customerId: order.customerId, status: "PAID" } });
}

export function proposalOpportunity(proposal: GrowthActionProposal): { potentialBasketMinor?: number; currency?: string } | null {
  return (proposal.opportunity as { potentialBasketMinor?: number; currency?: string } | null) ?? null;
}

function proposalOfferCalculation(proposal: GrowthActionProposal): { baseAmountMinor?: number; discountMinor?: number } | null {
  return (proposal.offerCalculation as { baseAmountMinor?: number; discountMinor?: number } | null) ?? null;
}

export function deriveDiscountBps(proposal: GrowthActionProposal): { discountBps: number | null; discountMinor: number | null } {
  if (!proposal.offerKind) return { discountBps: null, discountMinor: null };
  const calc = proposalOfferCalculation(proposal);
  const discountMinor = calc?.discountMinor ?? null;
  if (proposal.offerKind === "PERCENTAGE") {
    return { discountBps: proposal.offerPercentageBps, discountMinor };
  }
  // FIXED_AMOUNT — convert to an implied bps-of-base figure, the same
  // convention `validateGrowthProposal` (PART 04) already uses, so a fixed
  // discount cannot be used to sidestep the same percentage-shaped ceiling.
  const base = calc?.baseAmountMinor ?? 0;
  const impliedBps = base > 0 && discountMinor !== null ? Math.floor((discountMinor * 10_000) / base) : 0;
  return { discountBps: impliedBps, discountMinor };
}

export function deriveProposalCurrency(proposal: GrowthActionProposal, policyCurrency: string): string {
  return proposal.offerCurrency ?? proposalOpportunity(proposal)?.currency ?? policyCurrency;
}

export function fingerprintFromProposal(proposal: GrowthActionProposal) {
  return computeProposalFingerprint({
    proposalId: proposal.id,
    merchantId: proposal.merchantId,
    actionType: proposal.actionType,
    primaryProductId: proposal.primaryProductId,
    relatedProductIds: proposal.relatedProductIds as string[],
    offerKind: proposal.offerKind,
    offerPercentageBps: proposal.offerPercentageBps,
    offerAmountMinor: proposal.offerAmountMinor,
    currency: proposal.offerCurrency,
  });
}

function nextStatusForOutcome(outcome: "ALLOW" | "DENY" | "REQUIRE_APPROVAL"): GrowthProposalStatus {
  if (outcome === "ALLOW") return "ALLOWED";
  if (outcome === "DENY") return "POLICY_DENIED";
  return "PENDING_APPROVAL";
}

/**
 * Evaluates (or re-evaluates) policy for one proposal and persists the
 * result. This is the ONLY function that produces a `PolicyEvaluation`
 * row — callers (the `/policy/evaluate` route, and the authorization
 * service's stale-policy re-evaluation path) both go through this, never
 * duplicate the assembly logic.
 */
/**
 * `unattended` is the caller telling the engine whether a human is
 * present. It defaults to FALSE — the safe direction, because the daily
 * ceiling it gates only ever restricts, and a caller that forgets to pass
 * it gets the supervised behaviour rather than accidentally exempting a
 * scheduled run from a limit set for exactly that case.
 *
 * The scheduler passes true. Every merchant-triggered path leaves it
 * alone.
 */
export async function evaluateProposalPolicy(
  prisma: PrismaClient,
  merchantId: string,
  proposalId: string,
  options: { unattended?: boolean } = {},
): Promise<PolicyDecisionDTO> {
  const proposal = await findProposalForGovernance(prisma, merchantId, proposalId);
  if (!proposal) throw AppError.notFound(`Growth action proposal not found: ${proposalId}`);

  if (!EVALUABLE_STATUSES.includes(proposal.status)) {
    throw new AppError(
      "INVALID_STATE_TRANSITION",
      `Proposal is in terminal status "${proposal.status}" and cannot be (re-)evaluated by policy.`,
    );
  }
  if (!proposal.actionType) {
    throw AppError.conflict("Proposal has no action type (failed validation) and cannot be policy-evaluated.");
  }

  const [policy, growthConfig, commerceFacts] = await Promise.all([
    getMerchantPolicy(prisma, merchantId),
    getGrowthConfig(prisma, merchantId),
    revalidateCommerceFacts(prisma, merchantId, proposal.primaryProductId),
  ]);

  const { discountBps, discountMinor } = deriveDiscountBps(proposal);

  // PART 08 facts. All revalidated HERE, at evaluation time, from the
  // merchant's own rows — never read off the proposal, which is a document
  // an agent authored.
  const [marginBps, customerPaidOrderCount, autonomousActionsToday, product, targetOrder] = await Promise.all([
    computeMarginBps(prisma, merchantId, proposal.primaryProductId, discountBps),
    countTargetCustomerPaidOrders(prisma, merchantId, proposal.sourceOrderId),
    countAutonomousActionsToday(prisma, merchantId),
    prisma.product.findFirst({
      where: { id: proposal.primaryProductId, merchantId },
      select: { category: true },
    }),
    proposal.sourceOrderId ? prisma.order.findFirst({ where: { id: proposal.sourceOrderId, merchantId }, select: { customerId: true } }) : null,
  ]);
  const excludedProducts = asStringArray(growthConfig.excludedProductIds);
  const excludedCustomers = asStringArray(growthConfig.excludedCustomerIds);
  const portfolioEligible = !excludedProducts.includes(proposal.primaryProductId) && !(targetOrder?.customerId && excludedCustomers.includes(targetOrder.customerId));
  const actionTypeEnabled = allowedActionTypes(growthConfig).includes(proposal.actionType) && portfolioEligible;
  const categoryCeiling = product?.category ? asNumberMap(growthConfig.categoryDiscountLimits)[product.category] : undefined;
  const portfolioMaxDiscountBps = categoryCeiling === undefined ? policy.maxDiscountBps : Math.min(policy.maxDiscountBps, categoryCeiling);
  const orderAmountMinor = proposalOpportunity(proposal)?.potentialBasketMinor ?? null;
  const recoveryAttemptCount =
    proposal.actionType === "RECOVERY"
      ? await countPriorRecoveryAttempts(prisma, merchantId, { recommendationId: proposal.recommendationId, sourceOrderId: proposal.sourceOrderId }, proposal.id)
      : 0;

  const input: PolicyEvaluationInput = {
    now: systemClock.now(),
    policy: {
      policyVersion: policy.policyVersion,
      currency: policy.currency,
      maxDiscountBps: portfolioMaxDiscountBps,
      autoApprovalDiscountBps: Math.min(policy.autoApprovalDiscountBps, portfolioMaxDiscountBps),
      maxOrderAmountMinor: policy.maxOrderAmountMinor,
      autoApprovalOrderAmountMinor: policy.autoApprovalOrderAmountMinor,
      maxRecoveryAttempts: policy.maxRecoveryAttempts,
      proposalValidityMinutes: policy.proposalValidityMinutes,
      minMarginBps: policy.minMarginBps,
      maxAutonomousActionsPerDay: policy.maxAutonomousActionsPerDay,
      recoveryEnabled: policy.recoveryEnabled,
      prohibitedActions: asStringArray(policy.prohibitedActions),
      eligibleCategories: asStringArray(policy.eligibleCategories),
      minCustomerPaidOrders: policy.minCustomerPaidOrders,
    },
    proposal: {
      createdAt: proposal.createdAt,
      currency: deriveProposalCurrency(proposal, policy.currency),
      actionType: proposal.actionType,
      actionTypeEnabled,
      discountBps,
      discountMinor,
      orderAmountMinor,
      productEligible: commerceFacts.eligible,
      productAvailable: commerceFacts.available,
      recoveryAttemptCount,
      marginBps,
      productCategory: product?.category ?? null,
      customerPaidOrderCount,
      autonomousActionsToday,
      unattended: options.unattended ?? false,
    },
  };

  const result = evaluatePolicy(input);
  const fingerprint = fingerprintFromProposal(proposal);
  const nextStatus = nextStatusForOutcome(result.outcome);

  if (!isValidProposalTransition(proposal.status, nextStatus)) {
    throw new AppError("INVALID_STATE_TRANSITION", `Cannot transition proposal from "${proposal.status}" to "${nextStatus}".`);
  }

  const decisionRow = await withLedgerConcurrencyRetry(prisma, async (tx) => {
    const row = await createPolicyEvaluation(tx, {
      id: randomUUID(),
      proposalId: proposal.id,
      merchantId,
      workflowId: proposal.traceId,
      outcome: result.outcome,
      reasonCodes: result.reasonCodes,
      explanation: result.explanation,
      evaluatedPolicyVersion: policy.policyVersion,
      evaluatedValues: result.evaluatedValues as unknown as Prisma.InputJsonValue,
      proposalFingerprint: fingerprint,
      fingerprintVersion: PROPOSAL_FINGERPRINT_VERSION,
    });

    await updateProposalGovernanceState(tx, proposal.id, {
      status: nextStatus,
      latestPolicyDecisionId: row.id,
    });

    await appendLedgerEvent(tx, {
      workflowId: proposal.traceId,
      merchantId,
      actorType: "POLICY_ENGINE",
      actionType: result.outcome === "ALLOW" ? "POLICY_ALLOWED" : result.outcome === "DENY" ? "POLICY_DENIED" : "POLICY_EVALUATED",
      conciseReason: result.explanation,
      policyDecision: result.outcome,
      relatedEntityType: "PolicyEvaluation",
      relatedEntityId: row.id,
      metadata: { proposalId: proposal.id, reasonCodes: result.reasonCodes, evaluatedPolicyVersion: policy.policyVersion },
    });

    if (result.outcome === "REQUIRE_APPROVAL") {
      await appendLedgerEvent(tx, {
        workflowId: proposal.traceId,
        merchantId,
        actorType: "SYSTEM",
        actionType: "APPROVAL_REQUESTED",
        status: "PENDING_APPROVAL",
        conciseReason: "Awaiting merchant approval before execution can be authorized.",
        relatedEntityType: "GrowthActionProposal",
        relatedEntityId: proposal.id,
        metadata: { proposalId: proposal.id, reasonCodes: result.reasonCodes },
      });
    }

    return row;
  });

  logger.info(
    { event: "policy.evaluated", merchantId, proposalId: proposal.id, outcome: result.outcome, reasonCodes: result.reasonCodes },
    "Policy evaluated",
  );

  return toPolicyDecisionDTO(decisionRow);
}

export async function getPolicyDecision(prisma: PrismaClient, merchantId: string, id: string) {
  const row = await findPolicyEvaluationById(prisma, merchantId, id);
  if (!row) throw AppError.notFound(`Policy decision not found: ${id}`);
  return toPolicyDecisionDTO(row);
}
