/**
 * Deterministic DEMO/TEST rule-based `AIProvider` (PART 03 §10, §108).
 *
 * Used whenever `AI_PROVIDER_API_KEY` is not configured — i.e. the default
 * out-of-the-box state for this repository. It is intentionally simple
 * keyword/regex extraction, clearly labeled `mode: "DEMO_RULE_BASED"` in
 * every response (never presented as live AI), so the full golden path —
 * intent → constraints → catalog → recommendation → grounding — works
 * end to end with zero network dependency and zero API cost. This is a
 * deliberate reliability choice for a jury demo (PART 00 §46), not a fake
 * LLM standing in for a real one: it never claims model reasoning, and
 * `rankCandidates` performs the exact same deterministic ranking a
 * grounding-fallback would use (PART 03 §158-§161), so this provider never
 * fabricates an "AI_RANKED" result either.
 */
import {
  RELATIONSHIP_ACTION_TYPE,
  deterministicGrowthProposal,
  fallbackRank,
  isPurchasable,
  type AvailabilityState,
  type EligibleGrowthCandidate,
  type FallbackRankCandidate,
  type ProductRelationshipType,
} from "@razorgrowth/domain";
import type {
  AIProvider,
  ExtractIntentParams,
  ProposeGrowthActionParams,
  ProposeRecoveryActionParams,
  RankCandidatesParams,
  RawGrowthProposal,
  RawIntentExtraction,
  RawRankedItem,
  RawRecoveryProposal,
} from "../ai-provider.js";

const KNOWN_COLORS = ["black", "white", "grey", "gray", "blue", "red", "navy"];

/** Adjectives that only ever surface as PREFERENCES in this project's own
 * examples (PART 03 §12-§14) — never treated as hard requirements, so a
 * buyer is never wrongly excluded from products that fit every hard
 * constraint just because they used descriptive language. */
const PREFERENCE_ATTRIBUTE_KEYWORDS: Record<string, [key: string, value: string]> = {
  lightweight: ["weight", "lightweight"],
  "light weight": ["weight", "lightweight"],
  waterproof: ["feature", "waterproof"],
  breathable: ["feature", "breathable"],
  cushioned: ["feature", "cushioned"],
  road: ["surface", "road"],
  trail: ["surface", "trail"],
};

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };

function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/[,₹\s]/g, "").toLowerCase();
  const kMatch = cleaned.match(/^([0-9]+(?:\.[0-9]+)?)k$/);
  if (kMatch) return Number(kMatch[1]) * 1000;
  const plain = Number(cleaned);
  return Number.isFinite(plain) ? plain : null;
}

function extractBudget(message: string): { min: number | null; max: number | null } {
  const lower = message.toLowerCase();
  const amountToken = "(?:rs\\.?|inr|₹)?\\s*[0-9][0-9,]*(?:\\.[0-9]+)?\\s*k?";

  const rangeMatch = lower.match(new RegExp(`between\\s+(${amountToken})\\s+and\\s+(${amountToken})`));
  if (rangeMatch) {
    const min = parseAmount(rangeMatch[1]!);
    const max = parseAmount(rangeMatch[2]!);
    return { min, max };
  }

  const maxMatch = lower.match(
    new RegExp(`(?:under|below|less than|up to|within|around|about|max(?:imum)?|budget\\s+(?:is|of)|willing to (?:spend|pay))\\s+(${amountToken})`),
  );
  const minMatch = lower.match(new RegExp(`(?:over|above|at least|minimum|more than)\\s+(${amountToken})`));

  return {
    min: minMatch ? parseAmount(minMatch[1]!) : null,
    max: maxMatch ? parseAmount(maxMatch[1]!) : null,
  };
}

function extractCategory(message: string, knownCategories: string[]): string | null {
  const lower = message.toLowerCase();
  for (const category of knownCategories) {
    const categoryLower = category.toLowerCase();
    if (lower.includes(categoryLower)) return category;
    const singular = categoryLower.replace(/s$/, "");
    if (singular.length > 2 && lower.includes(singular)) return category;
  }
  return null;
}

