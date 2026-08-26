/**
 * Deterministic authorized-selection resolution (PART 06 §55-§60, §189).
 *
 * Given the buyer's own (non-financial) selection and the growth action
 * type an `ExecutionAuthorization` actually covers, this is the ONE place
 * that decides which product lines a commerce execution produces and
 * which single line is eligible for the authorized discount, if any. A
 * closed mapping — an unrecognized action type is rejected, never routed
 * through a generic/default handler (PART 06 §60-§61: no
 * `executeGenericAction()`).
 *
 * Pure and DB-free so the mapping itself is unit-testable without a
 * database — the caller (`apps/api` `commerce/execution-service.ts`) is
 * responsible for rehydrating each resulting line against authoritative
 * catalog/price/inventory state.
 */
import type { GrowthActionType } from "./growth-action.js";
import type { OrderSource } from "./commerce-status.js";

export const RESOLVED_LINE_ROLES = ["PRIMARY", "PRIMARY_REPLACED_BY_UPSELL", "ADDED", "REPLACEMENT"] as const;
export type ResolvedLineRole = (typeof RESOLVED_LINE_ROLES)[number];

export interface ResolvedCommerceLine {
  productId: string;
  role: ResolvedLineRole;
  quantity: number;
  /** Whether the authorized offer (if any) is eligible to discount THIS
   * line — there is at most one such line per execution (PART 06 §30,
   * §163: one authorized offer per checkout, never stacked). */
  offerEligible: boolean;
}

export interface BuyerSelectionInput {
  productId: string;
  quantity: number;
}

export type ResolveSelectionResult =
  | { ok: true; lines: ResolvedCommerceLine[] }
  | { ok: false; reason: string };

/**
 * `relatedProductIds` is the proposal's own field (PART 04); for
 * `RECOVERY` it conventionally equals `[primaryProductId]` itself (PART 04
 * §15's `tryBuildRecoveryProposal`) — never a distinct product to add.
 */
export function resolveAuthorizedSelection(
  actionType: GrowthActionType,
  primaryProductId: string,
  relatedProductIds: readonly string[],
  buyerSelection: BuyerSelectionInput,
): ResolveSelectionResult {
  if (buyerSelection.productId !== primaryProductId) {
    return { ok: false, reason: `Selected product does not match the authorized primary product.` };
  }

  switch (actionType) {
    case "CROSS_SELL":
    case "BUNDLE": {
      const added = relatedProductIds.filter((id) => id !== primaryProductId);
      if (added.length === 0) {
        return { ok: false, reason: `${actionType} authorization has no related product to add.` };
      }
      return {
        ok: true,
        lines: [
          { productId: primaryProductId, role: "PRIMARY", quantity: buyerSelection.quantity, offerEligible: true },
          ...added.map((productId): ResolvedCommerceLine => ({ productId, role: "ADDED", quantity: 1, offerEligible: false })),
        ],
      };
    }
    case "UPSELL": {
      const target = relatedProductIds[0];
      if (!target || target === primaryProductId) {
        return { ok: false, reason: "UPSELL authorization has no distinct replacement product." };
      }
      return {
        ok: true,
        lines: [{ productId: target, role: "REPLACEMENT", quantity: buyerSelection.quantity, offerEligible: true }],
      };
    }
    case "BOUNDED_OFFER":
    case "RECOVERY": {
      // Both apply their discount to the primary product itself.
      // RECOVERY's relatedProductIds is conventionally [primaryProductId]
      // (not a distinct add-on) — filtered out here so it can never
      // duplicate the primary line even if a future producer changes that.
      const added = relatedProductIds.filter((id) => id !== primaryProductId);
      return {
        ok: true,
        lines: [
          { productId: primaryProductId, role: "PRIMARY", quantity: buyerSelection.quantity, offerEligible: true },
          ...added.map((productId): ResolvedCommerceLine => ({ productId, role: "ADDED", quantity: 1, offerEligible: false })),
        ],
      };
    }
    default:
      return { ok: false, reason: `Unknown or unsupported action type for commerce execution: "${actionType as string}".` };
  }
}

const ACTION_TYPE_ORDER_SOURCE: Record<GrowthActionType, OrderSource> = {
  CROSS_SELL: "AI_CROSS_SELL",
  UPSELL: "AI_UPSELL",
  BUNDLE: "AI_BUNDLE",
  BOUNDED_OFFER: "AI_BOUNDED_OFFER",
  RECOVERY: "AI_RECOVERY",
};

/** PART 06 §63-§65 order-level provenance — the whole order exists
 * because of this authorized action, so it always carries the AI
 * attribution even though individual lines may not (see
 * `lineSourceForRole`). */
export function orderSourceForActionType(actionType: GrowthActionType): OrderSource {
  return ACTION_TYPE_ORDER_SOURCE[actionType];
}

/** PART 06 §15, §63 — per-line provenance: the buyer's own primary
 * selection is `DIRECT_BUYER` even inside an AI-attributed order (they
 * chose that product themselves), while an added/replaced line carries
 * the specific AI attribution. `RECOVERY`/`BOUNDED_OFFER` apply their
 * discount to the primary line itself, so that line is attributed to the
 * action instead. */
export function lineSourceForRole(role: ResolvedLineRole, actionType: GrowthActionType): OrderSource {
  if (role === "ADDED" || role === "REPLACEMENT") return ACTION_TYPE_ORDER_SOURCE[actionType];
  if (role === "PRIMARY" && (actionType === "RECOVERY" || actionType === "BOUNDED_OFFER")) {
    return ACTION_TYPE_ORDER_SOURCE[actionType];
  }
  return "DIRECT_BUYER";
}
