/**
 * Recommendation grounding validator (PART 03 §39-§41, §95, §99, §152).
 *
 * This is the deterministic boundary that makes it structurally
 * impossible for a hallucinated product ID, an out-of-set candidate, or
 * an unknown reason code to reach the buyer as an authoritative
 * recommendation. It is intentionally strict, batch-level: if ANY item in
 * a model's ranking is invalid, the WHOLE ranking is rejected (not just
 * the bad item) — a model that fabricated one product in a batch cannot
 * be trusted for the rest of that batch either. Callers fall back to
 * `fallbackRank` (see `fallback-ranking.ts`) when this returns `ok: false`.
 */
import { isKnownReasonCode } from "./recommendation-reason-codes.js";

export interface RawRankedItem {
  productId: string;
  rank: number;
  reasonCodes: string[];
  explanation?: string;
}

export type GroundingResult =
  | { ok: true; items: RawRankedItem[] }
  | { ok: false; reason: string };

export function validateGrounding(
  items: RawRankedItem[],
  candidateProductIds: readonly string[],
  maxCount: number,
): GroundingResult {
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, reason: "Model returned no ranked items." };
  }
  if (items.length > maxCount) {
    return { ok: false, reason: `Model returned ${items.length} items, exceeding the bound of ${maxCount}.` };
  }

  const candidateIdSet = new Set(candidateProductIds);
  const seen = new Set<string>();
  const ranks = new Set<number>();

  for (const item of items) {
    if (typeof item.productId !== "string" || !candidateIdSet.has(item.productId)) {
      return { ok: false, reason: `Recommended productId "${String(item.productId)}" is not in the supplied candidate set.` };
    }
    if (seen.has(item.productId)) {
      return { ok: false, reason: `Duplicate productId "${item.productId}" in ranking.` };
    }
    if (!Number.isInteger(item.rank) || item.rank < 1) {
      return { ok: false, reason: `Invalid rank "${String(item.rank)}" for productId "${item.productId}".` };
    }
    if (ranks.has(item.rank)) {
      return { ok: false, reason: `Duplicate rank "${item.rank}".` };
    }
    if (!Array.isArray(item.reasonCodes) || !item.reasonCodes.every((c) => isKnownReasonCode(c))) {
      return { ok: false, reason: `Unknown reason code for productId "${item.productId}".` };
    }
    seen.add(item.productId);
    ranks.add(item.rank);
  }

  return { ok: true, items: [...items].sort((a, b) => a.rank - b.rank) };
}
