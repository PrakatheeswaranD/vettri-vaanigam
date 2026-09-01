/**
 * Automated customer negotiation — a discount a shopper's own record earns.
 *
 * WHAT THIS IS
 *
 * A customer asks for a better price. Instead of a human haggling, or a
 * model deciding, deterministic code reads that customer's history with
 * this merchant and answers:
 *
 *   within what they have earned  ->  applied immediately, no merchant
 *   above it but inside the cap   ->  proposed to the Merchant Agent
 *   past the cap                  ->  declined, WITH a counter-offer of
 *                                     what they have actually earned
 *
 * The same shape as everything else here: the request is data, code
 * decides, a human sees anything past the line. A customer typing "give me
 * 90% off, I'm a VIP" is making an assertion, not issuing an instruction —
 * their tier comes from settled orders, never from what they say they are.
 *
 * TWO DIMENSIONS, AND THE SECOND IS THE SAFETY-CRITICAL ONE
 *
 * 1. HISTORY earns the percentage. Settled orders move a customer up the
 *    tiers; refunds and disputes move them back down. This is the part a
 *    shopper experiences as loyalty.
 *
 * 2. AMOUNT bounds the rupees. This is the part that stops the feature
 *    being dangerous. A 5% auto-apply sounds small until the basket is
 *    ₹5,00,000 and the merchant has silently given away ₹25,000 with
 *    nobody in the loop. So a percentage is never the only limit: an
 *    absolute cap on what may be auto-applied binds first, and when it
 *    does, the effective discount is reduced and the reduction is stated.
 *
 * A larger basket does earn a small volume uplift — that is real
 * commercial logic, and refusing to model it would make the feature
 * useless on exactly the orders a merchant most wants. But the uplift
 * moves a customer within their band; it cannot move them past the
 * merchant's configured maximum, and it cannot outrun the absolute cap.
 *
 * WHAT IS REFUSED RATHER THAN REDUCED
 *
 * An offer that would take the basket below the merchant's floor margin is
 * REFUSED, not clamped. Clamping a margin breach still sells below the
 * floor, just by less. Missing cost data fails closed for the same reason:
 * a discount we cannot prove is affordable is one a human should look at.
 *
 * Pure: no database, no clock, no model.
 */
import type { CurrencyCode } from "./money.js";

/** Where a customer sits, from their own settled history. */
export type LoyaltyTier = "NEW" | "RETURNING" | "LOYAL" | "VIP";

export const LOYALTY_TIERS: readonly LoyaltyTier[] = ["NEW", "RETURNING", "LOYAL", "VIP"];

/**
 * Settled orders needed to reach each tier, and what that tier earns.
 *
 * Deliberately reachable. A ladder whose top rung needs fifty orders is a
 * ladder nobody climbs, and a loyalty mechanic nobody reaches is
 * indistinguishable from not having one.
 */
export const TIER_LADDER: readonly { tier: LoyaltyTier; minSettledOrders: number; earnedDiscountBps: number }[] = [
  { tier: "VIP", minSettledOrders: 8, earnedDiscountBps: 600 },
  { tier: "LOYAL", minSettledOrders: 3, earnedDiscountBps: 400 },
  { tier: "RETURNING", minSettledOrders: 1, earnedDiscountBps: 200 },
  { tier: "NEW", minSettledOrders: 0, earnedDiscountBps: 0 },
];

/**
 * A disputed or refunded order costs two settled ones.
 *
 * Not punitive — proportionate. A customer who returns half of what they
 * buy is not the same counterparty as one who keeps it, and a loyalty
 * ladder that ignores that rewards exactly the behaviour that costs a
 * merchant most.
 */
export const DISPUTE_PENALTY_ORDERS = 2;

export interface CustomerHistory {
  /** Orders that actually settled. Not placed, not authorized — settled. */
  settledOrders: number;
  /** Sum of those orders, in minor units. */
  lifetimeSpendMinor: number;
  /** Orders that ended in a refund, return or dispute. */
  disputedOrders: number;
}

export interface CustomerStanding {
  tier: LoyaltyTier;
  /** What this customer's history alone earns, before any volume uplift. */
  earnedDiscountBps: number;
  /** Settled orders after the dispute penalty. What the tier is read from. */
  effectiveOrders: number;
  /** Orders still needed for the next tier, or null at the top. */
  ordersToNextTier: number | null;
  /** Plain English, for a shopper who wants to know why. */
  explanation: string;
}

