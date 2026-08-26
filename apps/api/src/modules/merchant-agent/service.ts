/**
 * Merchant Agent orchestrator (PART 04 §5-§9, §77-§78, §148-§149).
 *
 * Buyer context -> deterministic Opportunity Engine -> bounded candidates
 * -> Merchant Agent (or deterministic fallback) -> GrowthActionProposal ->
 * runtime validation -> deterministic proposal validation -> PROPOSED /
 * REJECTED_VALIDATION. `policyStatus` is always `"NOT_EVALUATED"` — PART 05
 * owns real policy/approval. A validated proposal here is NOT execution
 * authorization (§149): future layers must revalidate authoritative
 * commerce state before anything money-affecting happens.
 */
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { GrowthActionProposalDTO, GrowthEvidenceDTO } from "@razorgrowth/contracts";
import {
  calculateOffer,
  calculateOpportunity,
  deterministicGrowthProposal,
  renderGrowthExplanation,
  validateGrowthProposal,
  type EligibleGrowthCandidate,
  type GrowthActionType,
  type GrowthReasonCode,
  type GrowthValidationContext,
  type RawGrowthProposalShape,
} from "@razorgrowth/domain";
import { AppError } from "../../http/errors.js";
import { formatMoney } from "../../lib/format.js";
import { logger } from "../../observability/logger.js";
import { appendLedgerEvent } from "../audit/ledger.js";
import type { AIProvider, GrowthCandidateFacts } from "../agents/ai-provider.js";
import { getAIProvider } from "../agents/provider-factory.js";
import { buildGrowthCandidates } from "./opportunity-engine.js";
import { toGrowthActionProposalDTO } from "./mapper.js";
import { attachReadinessContext } from "./readiness-context.js";
import {
  createProposal,
  findProposal,
  getConversationIntentSnapshot,
  getGrowthConfig,
  getRecommendationIntentSnapshot,
  getRecommendationRecord,
  listProposals,
} from "./repository.js";

const MAX_MERCHANT_AGENT_RETRIES = 1;

interface BuyerContextSignals {
  preferredAttributes: Record<string, string>;
  budgetMaxMinor: number | null;
}

interface IntentSnapshotShape {
  preferredAttributes?: Record<string, string>;
  budget?: { maxMinor: number | null };
}

async function resolveBuyerContext(
  prisma: PrismaClient,
  merchantId: string,
  conversationId: string | undefined,
  recommendationId: string | undefined,
): Promise<BuyerContextSignals> {
  const snapshot = conversationId
    ? await getConversationIntentSnapshot(prisma, merchantId, conversationId)
    : recommendationId
      ? await getRecommendationIntentSnapshot(prisma, merchantId, recommendationId)
      : null;

  if (!snapshot || typeof snapshot !== "object") return { preferredAttributes: {}, budgetMaxMinor: null };
  const intent = snapshot as IntentSnapshotShape;
  return {
    preferredAttributes: intent.preferredAttributes ?? {},
    budgetMaxMinor: intent.budget?.maxMinor ?? null,
  };
}

export function allowedActionTypes(config: { growthActionsEnabled: boolean; crossSellEnabled: boolean; upsellEnabled: boolean; bundleEnabled: boolean; boundedOffersEnabled: boolean }): GrowthActionType[] {
  if (!config.growthActionsEnabled) return [];
  const types: GrowthActionType[] = [];
  if (config.crossSellEnabled) types.push("CROSS_SELL");
  if (config.upsellEnabled) types.push("UPSELL");
  if (config.bundleEnabled) types.push("BUNDLE");
  if (config.boundedOffersEnabled) {
    types.push("BOUNDED_OFFER");
    // RECOVERY (PART 04 §15) is a bounded-incentive proposal by
    // construction — gated on the same flag rather than a separate one
    // the contract doesn't define.
    types.push("RECOVERY");
  }
  return types;
}

function toCandidateFacts(candidate: EligibleGrowthCandidate): GrowthCandidateFacts {
  return {
    productId: candidate.productId,
    category: "",
    priceMinor: candidate.priceMinor ?? 0,
    currency: "INR",
    availabilityState: candidate.availabilityState,
    attributes: candidate.attributes,
    readinessState: candidate.readinessState,
    relationship: candidate.relationshipType,
  };
}

