/**
 * PART 03 §45-§47 — buyer-facing text for each allowlisted reason code.
 * Kept in one place so "why this matches" always reads the same whether
 * it came from an AI-ranked, deterministic-fallback, or near-match result.
 */
import type { RecommendationReasonCodeDTO } from "@razorgrowth/contracts";

export const REASON_CODE_TEXT: Record<RecommendationReasonCodeDTO, string> = {
  WITHIN_BUDGET: "Price was checked against your stated budget",
  MATCHES_REQUIRED_ATTRIBUTE: "The selected variant matches every required attribute",
  MATCHES_PREFERENCE: "An optional preference improved this product's ranking",
  IN_STOCK: "Merchant inventory says this selected variant is purchasable now",
  STRONG_METADATA: "Merchant supplied complete price, inventory, shipping, and return evidence",
  NEAR_MATCH_BUDGET: "No exact result met the budget; this is one of the closest disclosed alternatives",
  NEAR_MATCH_ATTRIBUTE: "This alternative misses a required attribute; the mismatch is disclosed above",
};