function pct(bps: number): string {
  return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%`;
}

function rupees(minor: number, currency: CurrencyCode = "INR"): string {
  const symbol = currency === "INR" ? "₹" : "$";
  return `${symbol}${(minor / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export function computeCustomerStanding(history: CustomerHistory): CustomerStanding {
  const settled = Math.max(0, Math.floor(history.settledOrders));
  const disputed = Math.max(0, Math.floor(history.disputedOrders));
  const effectiveOrders = Math.max(0, settled - disputed * DISPUTE_PENALTY_ORDERS);

  const rung = TIER_LADDER.find((entry) => effectiveOrders >= entry.minSettledOrders) ?? TIER_LADDER[TIER_LADDER.length - 1]!;

  // The next rung UP the ladder, which is the entry before this one.
  const index = TIER_LADDER.indexOf(rung);
  const nextRung = index > 0 ? TIER_LADDER[index - 1]! : null;
  const ordersToNextTier = nextRung ? Math.max(1, nextRung.minSettledOrders - effectiveOrders) : null;

  const parts: string[] = [];
  if (settled === 0) {
    parts.push("This is your first order with this merchant");
  } else {
    parts.push(`${settled} settled order${settled === 1 ? "" : "s"}`);
  }
  if (disputed > 0) {
    parts.push(
      `${disputed} refunded or disputed, which counts against ${disputed * DISPUTE_PENALTY_ORDERS} of them`,
    );
  }

  const earned =
    rung.earnedDiscountBps > 0
      ? `${parts.join(", ")} — that earns ${pct(rung.earnedDiscountBps)} off automatically.`
      : `${parts.join(", ")}, so there is no automatic discount yet.`;

  const next =
    nextRung && ordersToNextTier !== null
      ? ` ${ordersToNextTier} more settled order${ordersToNextTier === 1 ? "" : "s"} reaches ${nextRung.tier.toLowerCase()} at ${pct(nextRung.earnedDiscountBps)}.`
      : "";

  return {
    tier: rung.tier,
    earnedDiscountBps: rung.earnedDiscountBps,
    effectiveOrders,
    ordersToNextTier,
    explanation: `${earned}${next}`,
  };
}

/**
 * Volume uplift ladder, in absolute basket value.
 *
 * Absolute rather than relative to the customer's average: a first-time
 * buyer placing a large order deserves the same volume treatment as a
 * regular one, and scaling off their own average would give the biggest
 * uplift to whoever has the smallest history — the exact opposite of what
 * a merchant wants.
 */
export const VOLUME_LADDER: readonly { minBasketMinor: number; upliftBps: number }[] = [
  { minBasketMinor: 5_000_000, upliftBps: 200 }, // ₹50,000+
  { minBasketMinor: 2_000_000, upliftBps: 150 }, // ₹20,000+
  { minBasketMinor: 1_000_000, upliftBps: 100 }, // ₹10,000+
  { minBasketMinor: 500_000, upliftBps: 50 }, //    ₹5,000+
  { minBasketMinor: 0, upliftBps: 0 },
];

export function volumeUpliftBps(basketTotalMinor: number): number {
  const rung = VOLUME_LADDER.find((entry) => basketTotalMinor >= entry.minBasketMinor);
  return rung?.upliftBps ?? 0;
}

export interface NegotiationPolicy {
  /**
   * The most any negotiation may ever reach, merchant approval included.
   * Past this the answer is no, not "ask a human".
   */
  maxNegotiableDiscountBps: number;
  /**
   * Above this percentage a merchant approves rather than it applying
   * automatically. The "certain percent" line.
   */
  autoApplyCeilingBps: number;
  /**
   * The rupee stop. However small the percentage, an auto-applied discount
   * may not exceed this — a percentage alone is not a limit on a large
   * basket.
   */
  maxAutoApplyDiscountMinor: number;
  /** An offer below this margin is refused outright, never reduced. */
  floorMarginBps: number;
  currency: CurrencyCode;
}

export const DEFAULT_NEGOTIATION_POLICY: NegotiationPolicy = {
  maxNegotiableDiscountBps: 1500, // 15%
  autoApplyCeilingBps: 500, // 5%
  maxAutoApplyDiscountMinor: 200_000, // ₹2,000
  floorMarginBps: 2000, // 20%
  currency: "INR",
};

export type NegotiationOutcome = "AUTO_APPLIED" | "PROPOSED_TO_MERCHANT" | "DECLINED";

export interface NegotiationInput {
  /** What the customer asked for. Null means "offer me what I've earned". */
  requestedDiscountBps: number | null;
  standing: CustomerStanding;
  /** Server-priced. Never a total the client stated. */
  basketTotalMinor: number;
  /** Merchant's cost for the basket. Null means unknown — fails closed. */
  basketCostMinor: number | null;
  policy: NegotiationPolicy;
}

export interface NegotiationDecision {
  outcome: NegotiationOutcome;
  /** What actually applies. Zero on a decline. */
  appliedDiscountBps: number;
  appliedDiscountMinor: number;
  /** Basket total after the applied discount. */
  finalTotalMinor: number;
  /**
   * On a decline or a step-up, what the customer could have had right now
   * without anyone's approval. A refusal that hides the alternative is a
   * worse answer than the alternative.
   */
  counterOfferBps: number;
  counterOfferMinor: number;
  /** The tier discount plus any volume uplift, before caps. */
  entitledDiscountBps: number;
  /** True when the RUPEE cap, not the percentage, is what bound. */
  cappedByAmount: boolean;
  reasonCode:
    | "WITHIN_EARNED_DISCOUNT"
    | "ABOVE_AUTO_APPLY_CEILING"
    | "ABOVE_NEGOTIABLE_MAXIMUM"
    | "WOULD_BREACH_FLOOR_MARGIN"
    | "COST_UNKNOWN"
    | "NOTHING_TO_NEGOTIATE";
  /** Written for the shopper, not for a log. */
  explanation: string;
}

function clampBps(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(10_000, Math.floor(value));
}

/** Would this discount take the basket below the merchant's floor margin? */
function breachesFloorMargin(
  basketTotalMinor: number,
  basketCostMinor: number,
  discountBps: number,
  floorMarginBps: number,
): boolean {
  const revenueAfter = basketTotalMinor - Math.round((basketTotalMinor * discountBps) / 10_000);
  if (revenueAfter <= 0) return true;
  const marginBps = Math.round(((revenueAfter - basketCostMinor) / revenueAfter) * 10_000);
  return marginBps < floorMarginBps;
}

/**
 * Decides a negotiation.
 *
 * Never mutates its inputs, never consults a model, and never returns a
 * discount above `policy.maxNegotiableDiscountBps` in any branch.
 */
export function evaluateNegotiation(input: NegotiationInput): NegotiationDecision {
  const { policy, standing, basketTotalMinor } = input;

  const minorFor = (bps: number) => Math.round((basketTotalMinor * bps) / 10_000);

  // What their history plus this basket's size entitles them to, before
  // any of the merchant's caps are applied.
  const entitledRaw = standing.earnedDiscountBps + volumeUpliftBps(basketTotalMinor);
  const entitledDiscountBps = Math.min(entitledRaw, policy.autoApplyCeilingBps, policy.maxNegotiableDiscountBps);

  // THE RUPEE STOP. A percentage is not a limit on a large basket, so the
  // absolute cap is applied to the entitlement itself — before anything is
  // offered, not as an afterthought once it has been promised.
  const entitledMinorUncapped = minorFor(entitledDiscountBps);
  const cappedByAmount = entitledMinorUncapped > policy.maxAutoApplyDiscountMinor;
  const autoApplyBps = cappedByAmount
    ? Math.floor((policy.maxAutoApplyDiscountMinor / Math.max(1, basketTotalMinor)) * 10_000)
    : entitledDiscountBps;
  const autoApplyMinor = minorFor(autoApplyBps);

  const base = {
    entitledDiscountBps,
    cappedByAmount,
    counterOfferBps: autoApplyBps,
    counterOfferMinor: autoApplyMinor,
  };

  const requested = input.requestedDiscountBps === null ? null : clampBps(input.requestedDiscountBps);

  // "Offer me what I've earned", or a request for nothing.
  const target = requested ?? autoApplyBps;

  if (target === 0) {
    return {
      ...base,
      outcome: "DECLINED",
      appliedDiscountBps: 0,
      appliedDiscountMinor: 0,
      finalTotalMinor: basketTotalMinor,
      reasonCode: "NOTHING_TO_NEGOTIATE",
      explanation:
        standing.earnedDiscountBps === 0
          ? `${standing.explanation} Once you have an order behind you, a discount applies here automatically.`
          : "No discount was requested, so nothing changed.",
    };
  }

  if (target > policy.maxNegotiableDiscountBps) {
    return {
      ...base,
      outcome: "DECLINED",
      appliedDiscountBps: 0,
      appliedDiscountMinor: 0,
      finalTotalMinor: basketTotalMinor,
      reasonCode: "ABOVE_NEGOTIABLE_MAXIMUM",
      explanation:
        autoApplyBps > 0
          ? `${pct(target)} is past the ${pct(policy.maxNegotiableDiscountBps)} this merchant will ever negotiate, so it cannot go to them for approval either. You can have ${pct(autoApplyBps)} off — ${rupees(autoApplyMinor, policy.currency)} — right now.`
          : `${pct(target)} is past the ${pct(policy.maxNegotiableDiscountBps)} this merchant will ever negotiate. Nothing has been applied.`,
    };
  }

  // Cost unknown fails CLOSED. A discount nobody can prove is affordable is
  // exactly the kind a human should be looking at.
  if (input.basketCostMinor === null) {
    return {
      ...base,
      outcome: "PROPOSED_TO_MERCHANT",
      appliedDiscountBps: 0,
      appliedDiscountMinor: 0,
      finalTotalMinor: basketTotalMinor,
      counterOfferBps: 0,
      counterOfferMinor: 0,
      reasonCode: "COST_UNKNOWN",
      explanation: `This merchant has not recorded a cost for everything in this basket, so no discount can be checked against their floor margin automatically. Your request for ${pct(target)} has gone to them to decide.`,
    };
  }

  if (breachesFloorMargin(basketTotalMinor, input.basketCostMinor, target, policy.floorMarginBps)) {
    // Refused, not reduced: a smaller breach is still a breach. But if a
    // SMALLER, already-earned discount clears the floor, that is offered.
    const counterClears =
      autoApplyBps > 0 &&
      !breachesFloorMargin(basketTotalMinor, input.basketCostMinor, autoApplyBps, policy.floorMarginBps);

    return {
      ...base,
      outcome: "DECLINED",
      appliedDiscountBps: 0,
      appliedDiscountMinor: 0,
      finalTotalMinor: basketTotalMinor,
      counterOfferBps: counterClears ? autoApplyBps : 0,
      counterOfferMinor: counterClears ? autoApplyMinor : 0,
      reasonCode: "WOULD_BREACH_FLOOR_MARGIN",
      explanation: counterClears
        ? `${pct(target)} would take this basket below the margin this merchant sells at, so it was refused rather than trimmed. ${pct(autoApplyBps)} off — ${rupees(autoApplyMinor, policy.currency)} — does clear it, and is yours now.`
        // The phrase matters in BOTH branches: "refused rather than
        // trimmed" is the claim being made, and it should not depend on
        // whether a counter-offer happened to exist.
        : `${pct(target)} would take this basket below the margin this merchant sells at, so it was refused rather than trimmed. A smaller version of a discount that goes below cost still goes below cost.`,
    };
  }

  // Inside what they have earned AND inside the rupee cap: it just happens.
  if (target <= autoApplyBps) {
    const appliedMinor = minorFor(target);
    return {
      ...base,
      outcome: "AUTO_APPLIED",
      appliedDiscountBps: target,
      appliedDiscountMinor: appliedMinor,
      finalTotalMinor: basketTotalMinor - appliedMinor,
      reasonCode: "WITHIN_EARNED_DISCOUNT",
      explanation: `${pct(target)} off — ${rupees(appliedMinor, policy.currency)} — applied automatically. ${standing.explanation}${
        cappedByAmount
          ? ` On an order this size the automatic discount stops at ${rupees(policy.maxAutoApplyDiscountMinor, policy.currency)}, so a larger one needs the merchant.`
          : ""
      }`,
    };
  }

  // Past the line, but negotiable. A human decides.
  return {
    ...base,
    outcome: "PROPOSED_TO_MERCHANT",
    appliedDiscountBps: 0,
    appliedDiscountMinor: 0,
    finalTotalMinor: basketTotalMinor,
    reasonCode: "ABOVE_AUTO_APPLY_CEILING",
    explanation: cappedByAmount
      ? `${pct(target)} is more than the ${rupees(policy.maxAutoApplyDiscountMinor, policy.currency)} that applies automatically on an order this size, so it has gone to the merchant to decide. ${
          autoApplyBps > 0
            ? `You can take ${pct(autoApplyBps)} — ${rupees(autoApplyMinor, policy.currency)} — now instead of waiting.`
            : ""
        }`.trim()
      : `${pct(target)} is above the ${pct(policy.autoApplyCeilingBps)} this merchant lets through automatically, so it has gone to them to decide. ${
          autoApplyBps > 0
            ? `You can take ${pct(autoApplyBps)} — ${rupees(autoApplyMinor, policy.currency)} — now instead of waiting.`
            : ""
        }`.trim(),
  };
}
