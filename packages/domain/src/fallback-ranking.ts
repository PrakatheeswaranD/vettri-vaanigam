/**
 * Deterministic fallback ranking (PART 03 §42, §108, §161).
 *
 * Used whenever AI ranking is unavailable, times out, or fails grounding
 * validation — the buyer still gets a safe, explainable ranking instead
 * of an error, and the response is labeled `DETERMINISTIC_FALLBACK` so the
 * distinction from a real model ranking is never hidden (§108).
 */
import type { ProductReadinessState } from "./product-readiness.js";

export interface FallbackRankCandidate {
  productId: string;
  priceMinor: number;
  readinessState: ProductReadinessState;
  preferenceMatchCount: number;
  hasStrongMetadata: boolean;
}

const READINESS_RANK: Record<ProductReadinessState, number> = {
  AGENT_READY: 0,
  PARTIALLY_READY: 1,
  NOT_READY: 2,
};

/**
 * Order candidates by: (1) preference matches — buyer intent still wins
 * over reliability (§43); (2) product readiness, as a reliability
 * tiebreaker, never an override of buyer fit; (3) lower price; (4)
 * stronger metadata; (5) product ID, for a fully stable, reproducible
 * order.
 */
export function fallbackRank(candidates: FallbackRankCandidate[]): string[] {
  return [...candidates]
    .sort((a, b) => {
      if (b.preferenceMatchCount !== a.preferenceMatchCount) return b.preferenceMatchCount - a.preferenceMatchCount;
      const readinessDelta = READINESS_RANK[a.readinessState] - READINESS_RANK[b.readinessState];
      if (readinessDelta !== 0) return readinessDelta;
      if (a.priceMinor !== b.priceMinor) return a.priceMinor - b.priceMinor;
      if (a.hasStrongMetadata !== b.hasStrongMetadata) return a.hasStrongMetadata ? -1 : 1;
      return a.productId.localeCompare(b.productId);
    })
    .map((c) => c.productId);
}
