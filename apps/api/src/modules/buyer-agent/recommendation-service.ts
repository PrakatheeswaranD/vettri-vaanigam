/**
 * Recommendation orchestration (PART 03 §35-§43, §95, §99, §156-§161).
 *
 * Owns the mode decision (§160) and is the ONLY place `AIProvider.
 * rankCandidates` is ever called — always on a small, bounded, already
 * hard-constraint-filtered candidate set (§31, §37), never the whole
 * catalog. Every code path ends in `buildRecommendedProduct`, which
 * intersects whatever reason codes a model proposed against the
 * INDEPENDENTLY, DETERMINISTICALLY computed true set (§47) — a model can
 * never get credit for a claim that isn't actually true of the candidate.
 */
import type { RecommendedProductDTO } from "@razorgrowth/contracts";
import {
  deriveReasonCodes,
  fallbackRank,
  validateGrounding,
  type AvailabilityState,
  type BuyerIntent,
  type FallbackRankCandidate,
  type ReasonCode,
} from "@razorgrowth/domain";
import { logger } from "../../observability/logger.js";
import type { AIProvider, RankingCandidateFacts } from "../agents/ai-provider.js";
import type { EvaluatedCandidate, EvaluatedCandidateSet } from "./candidate-evaluation.js";

export const MAX_RECOMMENDATIONS = 5;
export const MAX_AI_CANDIDATES = 20;

export type RecommendationMode =
  | "AI_RANKED"
  | "DETERMINISTIC_SINGLE_MATCH"
  | "DETERMINISTIC_FALLBACK"
  | "NEAR_MATCH"
  | "NO_MATCH";

export interface RecommendationOutcome {
  mode: RecommendationMode;
  recommendations: RecommendedProductDTO[];
  candidateProductIds: string[];
  groundingFailed: boolean;
}

function budgetDifference(candidate: EvaluatedCandidate): number {
  return candidate.violations.find((v) => v.type === "BUDGET_MAX")?.differenceMinor ?? Number.POSITIVE_INFINITY;
}

function countPreferenceMatches(candidate: EvaluatedCandidate, intent: BuyerIntent): number {
  return Object.entries(intent.preferredAttributes).filter(([key, value]) => {
    const actual = candidate.attributes[key] ?? candidate.attributes[key.toLowerCase()];
    return actual !== undefined && actual.toLowerCase() === value.toLowerCase();
  }).length;
}

function money(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amountMinor / 100);
}

/** Explain one ranked variant using only normalized intent and authoritative
 * catalogue facts. A model can influence ordering, never invent a reason. */
function buildGroundedExplanation(candidate: EvaluatedCandidate, intent: BuyerIntent, rank: number): string {
  const currency = candidate.product.commerce.currency;
  const clauses: string[] = [
    `Ranked #${rank}: this ${candidate.product.identity.category.toLowerCase()} costs ${money(candidate.priceMinor, currency)}`,
  ];

  if (intent.budget.maxMinor !== null) {
    const difference = intent.budget.maxMinor - candidate.priceMinor;
    clauses.push(
      difference >= 0
        ? `${money(difference, currency)} below your ${money(intent.budget.maxMinor, currency)} maximum`
        : `${money(Math.abs(difference), currency)} above your ${money(intent.budget.maxMinor, currency)} maximum, disclosed as a near match`,
    );
  }

  const requiredMatches = Object.entries(intent.requiredAttributes)
    .filter(([key, expected]) => candidate.attributes[key.toLowerCase()]?.toLowerCase() === expected.toLowerCase())
    .map(([key, expected]) => `${key} ${expected}`);
  if (requiredMatches.length > 0) clauses.push(`matches required ${requiredMatches.join(" and ")}`);

  const preferenceMatches = Object.entries(intent.preferredAttributes)
    .filter(([key, expected]) => candidate.attributes[key.toLowerCase()]?.toLowerCase() === expected.toLowerCase())
    .map(([key, expected]) => `${key} ${expected}`);
  if (preferenceMatches.length > 0) clauses.push(`also matches preferred ${preferenceMatches.join(" and ")}`);

  if (candidate.availabilityState === "IN_STOCK" || candidate.availabilityState === "LOW_STOCK") {
    clauses.push(candidate.availabilityState === "LOW_STOCK" ? "is purchasable with low stock" : "is currently in stock");
  }
  if (candidate.product.readiness.state === "AGENT_READY") {
    clauses.push("has complete merchant-authored price, inventory, shipping, and return evidence");
  }

  return `${clauses.join("; ")}.`;
}

function buildRecommendedProduct(
  candidate: EvaluatedCandidate,
  intent: BuyerIntent,
  rank: number,
  aiProposedReasonCodes?: string[],
): RecommendedProductDTO {
  const hasStrongMetadata = candidate.product.readiness.state === "AGENT_READY";
  const trueReasonCodes = deriveReasonCodes(
    {
      priceMinor: candidate.priceMinor,
      availabilityState: candidate.availabilityState as AvailabilityState,
      attributes: candidate.attributes,
      hasStrongMetadata,
      violations: candidate.violations,
    },
    intent,
  );

  // A model may only ever get credit for a reason code that is ALSO
  // independently, deterministically true (PART 03 §47) — intersect
  // rather than trust the model's proposal outright.
  const intersected = aiProposedReasonCodes
    ? trueReasonCodes.filter((code) => aiProposedReasonCodes.includes(code))
    : trueReasonCodes;
  const finalReasonCodes: ReasonCode[] = intersected.length > 0 ? intersected : trueReasonCodes;

  return {
    productId: candidate.product.productId,
    variantId: candidate.representativeVariantId,
    rank,
    matchType: candidate.matchType,
    reasonCodes: finalReasonCodes,
    explanation: buildGroundedExplanation(candidate, intent, rank),
    violations: candidate.violations,
    product: candidate.product,
  };
}