function extractSize(message: string): string | null {
  const match = message.match(/\bsize\s*(?:uk)?\s*(\d{1,2})\b/i) ?? message.match(/\buk\s?(\d{1,2})\b/i);
  return match ? `UK${match[1]}` : null;
}

function extractColors(message: string): { required: string | null; excluded: string[] } {
  const lower = message.toLowerCase();
  let requiredColor: string | null = null;
  const excludedColors: string[] = [];

  for (const color of KNOWN_COLORS) {
    const idx = lower.indexOf(color);
    if (idx === -1) continue;
    const precedingText = lower.slice(Math.max(0, idx - 15), idx);
    const normalized = color === "gray" ? "Grey" : color.charAt(0).toUpperCase() + color.slice(1);
    if (/\b(not|except|excluding|no)\s+$/.test(precedingText.trim() + " ")) {
      excludedColors.push(normalized);
    } else {
      requiredColor = normalized;
    }
  }
  return { required: requiredColor, excluded: excludedColors };
}

function extractPreferences(message: string): Record<string, string> {
  const lower = message.toLowerCase();
  const preferences: Record<string, string> = {};
  for (const [keyword, [key, value]] of Object.entries(PREFERENCE_ATTRIBUTE_KEYWORDS)) {
    if (lower.includes(keyword)) preferences[key] = value;
  }
  return preferences;
}

function extractQuantity(message: string): number | null {
  const digitMatch = message.match(/\b(\d+)\s*(?:pairs?|pieces?|units?|items?)\b/i);
  if (digitMatch) return Number(digitMatch[1]);
  const lower = message.toLowerCase();
  for (const [word, value] of Object.entries(NUMBER_WORDS)) {
    if (new RegExp(`\\b${word}\\s+(?:pairs?|pieces?|units?|items?)\\b`).test(lower)) return value;
  }
  return null;
}

function extractAvailabilityRequirement(message: string): "PURCHASABLE_ONLY" | "INCLUDE_UNAVAILABLE" | null {
  const lower = message.toLowerCase();
  if (/(even if|show.*unavailable|include.*unavailable|out of stock too)/.test(lower)) return "INCLUDE_UNAVAILABLE";
  if (/(in stock|available now|currently available)/.test(lower)) return "PURCHASABLE_ONLY";
  return null;
}