function buildEvidence(
  candidate: EligibleGrowthCandidate | null,
  reasonCodes: GrowthReasonCode[],
  preferredAttributes: Record<string, string>,
  priceDeltaMinor: number | null,
): GrowthEvidenceDTO[] {
  const evidence: GrowthEvidenceDTO[] = [];
  if (candidate) {
    evidence.push({ type: "PRODUCT_RELATIONSHIP", detail: `${candidate.relationshipType} relationship to product ${candidate.productId}` });
    evidence.push({ type: "READINESS_STATE", detail: `Candidate readiness state: ${candidate.readinessState}` });
    evidence.push({ type: "AVAILABILITY", detail: `Candidate availability: ${candidate.availabilityState}` });
  }
  if (reasonCodes.includes("BUYER_PREFERENCE_MATCH")) {
    const [key, value] = Object.entries(preferredAttributes)[0] ?? [];
    if (key) evidence.push({ type: "BUYER_PREFERENCE", detail: `${key}: ${value}` });
  }
  if (priceDeltaMinor !== null) {
    evidence.push({ type: "PRICE_DELTA", detail: `${priceDeltaMinor} minor units` });
  }
  return evidence;
}

interface RecoveryProposalResult {
  raw: RawGrowthProposalShape;
  primaryPriceMinor: number;
  gapMinor: number;
}

/**
 * PART 04 §15, §43-§46 — a deterministic recovery offer sized to close
 * EXACTLY the buyer's disclosed near-match budget gap (never a guessed
 * incentive amount), capped at the merchant's configured discount
 * ceiling. Returns `null` whenever the trigger conditions aren't met
 * (no recommendation, not a NEAR_MATCH outcome, product doesn't match,
 * or there's genuinely no budget gap to close) so the caller falls back
 * to the normal relationship-based flow.
 */
async function tryBuildRecoveryProposal(
  prisma: PrismaClient,
  params: {
    merchantId: string;
    recommendationId: string;
    primaryProduct: { productId: string; commerce: { priceRange: { minMinor: number } | null } };
    buyerBudgetMaxMinor: number | null;
    maxProposedDiscountBps: number;
  },
): Promise<RecoveryProposalResult | null> {
  const record = await getRecommendationRecord(prisma, params.merchantId, params.recommendationId);
  if (!record || record.mode !== "NEAR_MATCH") return null;

  const recommendedProductIds = record.recommendedProductIds as string[];
  if (!recommendedProductIds.includes(params.primaryProduct.productId)) return null;

  const primaryPriceMinor = params.primaryProduct.commerce.priceRange?.minMinor;
  if (primaryPriceMinor === undefined || params.buyerBudgetMaxMinor === null) return null;
  if (primaryPriceMinor <= params.buyerBudgetMaxMinor) return null; // no gap to close

  const gapMinor = primaryPriceMinor - params.buyerBudgetMaxMinor;
  const requiredBps = Math.ceil((gapMinor * 10_000) / primaryPriceMinor);
  const offerBps = Math.min(requiredBps, params.maxProposedDiscountBps);

  return {
    primaryPriceMinor,
    gapMinor,
    raw: {
      actionType: "RECOVERY",
      primaryProductId: params.primaryProduct.productId,
      relatedProductIds: [params.primaryProduct.productId],
      offer: { kind: "PERCENTAGE", percentageBps: offerBps, amountMinor: null },
      reasonCodes: ["NO_EXACT_MATCH_RECOVERY", "PRICE_HESITATION"],
    },
  };
}

export interface HandleGrowthProposalParams {
  merchantId: string;
  conversationId?: string;
  recommendationId?: string;
  primaryProductId: string;
}

