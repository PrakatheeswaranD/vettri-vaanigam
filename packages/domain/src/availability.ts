/**
 * Deterministic availability model (PART 02 §8, §9).
 *
 * An AI buyer needs more than a boolean `inStock`. `UNKNOWN` is a real,
 * distinct state — missing inventory data must never be silently treated
 * as "in stock" (PART 02 §9). The low-stock threshold is centralized here
 * (not scattered as a magic number) so it can be documented, tested, and
 * changed in one place.
 */

export const AVAILABILITY_STATES = ["IN_STOCK", "LOW_STOCK", "OUT_OF_STOCK", "UNAVAILABLE", "UNKNOWN"] as const;
export type AvailabilityState = (typeof AVAILABILITY_STATES)[number];

/** Below this quantity (but still positive), a variant is LOW_STOCK rather than IN_STOCK. */
export const LOW_STOCK_THRESHOLD = 5;

/**
 * Derive availability deterministically from inventory evidence.
 *
 * @param quantity  Known available quantity, or `null`/`undefined` if
 *   inventory has never been recorded for this variant (→ `UNKNOWN`, not
 *   `IN_STOCK` — PART 02 §9).
 * @param variantActive  Whether the variant itself is active/purchasable.
 *   An inactive variant is `UNAVAILABLE` regardless of quantity.
 */
export function deriveAvailabilityState(
  quantity: number | null | undefined,
  variantActive: boolean,
): AvailabilityState {
  if (!variantActive) return "UNAVAILABLE";
  if (quantity === null || quantity === undefined) return "UNKNOWN";
  if (quantity <= 0) return "OUT_OF_STOCK";
  if (quantity <= LOW_STOCK_THRESHOLD) return "LOW_STOCK";
  return "IN_STOCK";
}

export function isPurchasable(state: AvailabilityState): boolean {
  return state === "IN_STOCK" || state === "LOW_STOCK";
}
