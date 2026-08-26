/**
 * Per-product Agentic Readiness classification (PART 02 §11, §12).
 *
 * A pure function over evidence already collected about one product —
 * this module never touches the database itself (that's
 * `CatalogQualityAnalyzer` in `apps/api`). Field importance is split into
 * CRITICAL (blocks safe transaction if missing) vs IMPORTANT (transactable
 * but degraded) per PART 02 §12, and that split — not an arbitrary
 * threshold — is what drives the three-state classification.
 */

export const PRODUCT_READINESS_STATES = ["AGENT_READY", "PARTIALLY_READY", "NOT_READY"] as const;
export type ProductReadinessState = (typeof PRODUCT_READINESS_STATES)[number];

export interface ProductReadinessEvidence {
  /** CRITICAL (PART 02 §12): without these, safe transaction isn't possible. */
  hasActivePurchasableVariant: boolean;
  hasValidPriceAndCurrency: boolean;
  hasKnownAvailability: boolean;
  /** IMPORTANT (PART 02 §12): transactable, but degraded for an AI buyer. */
  hasReturnPolicy: boolean;
  hasShippingPolicy: boolean;
  hasCategory: boolean;
  hasStructuredAttributes: boolean;
}

export interface ProductReadinessResult {
  state: ProductReadinessState;
  missingCritical: string[];
  missingImportant: string[];
}

const CRITICAL_CHECKS: { key: keyof ProductReadinessEvidence; label: string }[] = [
  { key: "hasActivePurchasableVariant", label: "No active purchasable variant" },
  { key: "hasValidPriceAndCurrency", label: "Missing a valid price/currency" },
  { key: "hasKnownAvailability", label: "Availability is unknown" },
];

const IMPORTANT_CHECKS: { key: keyof ProductReadinessEvidence; label: string }[] = [
  { key: "hasReturnPolicy", label: "Missing return-policy information" },
  { key: "hasShippingPolicy", label: "Missing shipping information" },
  { key: "hasCategory", label: "Missing category" },
  { key: "hasStructuredAttributes", label: "Missing structured attributes" },
];

/**
 * NOT_READY  — any CRITICAL requirement is missing (PART 02 §11).
 * PARTIALLY_READY — all CRITICAL requirements met, but at least one
 *   IMPORTANT one is missing.
 * AGENT_READY — every CRITICAL and IMPORTANT requirement is met.
 */
export function deriveProductReadiness(evidence: ProductReadinessEvidence): ProductReadinessResult {
  const missingCritical = CRITICAL_CHECKS.filter((c) => !evidence[c.key]).map((c) => c.label);
  const missingImportant = IMPORTANT_CHECKS.filter((c) => !evidence[c.key]).map((c) => c.label);

  if (missingCritical.length > 0) {
    return { state: "NOT_READY", missingCritical, missingImportant };
  }
  if (missingImportant.length > 0) {
    return { state: "PARTIALLY_READY", missingCritical, missingImportant };
  }
  return { state: "AGENT_READY", missingCritical, missingImportant };
}