async function persistAndRespond(
  prisma: PrismaClient,
  params: {
    merchantId: string;
    conversationId: string | null;
    recommendationId: string | null;
    primaryProductId: string;
    traceId: string;
    mode: "AI_PROPOSED" | "DETERMINISTIC_RELATIONSHIP" | "DETERMINISTIC_FALLBACK" | "NO_OPPORTUNITY" | "BLOCKED_BY_DATA";
    validation: { ok: true; actionType: GrowthActionType } | { ok: false; reason: string };
    raw: RawGrowthProposalShape | null;
    evidence: GrowthEvidenceDTO[];
    offerCalculation: GrowthActionProposalDTO["offerCalculation"];
    opportunity: GrowthActionProposalDTO["opportunity"];
    blockedOpportunities: GrowthActionProposalDTO["blockedOpportunities"];
    ledgerConciseReason: string;
  },
): Promise<GrowthActionProposalDTO> {
  const status = params.raw && params.validation.ok ? "PROPOSED" : "REJECTED_VALIDATION";
  const explanation =
    params.raw && params.validation.ok
      ? renderGrowthExplanation((params.raw.reasonCodes.filter((c) => c) as GrowthReasonCode[]) ?? [])
      : !params.validation.ok
        ? `Proposal rejected: ${params.validation.reason}`
        : "No growth opportunity was identified for this product.";

  const row = await createProposal(prisma, {
    merchantId: params.merchantId,
    conversationId: params.conversationId,
    recommendationId: params.recommendationId,
    primaryProductId: params.primaryProductId,
    actionType: params.raw && params.validation.ok ? params.validation.actionType : null,
    relatedProductIds: params.raw?.relatedProductIds ?? [],
    offerKind: params.raw?.offer?.kind === "PERCENTAGE" || params.raw?.offer?.kind === "FIXED_AMOUNT" ? params.raw.offer.kind : null,
    offerPercentageBps: params.raw?.offer?.percentageBps ?? null,
    offerAmountMinor: params.raw?.offer?.amountMinor ?? null,
    offerCurrency: params.raw?.offer ? "INR" : null,
    offerCalculation: (params.offerCalculation as never) ?? null,
    opportunity: (params.opportunity as never) ?? null,
    evidence: params.evidence as never,
    reasonCodes: (params.raw?.reasonCodes ?? []) as string[],
    explanation,
    mode: params.mode,
    status,
    rejectionReason: !params.validation.ok ? params.validation.reason : null,
    blockedOpportunities: params.blockedOpportunities as never,
    traceId: params.traceId,
  });

  await appendLedgerEvent(prisma, {
    workflowId: params.traceId,
    merchantId: params.merchantId,
    actorType: "MERCHANT_AGENT",
    actionType: status === "PROPOSED" ? "GROWTH_PROPOSAL_CREATED" : "GROWTH_PROPOSAL_VALIDATION_FAILED",
    conciseReason: params.ledgerConciseReason,
    relatedEntityType: "GrowthActionProposal",
    relatedEntityId: row.id,
  });

  logger.info(
    { event: "merchant_agent.response_completed", merchantId: params.merchantId, traceId: params.traceId, mode: params.mode, status },
    "Merchant Agent response completed",
  );

  return toGrowthActionProposalDTO(row);
}