export function createDemoRuleBasedProvider(): AIProvider {
  return {
    mode: "DEMO_RULE_BASED",

    async extractIntent(params: ExtractIntentParams): Promise<RawIntentExtraction> {
      const { message, knownCategories } = params;
      const budget = extractBudget(message);
      const size = extractSize(message);
      const colors = extractColors(message);
      const preferences = extractPreferences(message);
      const quantity = extractQuantity(message);
      const availabilityRequirement = extractAvailabilityRequirement(message);
      const category = extractCategory(message, knownCategories);

      const requiredAttributes: Record<string, string> = {};
      if (size) requiredAttributes.size = size;
      if (colors.required) requiredAttributes.color = colors.required;

      const excludedAttributes: Record<string, string[]> = {};
      if (colors.excluded.length > 0) excludedAttributes.color = colors.excluded;

      // Every field this rule-based extractor produces is already exactly
      // as confident as regex matching gets — there is no real model
      // uncertainty to report, so a fixed value is honest rather than
      // fabricated precision.
      const confidence = 0.6;

      return {
        category,
        budgetMinMajor: budget.min,
        budgetMaxMajor: budget.max,
        currency: null,
        quantity,
        requiredAttributes,
        preferredAttributes: preferences,
        excludedAttributes,
        availabilityRequirement,
        confidence,
      };
    },

    async rankCandidates(params: RankCandidatesParams): Promise<RawRankedItem[]> {
      const fallbackCandidates: FallbackRankCandidate[] = params.candidates.map((c) => {
        const preferenceMatchCount = Object.entries(params.preferredAttributes).filter(([key, value]) => {
          const actual = c.attributes[key.toLowerCase()];
          return actual !== undefined && actual.toLowerCase() === value.toLowerCase();
        }).length;
        return {
          productId: c.productId,
          priceMinor: c.priceMinor,
          readinessState: (c.readinessState as FallbackRankCandidate["readinessState"]) ?? "PARTIALLY_READY",
          preferenceMatchCount,
          hasStrongMetadata: c.readinessState === "AGENT_READY",
        };
      });
      const orderedIds = fallbackRank(fallbackCandidates).slice(0, params.maxResults);
      return orderedIds.map((productId, index) => {
        const candidate = params.candidates.find((c) => c.productId === productId)!;
        const reasonCodes: string[] = [];
        if (isPurchasable(candidate.availabilityState as AvailabilityState)) reasonCodes.push("IN_STOCK");
        return { productId, rank: index + 1, reasonCodes };
      });
    },

    async proposeGrowthAction(params: ProposeGrowthActionParams): Promise<RawGrowthProposal> {
      // Reuses the exact same deterministic selection algorithm the
      // Merchant Agent's own fallback path uses (`deterministicGrowthProposal`,
      // PART 04 §60-§62) — one algorithm, never two copies that could
      // silently diverge and disagree about what "deterministic" means.
      const eligible: EligibleGrowthCandidate[] = [];
      for (const c of params.candidates) {
        const relationshipType = c.relationship as ProductRelationshipType;
        const actionType = RELATIONSHIP_ACTION_TYPE[relationshipType];
        if (!actionType || !params.allowedActionTypes.includes(actionType)) continue;
        const availabilityState = c.availabilityState as AvailabilityState;
        if (!isPurchasable(availabilityState)) continue;
        if (actionType === "UPSELL") {
          if (c.priceMinor <= 0) continue;
          if (params.buyerBudgetMaxMinor !== null && c.priceMinor > params.buyerBudgetMaxMinor) continue;
        }
        eligible.push({
          productId: c.productId,
          relationshipType,
          actionType,
          priceMinor: c.priceMinor,
          availabilityState,
          attributes: c.attributes,
          readinessState: c.readinessState as EligibleGrowthCandidate["readinessState"],
          hasStructuredAttributes: true,
          hasPolicyData: true,
          isAgentVisible: true,
        });
      }

      const proposal = deterministicGrowthProposal(eligible, params.buyerPreferredAttributes);

      if (!proposal.actionType) {
        return { actionType: "NO_OPPORTUNITY", primaryProductId: params.primaryProduct.productId, relatedProductIds: [], offer: null, reasonCodes: [] };
      }

      // The demo provider never proposes a discount of its own accord —
      // a conservative default (PART 04 §40, §46: never fabricate a
      // reason to discount without real signal).
      return {
        actionType: proposal.actionType,
        primaryProductId: params.primaryProduct.productId,
        relatedProductIds: proposal.relatedProductIds,
        offer: null,
        reasonCodes: proposal.reasonCodes,
      };
    },

    async proposeRecoveryAction(params: ProposeRecoveryActionParams): Promise<RawRecoveryProposal> {
      // PART 08 §135 — since `RETRY_SAME_CHECKOUT` is the only implemented
      // recovery action, the demo provider's "reasoning" is simply: pick
      // it whenever eligibility already permitted it, never invent a
      // different one.
      const action = params.allowedActions.includes("RETRY_SAME_CHECKOUT") ? "RETRY_SAME_CHECKOUT" : "NO_RECOVERY";
      return {
        action,
        reasonCodes: action === "RETRY_SAME_CHECKOUT" ? ["RETRYABLE_PAYMENT_FAILURE", "RECOVERY_ATTEMPT_AVAILABLE"] : [],
        explanation:
          action === "RETRY_SAME_CHECKOUT"
            ? `Attempt ${params.currentAttemptNumber} failed with a retryable category (${params.failureCategory}); retrying the same checkout.`
            : "No safe recovery action is available.",
      };
    },
  };
}
