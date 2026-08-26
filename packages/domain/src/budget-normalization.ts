/**
 * Deterministic budget normalization (PART 03 §16, §25).
 *
 * The extractor (LLM or rule-based) proposes a budget as major-unit rupees
 * (e.g. "5k" → 5000) — asking a model to also do the minor-unit multiply
 * would let a model arithmetic slip become an authoritative financial
 * value. This module owns the ONLY multiply-by-100 step and the sanity
 * bound, so a hallucinated or absurd figure can never reach catalog
 * filtering unchecked.
 */

/** ₹10,00,000 — far above this catalog's real price range; anything
 * beyond it is almost certainly a misread, not a genuine buyer budget. */
export const MAX_REASONABLE_BUDGET_MINOR = 10_000_000_00;

/** Convert an extracted major-unit amount into a validated integer minor
 * amount, or `null` if the input isn't usable (negative, non-finite, or
 * absent). Clamps rather than rejects on the high end — an over-large
 * figure just won't match anything, which is a safe, honest outcome. */
export function normalizeBudgetAmount(majorUnits: number | null | undefined): number | null {
  if (majorUnits === null || majorUnits === undefined) return null;
  if (!Number.isFinite(majorUnits) || majorUnits < 0) return null;
  const minor = Math.round(majorUnits * 100);
  return Math.min(minor, MAX_REASONABLE_BUDGET_MINOR);
}