export async function proposeGrowthAction(
  prisma: PrismaClient,
  params: HandleGrowthProposalParams,
  providerOverride?: AIProvider,
): Promise<GrowthActionProposalDTO> {
  const traceId = randomUUID();
  const provider = providerOverride ?? getAIProvider();
  logger.info({ event: "merchant_agent.request_received", merchantId: params.merchantId, traceId, primaryProductId: params.primaryProductId }, "Merchant Agent request received");

  const config = await getGrowthConfig(prisma, params.merchantId);
  const allowed = allowedActionTypes(config);

  const conversationId = params.conversationId ?? null;
  const recommendationId = params.recommendationId ?? null;

  if (allowed.length === 0) {
    return persistAndRespond(prisma, {
      merchantId: params.merchantId,
      conversationId,
      recommendationId,
      primaryProductId: params.primaryProductId,
      traceId,
      mode: "NO_OPPORTUNITY",
      validation: { ok: false, reason: "Growth actions are disabled by merchant configuration." },
      raw: null,
      evidence: [],
      offerCalculation: null,
      opportunity: null,
      blockedOpportunities: [],
      ledgerConciseReason: "Growth actions are disabled by merchant configuration; no proposal generated.",
    });
  }

  const buyerContext = await resolveBuyerContext(prisma, params.merchantId, params.conversationId, params.recommendationId);
  const { primaryProduct, candidateSet, allCandidateProductIds } = await buildGrowthCandidates(
    prisma,
    params.merchantId,
    params.primaryProductId,
    allowed,
  );

  // PART 04 §15 — a NEAR_MATCH Buyer Agent outcome (recorded in PART 03's
  // own RecommendationRecord) is a real, deterministic recovery trigger:
  // the buyer's best option was over budget by a known, disclosed amount.
  // Propose a bounded discount that closes exactly that gap — never a
  // guessed incentive — instead of the normal relationship-based flow.
  if (recommendationId && config.boundedOffersEnabled) {
    const recoveryProposal = await tryBuildRecoveryProposal(prisma, {
      merchantId: params.merchantId,
      recommendationId,
      primaryProduct,
      buyerBudgetMaxMinor: buyerContext.budgetMaxMinor,
      maxProposedDiscountBps: config.maxProposedDiscountBps,
    });
    if (recoveryProposal) {
      logger.info({ event: "merchant_agent.recovery_proposal", merchantId: params.merchantId, traceId }, "Deterministic recovery proposal generated from a NEAR_MATCH buyer outcome");
      const validationContext: GrowthValidationContext = {
        candidateProductIds: [primaryProduct.productId],
        allowedActionTypes: allowed,
        maxProposedDiscountBps: config.maxProposedDiscountBps,
        maxUpsellIncreaseBps: config.maxUpsellIncreaseBps,
        maxCrossSellItems: config.maxCrossSellItems,
        maxBundleItems: config.maxBundleItems,
        buyerBudgetMaxMinor: buyerContext.budgetMaxMinor,
        candidatePricesMinor: { [primaryProduct.productId]: recoveryProposal.primaryPriceMinor },
        primaryProductPriceMinor: recoveryProposal.primaryPriceMinor,
        currency: primaryProduct.commerce.currency,
      };
      const validation = validateGrowthProposal(recoveryProposal.raw, validationContext);
      const offerCalculation = validation.ok && recoveryProposal.raw.offer
        ? { ...calculateOffer(recoveryProposal.primaryPriceMinor, {
            kind: recoveryProposal.raw.offer.kind as "PERCENTAGE" | "FIXED_AMOUNT",
            percentageBps: recoveryProposal.raw.offer.percentageBps,
            amountMinor: recoveryProposal.raw.offer.amountMinor,
          }), currency: primaryProduct.commerce.currency }
        : null;

      return persistAndRespond(prisma, {
        merchantId: params.merchantId,
        conversationId,
        recommendationId,
        primaryProductId: params.primaryProductId,
        traceId,
        mode: "DETERMINISTIC_RELATIONSHIP",
        validation,
        raw: recoveryProposal.raw,
        evidence: [
          { type: "PRICE_DELTA", detail: `Buyer's disclosed near-match budget gap: ${recoveryProposal.gapMinor} minor units` },
        ],
        offerCalculation,
        opportunity: null,
        blockedOpportunities: [],
        ledgerConciseReason: validation.ok
          ? `Proposed a bounded recovery discount closing a disclosed ${formatMoney(recoveryProposal.gapMinor, primaryProduct.commerce.currency)} budget gap.`
          : `Recovery proposal rejected by deterministic validation: ${validation.ok ? "" : validation.reason}`,
      });
    }
  }

  logger.info(
    {
      event: "merchant_agent.opportunities_generated",
      merchantId: params.merchantId,
      traceId,
      eligible: candidateSet.eligible.length,
      blocked: candidateSet.blocked.length,
    },
    "Growth opportunities generated",
  );

  const blockedOpportunities = await attachReadinessContext(
    prisma,
    params.merchantId,
    candidateSet.blocked.map((b) => ({
      productId: b.productId,
      actionType: b.actionType,
      blockerCode: b.blockerCode,
      remediation: blockerRemediation(b.blockerCode),
    })),
  );

  if (candidateSet.eligible.length === 0) {
    const mode = candidateSet.blocked.length > 0 ? "BLOCKED_BY_DATA" : "NO_OPPORTUNITY";
    logger.info({ event: mode === "BLOCKED_BY_DATA" ? "merchant_agent.opportunity_blocked" : "merchant_agent.no_opportunity", merchantId: params.merchantId, traceId }, "No eligible growth candidate");
    return persistAndRespond(prisma, {
      merchantId: params.merchantId,
      conversationId,
      recommendationId,
      primaryProductId: params.primaryProductId,
      traceId,
      mode,
      validation: { ok: false, reason: mode === "BLOCKED_BY_DATA" ? "Every candidate relationship is blocked by missing commerce data." : "No relevant growth candidate was found." },
      raw: null,
      evidence: [],
      offerCalculation: null,
      opportunity: null,
      blockedOpportunities,
      ledgerConciseReason:
        mode === "BLOCKED_BY_DATA"
          ? `Growth opportunity blocked: ${blockedOpportunities.map((b) => `${b.productId} (${b.blockerCode})`).join(", ")}.`
          : "No relevant growth opportunity was found for this product.",
    });
  }

  const primaryPriceMinor = primaryProduct.commerce.priceRange?.minMinor ?? 0;
  const validationContext: GrowthValidationContext = {
    candidateProductIds: allCandidateProductIds,
    allowedActionTypes: allowed,
    maxProposedDiscountBps: config.maxProposedDiscountBps,
    maxUpsellIncreaseBps: config.maxUpsellIncreaseBps,
    maxCrossSellItems: config.maxCrossSellItems,
    maxBundleItems: config.maxBundleItems,
    buyerBudgetMaxMinor: buyerContext.budgetMaxMinor,
    candidatePricesMinor: Object.fromEntries(candidateSet.eligible.map((c) => [c.productId, c.priceMinor ?? 0])),
    primaryProductPriceMinor: primaryPriceMinor,
    currency: primaryProduct.commerce.currency,
  };

  let raw: RawGrowthProposalShape;
  let mode: "AI_PROPOSED" | "DETERMINISTIC_RELATIONSHIP" | "DETERMINISTIC_FALLBACK";

  if (candidateSet.eligible.length === 1 || provider.mode !== "LIVE_ANTHROPIC") {
    // PART 04 §62 — a single obvious candidate, or the demo provider mode,
    // needs no AI reasoning call.
    const proposal = deterministicGrowthProposal(candidateSet.eligible, buyerContext.preferredAttributes);
    raw = { actionType: proposal.actionType ?? "CROSS_SELL", primaryProductId: primaryProduct.productId, relatedProductIds: proposal.relatedProductIds, offer: null, reasonCodes: proposal.reasonCodes };
    mode = "DETERMINISTIC_RELATIONSHIP";
  } else {
    let attemptRaw: RawGrowthProposalShape | null = null;
    for (let attempt = 0; attempt <= MAX_MERCHANT_AGENT_RETRIES; attempt++) {
      try {
        attemptRaw = await provider.proposeGrowthAction({
          primaryProduct: toCandidateFacts({ ...candidateSet.eligible[0]!, productId: primaryProduct.productId, priceMinor: primaryPriceMinor }),
          candidates: candidateSet.eligible.map(toCandidateFacts),
          buyerPreferredAttributes: buyerContext.preferredAttributes,
          buyerBudgetMaxMinor: buyerContext.budgetMaxMinor,
          allowedActionTypes: allowed,
          maxProposedDiscountBps: config.maxProposedDiscountBps,
          maxUpsellIncreaseBps: config.maxUpsellIncreaseBps,
        });
        break;
      } catch (err) {
        logger.warn({ event: "merchant_agent.proposal_failed", traceId, attempt, error: (err as Error).message }, "Merchant Agent proposal attempt failed");
      }
    }

    if (attemptRaw) {
      raw = attemptRaw;
      mode = "AI_PROPOSED";
    } else {
      logger.warn({ event: "merchant_agent.fallback_used", traceId }, "Merchant Agent AI proposal unavailable; using deterministic fallback");
      const proposal = deterministicGrowthProposal(candidateSet.eligible, buyerContext.preferredAttributes);
      raw = { actionType: proposal.actionType ?? "CROSS_SELL", primaryProductId: primaryProduct.productId, relatedProductIds: proposal.relatedProductIds, offer: null, reasonCodes: proposal.reasonCodes };
      mode = "DETERMINISTIC_FALLBACK";
    }
  }

  if (raw.actionType === "NO_OPPORTUNITY" || raw.relatedProductIds.length === 0) {
    return persistAndRespond(prisma, {
      merchantId: params.merchantId,
      conversationId,
      recommendationId,
      primaryProductId: params.primaryProductId,
      traceId,
      mode: "NO_OPPORTUNITY",
      validation: { ok: false, reason: "No relevant growth candidate was selected." },
      raw: null,
      evidence: [],
      offerCalculation: null,
      opportunity: null,
      blockedOpportunities,
      ledgerConciseReason: "Merchant Agent found no relevant growth opportunity for this selection.",
    });
  }

  const validation = validateGrowthProposal(raw, validationContext);

  if (!validation.ok) {
    logger.warn({ event: "merchant_agent.proposal_validation_failed", traceId, reason: validation.reason }, "Growth proposal failed validation");
    return persistAndRespond(prisma, {
      merchantId: params.merchantId,
      conversationId,
      recommendationId,
      primaryProductId: params.primaryProductId,
      traceId,
      mode,
      validation,
      raw,
      evidence: [],
      offerCalculation: null,
      opportunity: null,
      blockedOpportunities,
      ledgerConciseReason: `Growth proposal rejected by deterministic validation: ${validation.reason}`,
    });
  }

  logger.info({ event: "merchant_agent.proposal_generated", merchantId: params.merchantId, traceId, mode, actionType: validation.actionType }, "Growth proposal generated and validated");

  const targetProductId = raw.relatedProductIds[0]!;
  const targetCandidate = candidateSet.eligible.find((c) => c.productId === targetProductId) ?? null;
  const targetPriceMinor = targetCandidate?.priceMinor ?? 0;

  const offerCalculation =
    raw.offer !== null
      ? calculateOffer(validation.actionType === "UPSELL" ? targetPriceMinor : primaryPriceMinor, {
          kind: raw.offer.kind as "PERCENTAGE" | "FIXED_AMOUNT",
          percentageBps: raw.offer.percentageBps,
          amountMinor: raw.offer.amountMinor,
        })
      : null;

  const addedAmountMinor = validation.actionType === "UPSELL" ? targetPriceMinor - primaryPriceMinor : targetPriceMinor;
  const opportunity = calculateOpportunity(primaryPriceMinor, addedAmountMinor);

  const evidence = buildEvidence(
    targetCandidate,
    raw.reasonCodes.filter((c) => c) as GrowthReasonCode[],
    buyerContext.preferredAttributes,
    validation.actionType === "UPSELL" ? addedAmountMinor : null,
  );

  return persistAndRespond(prisma, {
    merchantId: params.merchantId,
    conversationId,
    recommendationId,
    primaryProductId: params.primaryProductId,
    traceId,
    mode,
    validation,
    raw,
    evidence,
    offerCalculation: offerCalculation ? { ...offerCalculation, currency: primaryProduct.commerce.currency } : null,
    opportunity: { ...opportunity, currency: primaryProduct.commerce.currency },
    blockedOpportunities,
    ledgerConciseReason: `Proposed ${validation.actionType} (${mode}) referencing ${raw.relatedProductIds.join(", ")}.`,
  });
}

function blockerRemediation(code: string): string {
  switch (code) {
    case "UNKNOWN_INVENTORY":
      return "Record current inventory for this product's variants.";
    case "MISSING_PRICE":
      return "Set an authoritative price for this product.";
    case "MISSING_VARIANT_ATTRIBUTE":
      return "Add structured variant attributes (e.g. size, color).";
    case "MISSING_POLICY_DATA":
      return "Add return and shipping policy information.";
    case "PRODUCT_NOT_AGENT_VISIBLE":
      return "Publish the product as ACTIVE so it is agent-visible.";
    default:
      return "Review the product's agent-readable data.";
  }
}

export async function getGrowthProposal(prisma: PrismaClient, merchantId: string, proposalId: string): Promise<GrowthActionProposalDTO> {
  const row = await findProposal(prisma, merchantId, proposalId);
  if (!row) throw AppError.notFound(`Growth action proposal not found: ${proposalId}`);
  return toGrowthActionProposalDTO(row);
}

export async function listGrowthProposals(prisma: PrismaClient, merchantId: string, limit: number): Promise<GrowthActionProposalDTO[]> {
  const rows = await listProposals(prisma, merchantId, limit);
  return rows.map(toGrowthActionProposalDTO);
}
