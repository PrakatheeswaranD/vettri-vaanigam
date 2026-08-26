/**
 * PART 03 §45-§47 — buyer-facing text for each allowlisted reason code.
 * Kept in one place so "why this matches" always reads the same whether
 * it came from an AI-ranked, deterministic-fallback, or near-match result.
 */
import type { RecommendationReasonCodeDTO } from "@razorgrowth/contracts";

export const REASON_CODE_TEXT: Record<RecommendationReasonCodeDTO, string> = {
  WITHIN_BUDGET: "Within your budget",
  MATCHES_REQUIRED_ATTRIBUTE: "Matches your required specification",
  MATCHES_PREFERENCE: "Matches your stated preference",
  IN_STOCK: "Currently in stock",
  STRONG_METADATA: "Complete price, inventory, and policy information",
  NEAR_MATCH_BUDGET: "Slightly above your stated budget",
  NEAR_MATCH_ATTRIBUTE: "Doesn't match one of your required specifications",
};
