/**
 * Recommendation reason codes (PART 03 §45-§47).
 *
 * A model may only ever PROPOSE from this fixed allowlist — application
 * code renders the buyer-facing claim from the codes (§47), so an
 * explanation can never say something the underlying facts don't support.
 */
import type { AvailabilityState } from "./availability.js";
import { isPurchasable } from "./availability.js";
import type { ConstraintViolation } from "./buyer-eligibility.js";
import type { BuyerIntent } from "./buyer-intent.js";

export const REASON_CODES = [
  "WITHIN_BUDGET",
  "MATCHES_REQUIRED_ATTRIBUTE",
  "MATCHES_PREFERENCE",
  "IN_STOCK",
  "STRONG_METADATA",
  "NEAR_MATCH_BUDGET",
  "NEAR_MATCH_ATTRIBUTE",
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

export function isKnownReasonCode(value: string): value is ReasonCode {
  return (REASON_CODES as readonly string[]).includes(value);
}

export interface ReasonCodeInput {
  priceMinor: number;
  availabilityState: AvailabilityState;
  attributes: Record<string, string>;
  hasStrongMetadata: boolean;
  violations: ConstraintViolation[];
}

/** Derive the buyer-facing reason codes for one candidate DETERMINISTICALLY
 * from its own facts and the intent it's being evaluated against — never
 * from model prose (§47). */
export function deriveReasonCodes(candidate: ReasonCodeInput, intent: BuyerIntent): ReasonCode[] {
  const codes: ReasonCode[] = [];
  const budgetViolation = candidate.violations.find((v) => v.type === "BUDGET_MAX");

  if (budgetViolation) {
    codes.push("NEAR_MATCH_BUDGET");
  } else if (intent.budget.maxMinor !== null || intent.budget.minMinor !== null) {
    codes.push("WITHIN_BUDGET");
  }

  const hasAttributeViolation = candidate.violations.some((v) => v.type === "REQUIRED_ATTRIBUTE");
  if (hasAttributeViolation) {
    codes.push("NEAR_MATCH_ATTRIBUTE");
  } else if (Object.keys(intent.requiredAttributes).length > 0) {
    codes.push("MATCHES_REQUIRED_ATTRIBUTE");
  }

  const matchesAnyPreference = Object.entries(intent.preferredAttributes).some(([key, value]) => {
    const actual = candidate.attributes[key.toLowerCase()];
    return actual !== undefined && actual.trim().toLowerCase() === value.trim().toLowerCase();
  });
  if (matchesAnyPreference) codes.push("MATCHES_PREFERENCE");

  if (isPurchasable(candidate.availabilityState)) codes.push("IN_STOCK");
  if (candidate.hasStrongMetadata) codes.push("STRONG_METADATA");

  return codes;
}

const REASON_CODE_TEXT: Record<ReasonCode, string> = {
  WITHIN_BUDGET: "within your budget",
  MATCHES_REQUIRED_ATTRIBUTE: "matches your required specification",
  MATCHES_PREFERENCE: "matches your stated preference",
  IN_STOCK: "currently in stock",
  STRONG_METADATA: "has complete price, inventory, and policy information",
  NEAR_MATCH_BUDGET: "slightly above your stated budget",
  NEAR_MATCH_ATTRIBUTE: "doesn't match one of your required specifications",
};

/** Render a factual, template-based explanation from reason codes — never
 * free AI prose for the commerce facts themselves (§47). */
export function renderExplanation(reasonCodes: ReasonCode[]): string {
  const clauses = reasonCodes.map((c) => REASON_CODE_TEXT[c]);
  if (clauses.length === 0) return "Matches your search.";
  const [first, ...rest] = clauses;
  const capitalized = first!.charAt(0).toUpperCase() + first!.slice(1);
  return rest.length === 0 ? `${capitalized}.` : `${capitalized}, ${rest.join(", ")}.`;
}
