import type { GrowthReasonCodeDTO } from "@razorgrowth/contracts";

/** PART 04 §37, §85 — buyer-facing text for each allowlisted growth
 * reason code, deterministically rendered — never free AI prose standing
 * in for a commerce fact. */
export const GROWTH_REASON_CODE_TEXT: Record<GrowthReasonCodeDTO, string> = {
  COMPLEMENTARY_PRODUCT: "Configured as complementary to the selected product",
  BUYER_PREFERENCE_MATCH: "Matches the buyer's stated preference",
  UPGRADE_WITHIN_BUDGET: "Priced within the buyer's stated budget",
  UPGRADE_WITHIN_ALLOWED_UPLIFT: "Within the merchant's allowed upgrade range",
  BUNDLE_RELEVANCE: "A relevant bundle pairing",
  PRICE_HESITATION: "Offered to help close a budget gap",
  NO_EXACT_MATCH_RECOVERY: "The closest alternative since no exact match was found",
  MERCHANT_CONFIGURED_RELATIONSHIP: "A merchant-configured product relationship",
  READINESS_SUPPORTED: "Backed by complete price, inventory, and policy information",
  RETRYABLE_PAYMENT_FAILURE: "The prior payment attempt failed for a retryable reason",
  RECOVERY_ATTEMPT_AVAILABLE: "A recovery attempt remains available under merchant policy",
};

export const BLOCKER_CODE_TEXT: Record<string, string> = {
  UNKNOWN_INVENTORY: "Inventory has never been recorded for this product",
  MISSING_PRICE: "No authoritative price is available",
  MISSING_VARIANT_ATTRIBUTE: "Structured variant attributes are missing",
  MISSING_POLICY_DATA: "Return/shipping policy information is missing",
  PRODUCT_NOT_AGENT_VISIBLE: "The product is not currently published/visible",
};