function toFallbackCandidate(candidate: EvaluatedCandidate, intent: BuyerIntent): FallbackRankCandidate {
  return {
    productId: candidate.product.productId,
    // PART 18 — rank on what the buyer would PAY. Ranking on list price
    // pushed a discounted product below undiscounted ones that cost the
    // buyer more, so a merchant-authorized offer could not reach the
    // shopper it was authorized for.
    priceMinor: candidate.effectivePriceMinor,
    readinessState: candidate.product.readiness.state,
    preferenceMatchCount: countPreferenceMatches(candidate, intent),
    hasStrongMetadata: candidate.product.readiness.state === "AGENT_READY",
  };
}

function toRankingFacts(candidate: EvaluatedCandidate): RankingCandidateFacts {
  return {
    productId: candidate.product.productId,
    category: candidate.product.identity.category,
    priceMinor: candidate.priceMinor,
    currency: candidate.product.commerce.currency,
    availabilityState: candidate.availabilityState,
    attributes: candidate.attributes,
    readinessState: candidate.product.readiness.state,
  };
}

function deterministicFallbackOrder(bounded: EvaluatedCandidate[], intent: BuyerIntent): RecommendedProductDTO[] {
  const orderedIds = fallbackRank(bounded.map((c) => toFallbackCandidate(c, intent)));
  return orderedIds.slice(0, MAX_RECOMMENDATIONS).map((productId, index) => {
    const candidate = bounded.find((c) => c.product.productId === productId)!;
    return buildRecommendedProduct(candidate, intent, index + 1);
  });
}

export async function buildRecommendations(
  provider: AIProvider,
  evaluated: EvaluatedCandidateSet,
  intent: BuyerIntent,
): Promise<RecommendationOutcome> {
  if (evaluated.exact.length === 0) {
    if (evaluated.nearMatch.length === 0) {
      return { mode: "NO_MATCH", recommendations: [], candidateProductIds: [], groundingFailed: false };
    }
    // PART 03 §159 — no AI call for near-match discovery; a small,
    // already-evaluated set is ordered purely by closeness to budget.
    const sorted = [...evaluated.nearMatch].sort((a, b) => budgetDifference(a) - budgetDifference(b)).slice(0, MAX_RECOMMENDATIONS);
    const recommendations = sorted.map((c, i) => buildRecommendedProduct(c, intent, i + 1));
    return {
      mode: "NEAR_MATCH",
      recommendations,
      candidateProductIds: sorted.map((c) => c.product.productId),
      groundingFailed: false,
    };
  }

  if (evaluated.exact.length === 1) {
    // PART 03 §158 — a single exact candidate needs no AI ranking call.
    const candidate = evaluated.exact[0]!;
    return {
      mode: "DETERMINISTIC_SINGLE_MATCH",
      recommendations: [buildRecommendedProduct(candidate, intent, 1)],
      candidateProductIds: [candidate.product.productId],
      groundingFailed: false,
    };
  }

  const bounded = evaluated.exact.slice(0, MAX_AI_CANDIDATES);
  const candidateProductIds = bounded.map((c) => c.product.productId);

  if (provider.mode !== "LIVE_ANTHROPIC") {
    // PART 03 §108 — the demo provider never gets labeled as if it ranked
    // with real model reasoning; go straight to the deterministic path.
    return {
      mode: "DETERMINISTIC_FALLBACK",
      recommendations: deterministicFallbackOrder(bounded, intent),
      candidateProductIds,
      groundingFailed: false,
    };
  }

  try {
    const maxResults = Math.min(MAX_RECOMMENDATIONS, bounded.length);
    const raw = await provider.rankCandidates({
      candidates: bounded.map(toRankingFacts),
      preferredAttributes: intent.preferredAttributes,
      maxResults,
    });
    const grounded = validateGrounding(raw, candidateProductIds, maxResults);

    if (!grounded.ok) {
      logger.warn({ event: "buyer_agent.grounding_failed", reason: grounded.reason }, "AI ranking failed grounding validation; using deterministic fallback");
      return {
        mode: "DETERMINISTIC_FALLBACK",
        recommendations: deterministicFallbackOrder(bounded, intent),
        candidateProductIds,
        groundingFailed: true,
      };
    }

    const recommendations = grounded.items.map((item) => {
      const candidate = bounded.find((c) => c.product.productId === item.productId)!;
      return buildRecommendedProduct(candidate, intent, item.rank, item.reasonCodes);
    });
    return { mode: "AI_RANKED", recommendations, candidateProductIds, groundingFailed: false };
  } catch (err) {
    logger.warn({ event: "buyer_agent.fallback_used", error: (err as Error).message }, "AI ranking call failed; using deterministic fallback");
    return {
      mode: "DETERMINISTIC_FALLBACK",
      recommendations: deterministicFallbackOrder(bounded, intent),
      candidateProductIds,
      groundingFailed: true,
    };
  }
}
