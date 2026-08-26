/**
 * Deterministic Growth Proposal Validator (PART 04 §35-§36, §57-§58,
 * §99-§103).
 *
 * The single gate every Merchant Agent proposal — AI-generated or
 * deterministic — must pass before it can be persisted or returned. Not
 * batch-lenient: on any failure the WHOLE proposal is rejected
 * (`REJECTED_VALIDATION`), never silently repaired or clamped (§58 —
 * "do not silently clamp model output and pretend the model proposed
 * 10%").
 */
import { isKnownGrowthActionType, isKnownGrowthReasonCode, type GrowthActionType } from "./growth-action.js";

export interface RawGrowthProposalShape {
  actionType: string;
  primaryProductId: string | null;
  relatedProductIds: string[];
  offer: {
    kind: string | null;
    percentageBps: number | null;
    amountMinor: number | null;
  } | null;
  reasonCodes: string[];
}

export interface GrowthValidationContext {
  /** Every product ID the model was actually shown — primary product
   * included (PART 04 §57: "the model may only reference products
   * supplied in opportunity candidates"). */
  candidateProductIds: readonly string[];
  allowedActionTypes: readonly GrowthActionType[];
  maxProposedDiscountBps: number;
  maxUpsellIncreaseBps: number;
  maxCrossSellItems: number;
  maxBundleItems: number;
  /** The buyer's hard budget ceiling, if any (PART 04 §29). */
  buyerBudgetMaxMinor: number | null;
  /** Authoritative catalog prices for every candidate, keyed by product
   * ID — used to enforce the upsell uplift ceiling and the buyer budget
   * without ever trusting a price the model might have echoed. */
  candidatePricesMinor: Readonly<Record<string, number>>;
  primaryProductPriceMinor: number;
  currency: string;
}

export type GrowthValidationResult =
  | { ok: true; actionType: GrowthActionType }
  | { ok: false; reason: string };

const MAX_LIMIT_BY_TYPE: Record<GrowthActionType, (ctx: GrowthValidationContext) => number> = {
  CROSS_SELL: (ctx) => ctx.maxCrossSellItems,
  UPSELL: () => 1,
  BUNDLE: (ctx) => ctx.maxBundleItems,
  BOUNDED_OFFER: (ctx) => ctx.maxCrossSellItems,
  RECOVERY: () => 1,
};

export function validateGrowthProposal(raw: RawGrowthProposalShape, ctx: GrowthValidationContext): GrowthValidationResult {
  if (!isKnownGrowthActionType(raw.actionType)) {
    return { ok: false, reason: `Unknown action type "${raw.actionType}".` };
  }
  const actionType = raw.actionType;

  if (!ctx.allowedActionTypes.includes(actionType)) {
    return { ok: false, reason: `Action type "${actionType}" is not enabled by merchant growth configuration.` };
  }

  if (raw.primaryProductId !== null && !ctx.candidateProductIds.includes(raw.primaryProductId)) {
    return { ok: false, reason: `primaryProductId "${raw.primaryProductId}" is not in the supplied candidate set.` };
  }

  if (!Array.isArray(raw.relatedProductIds) || raw.relatedProductIds.length === 0) {
    return { ok: false, reason: "relatedProductIds must contain at least one product." };
  }

  const seen = new Set<string>();
  for (const id of raw.relatedProductIds) {
    if (!ctx.candidateProductIds.includes(id)) {
      return { ok: false, reason: `relatedProductId "${id}" is not in the supplied candidate set.` };
    }
    if (seen.has(id)) {
      return { ok: false, reason: `Duplicate relatedProductId "${id}".` };
    }
    seen.add(id);
  }

  const maxItems = MAX_LIMIT_BY_TYPE[actionType](ctx);
  if (raw.relatedProductIds.length > maxItems) {
    return { ok: false, reason: `${actionType} proposed ${raw.relatedProductIds.length} product(s), exceeding the bound of ${maxItems}.` };
  }

  if (!raw.reasonCodes.every((c) => isKnownGrowthReasonCode(c))) {
    return { ok: false, reason: "Proposal contains an unknown reason code." };
  }

  // Upsell-specific bounds: uplift ceiling and buyer hard budget (§12, §29).
  if (actionType === "UPSELL") {
    const targetId = raw.relatedProductIds[0]!;
    const targetPrice = ctx.candidatePricesMinor[targetId];
    if (targetPrice === undefined) {
      return { ok: false, reason: `No authoritative price known for upsell target "${targetId}".` };
    }
    if (targetPrice <= ctx.primaryProductPriceMinor) {
      return { ok: false, reason: "Upsell target must be priced higher than the primary product." };
    }
    const upliftBps = Math.floor(((targetPrice - ctx.primaryProductPriceMinor) * 10_000) / ctx.primaryProductPriceMinor);
    if (upliftBps > ctx.maxUpsellIncreaseBps) {
      return { ok: false, reason: `Upsell uplift ${upliftBps}bps exceeds the configured ceiling of ${ctx.maxUpsellIncreaseBps}bps.` };
    }
    if (ctx.buyerBudgetMaxMinor !== null && targetPrice > ctx.buyerBudgetMaxMinor) {
      return { ok: false, reason: "Upsell target exceeds the buyer's hard budget constraint." };
    }
  }

  // Offer bounds (§18-§20, §58): discount must be well-formed and within
  // the merchant's configured proposal ceiling — never clamped, rejected.
  if (raw.offer !== null) {
    if (raw.offer.kind !== "PERCENTAGE" && raw.offer.kind !== "FIXED_AMOUNT") {
      return { ok: false, reason: `Unknown offer kind "${String(raw.offer.kind)}".` };
    }
    if (raw.offer.kind === "PERCENTAGE") {
      const bps = raw.offer.percentageBps;
      if (bps === null || !Number.isInteger(bps) || bps < 0) {
        return { ok: false, reason: "Invalid percentageBps for a PERCENTAGE offer." };
      }
      if (bps > ctx.maxProposedDiscountBps) {
        return { ok: false, reason: `Proposed discount ${bps}bps exceeds the configured ceiling of ${ctx.maxProposedDiscountBps}bps.` };
      }
    } else {
      const amount = raw.offer.amountMinor;
      if (amount === null || !Number.isInteger(amount) || amount < 0) {
        return { ok: false, reason: "Invalid amountMinor for a FIXED_AMOUNT offer." };
      }
      // Convert to an equivalent bps-of-primary-price figure so a fixed
      // amount cannot be used to sidestep the same percentage ceiling.
      const impliedBps = Math.floor((amount * 10_000) / ctx.primaryProductPriceMinor);
      if (impliedBps > ctx.maxProposedDiscountBps) {
        return { ok: false, reason: `Proposed fixed discount implies ${impliedBps}bps, exceeding the configured ceiling of ${ctx.maxProposedDiscountBps}bps.` };
      }
    }
  }

  return { ok: true, actionType };
}
