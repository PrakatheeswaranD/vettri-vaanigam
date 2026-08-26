/**
 * Buyer Agent intent primitives (PART 03 §11-§21).
 *
 * `BuyerIntent` is the NORMALIZED, post-merge shape the rest of the
 * pipeline (eligibility, near-match, recommendation) operates on. It is
 * intentionally NOT the raw shape an LLM/extractor produces per message —
 * see `PartialIntentSignal` for that. Keeping the two separate is what
 * lets `mergeIntentSignal` distinguish "the buyer didn't mention this in
 * their latest message" (→ keep prior value) from "the buyer explicitly
 * said none" (not representable for these fields, by design — PART 03
 * §51-§53 only requires override-on-mention semantics, not explicit
 * clearing).
 */
import type { CurrencyCode } from "./money.js";

export const AVAILABILITY_REQUIREMENTS = ["PURCHASABLE_ONLY", "INCLUDE_UNAVAILABLE"] as const;
export type AvailabilityRequirement = (typeof AVAILABILITY_REQUIREMENTS)[number];

export interface BuyerBudget {
  minMinor: number | null;
  maxMinor: number | null;
  currency: CurrencyCode;
}

/** Per-message extraction output, BEFORE merge with prior conversation
 * intent. Every field is nullable/empty to mean "not mentioned in this
 * message" — `mergeIntentSignal` is the only place that decides what
 * happens next. */
export interface PartialIntentSignal {
  category: string | null;
  budgetMinMinor: number | null;
  budgetMaxMinor: number | null;
  currency: CurrencyCode | null;
  quantity: number | null;
  requiredAttributes: Record<string, string>;
  preferredAttributes: Record<string, string>;
  excludedAttributes: Record<string, string[]>;
  availabilityRequirement: AvailabilityRequirement | null;
}

/** Final, normalized intent — every field has a concrete deterministic
 * value (defaults applied), ready to drive catalog constraints. */
export interface BuyerIntent {
  category: string | null;
  budget: BuyerBudget;
  quantity: number;
  requiredAttributes: Record<string, string>;
  preferredAttributes: Record<string, string>;
  excludedAttributes: Record<string, string[]>;
  availabilityRequirement: AvailabilityRequirement;
}

export const DEFAULT_QUANTITY = 1;
export const MAX_QUANTITY = 10;
export const DEFAULT_AVAILABILITY_REQUIREMENT: AvailabilityRequirement = "PURCHASABLE_ONLY";

function mergeAttributeRecord(
  prior: Record<string, string>,
  incoming: Record<string, string>,
): Record<string, string> {
  return { ...prior, ...incoming };
}

function mergeExclusionRecord(
  prior: Record<string, string[]>,
  incoming: Record<string, string[]>,
): Record<string, string[]> {
  const merged: Record<string, string[]> = { ...prior };
  for (const [key, values] of Object.entries(incoming)) {
    merged[key] = values;
  }
  return merged;
}

/**
 * Deterministic conversation intent merge (PART 03 §51-§53).
 *
 * A field mentioned in the new message (non-null / non-empty) always
 * overrides the prior value — this is what lets "Actually my budget is
 * ₹6,000" replace a previous budget instead of being silently ignored
 * (§52). A field NOT mentioned falls back to whatever the conversation
 * already knew (§51) — this is what lets "9" alone, following "running
 * shoes under ₹5,000", produce a combined intent instead of erasing the
 * category/budget.
 */
export function mergeIntentSignal(prior: BuyerIntent | null, incoming: PartialIntentSignal): BuyerIntent {
  const currency = incoming.currency ?? prior?.budget.currency ?? "INR";
  return {
    category: incoming.category ?? prior?.category ?? null,
    budget: {
      minMinor: incoming.budgetMinMinor ?? prior?.budget.minMinor ?? null,
      maxMinor: incoming.budgetMaxMinor ?? prior?.budget.maxMinor ?? null,
      currency,
    },
    quantity: Math.min(incoming.quantity ?? prior?.quantity ?? DEFAULT_QUANTITY, MAX_QUANTITY),
    requiredAttributes: mergeAttributeRecord(prior?.requiredAttributes ?? {}, incoming.requiredAttributes),
    preferredAttributes: mergeAttributeRecord(prior?.preferredAttributes ?? {}, incoming.preferredAttributes),
    excludedAttributes: mergeExclusionRecord(prior?.excludedAttributes ?? {}, incoming.excludedAttributes),
    availabilityRequirement:
      incoming.availabilityRequirement ?? prior?.availabilityRequirement ?? DEFAULT_AVAILABILITY_REQUIREMENT,
  };
}

/** A brand-new conversation / explicit reset (PART 03 §53) — never a
 * partial merge, so old constraints can never leak into an unrelated
 * search. */
export function emptyIntent(currency: CurrencyCode = "INR"): BuyerIntent {
  return {
    category: null,
    budget: { minMinor: null, maxMinor: null, currency },
    quantity: DEFAULT_QUANTITY,
    requiredAttributes: {},
    preferredAttributes: {},
    excludedAttributes: {},
    availabilityRequirement: DEFAULT_AVAILABILITY_REQUIREMENT,
  };
}

/** PART 03 §21 — clarification is only useful when it would materially
 * change results: currently, a completely unknown shopping category with
 * no other constraint to search on. */
export function needsClarification(intent: BuyerIntent): boolean {
  const hasCategory = intent.category !== null && intent.category.trim().length > 0;
  const hasAnyRequiredAttribute = Object.keys(intent.requiredAttributes).length > 0;
  return !hasCategory && !hasAnyRequiredAttribute;
}
