/**
 * Anumati Core — the merchant-policy half of the gate.
 *
 * A verified mandate says the BUYER consented. This says whether the
 * MERCHANT consents. Both must pass before anything touches a payment API,
 * and they are deliberately separate: a buyer can authorise a spend the
 * merchant still will not accept automatically from an agent it has never
 * seen.
 *
 * THREE OUTCOMES, NOT TWO
 *
 * An intent above the auto-approve ceiling is NOT rejected — it steps up
 * to human approval, mirroring how UPI AutoPay escalates above its
 * auto-debit limit. Refusing outright would lose a legitimate sale;
 * charging silently would be the thing this whole system exists to
 * prevent. Only a genuine policy violation declines.
 *
 * EVERY OUTCOME CARRIES A SENTENCE
 *
 * `explain()` returns plain English a merchant can read without an
 * engineer. The brief's bar is "no status code without a sentence", so the
 * reason is produced by the same pure function that produces the decision
 * — it cannot drift from it, and it cannot be forgotten.
 *
 * Pure: no database, no clock, no AI. The negotiator may later propose a
 * discount, but its ceiling is enforced here, in code.
 */
import type { AgentTrustLevel } from "./agent-protocol.js";
import type { CurrencyCode } from "./money.js";

export const GATEWAY_DECISIONS = ["AUTO_APPROVE", "STEP_UP", "DECLINE"] as const;
export type GatewayDecision = (typeof GATEWAY_DECISIONS)[number];

export const GATEWAY_REASON_CODES = [
  "WITHIN_ENVELOPE",
  "UNKNOWN_AGENT_CEILING_EXCEEDED",
  "KNOWN_AGENT_CEILING_EXCEEDED",
  "CATEGORY_BLOCKED",
  "VELOCITY_LIMIT_EXCEEDED",
  "PROTOCOL_UNSUPPORTED",
  "AMOUNT_MISMATCH",
  "EMPTY_INTENT",
  "CURRENCY_UNSUPPORTED",
] as const;
export type GatewayReasonCode = (typeof GATEWAY_REASON_CODES)[number];

export interface AgentGatewayPolicy {
  policyVersion: number;
  currency: CurrencyCode;
  /** Ceiling for an agent this merchant has never transacted with. */
  unknownAgentCeilingMinor: number;
  /** Ceiling for an agent with prior settled orders. */
  knownAgentCeilingMinor: number;
  /** Categories an agent may never buy autonomously, whatever the amount. */
  blockedCategories: string[];
  /** Hard cap on what the negotiator may ever offer. Enforced in code. */
  maxNegotiationDiscountBps: number;
  /** The negotiator only engages on baskets SMALLER than this. Upselling a
   * buyer who already filled their basket discounts a sale you had. */
  negotiatorMinBundleItems: number;
  /** Floor margin in basis points. An offer that would take the basket
   * below it is REJECTED, not clamped — clamping a margin breach still
   * sells below the floor, just by less. */
  negotiatorFloorMarginBps: number;
  /** Intents per hour from one agent before it is treated as abusive. */
  velocityMaxIntentsPerHour: number;
  /** Whether an unseen agent's first signing key may be pinned
   * automatically. Off by default: trust-on-first-use gives continuity,
   * not first-contact authenticity. */
  allowFirstUseKeyPinning: boolean;
}

export interface GatewayEvaluationContext {
  agentTrust: AgentTrustLevel;
  /** Server-computed from the catalogue. Never the agent's claimed total. */
  orderTotalMinor: number;
  /** What the agent said it would cost, when it said anything. */
  claimedTotalMinor: number | null;
  currency: CurrencyCode;
  categories: string[];
  lineCount: number;
  /** Intents already seen from this agent in the trailing hour. */
  recentIntentCount: number;
  protocolSupported: boolean;
}

export interface GatewayEvaluationResult {
  decision: GatewayDecision;
  reasonCode: GatewayReasonCode;
  /** Plain English, written for a merchant, never a status code alone. */
  explanation: string;
  /** The ceiling that applied, so the console can show the comparison. */
  appliedCeilingMinor: number;
  policyVersion: number;
}

function majorUnits(minor: number, currency: CurrencyCode): string {
  const symbol = currency === "INR" ? "₹" : "$";
  return `${symbol}${(minor / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function evaluateAgentGatewayPolicy(
  policy: AgentGatewayPolicy,
  context: GatewayEvaluationContext,
): GatewayEvaluationResult {
  const ceiling =
    context.agentTrust === "KNOWN" ? policy.knownAgentCeilingMinor : policy.unknownAgentCeilingMinor;

  const base = { appliedCeilingMinor: ceiling, policyVersion: policy.policyVersion };

  if (!context.protocolSupported) {
    return {
      ...base,
      decision: "DECLINE",
      reasonCode: "PROTOCOL_UNSUPPORTED",
      explanation:
        "This request did not identify itself as any agent-commerce protocol this gateway speaks, so its contents could not be read safely. Nothing was charged.",
    };
  }

  if (context.lineCount === 0) {
    return {
      ...base,
      decision: "DECLINE",
      reasonCode: "EMPTY_INTENT",
      explanation: "The agent sent a purchase intent with no resolvable items in it, so there was nothing to price.",
    };
  }

  if (context.currency !== policy.currency) {
    return {
      ...base,
      decision: "DECLINE",
      reasonCode: "CURRENCY_UNSUPPORTED",
      explanation: `This agent asked to pay in ${context.currency}, but you sell in ${policy.currency}. Converting on your behalf would invent an exchange rate, so the request was declined rather than guessed.`,
    };
  }

  // Checked before the ceilings: a mismatch means the two sides disagree
  // about what is being bought, which is a worse problem than the amount.
  if (context.claimedTotalMinor !== null && context.claimedTotalMinor !== context.orderTotalMinor) {
    return {
      ...base,
      decision: "DECLINE",
      reasonCode: "AMOUNT_MISMATCH",
      explanation: `The agent expected to pay ${majorUnits(context.claimedTotalMinor, context.currency)} but your catalogue prices this basket at ${majorUnits(context.orderTotalMinor, context.currency)}. Your price is the one that counts, and the difference was large enough to stop rather than surprise the buyer.`,
    };
  }

  const blocked = context.categories.find((category) =>
    policy.blockedCategories.some((b) => b.toLowerCase() === category.toLowerCase()),
  );
  if (blocked) {
    return {
      ...base,
      decision: "DECLINE",
      reasonCode: "CATEGORY_BLOCKED",
      explanation: `You have blocked "${blocked}" from autonomous agent purchases, so this order cannot be approved automatically at any value.`,
    };
  }

  // `>=`, not `>`. With a limit of 20 the 21st attempt must be refused;
  // `>` let it through and only blocked the 22nd, so the effective limit
  // was always one higher than the merchant configured.
  if (context.recentIntentCount >= policy.velocityMaxIntentsPerHour) {
    return {
      ...base,
      decision: "DECLINE",
      reasonCode: "VELOCITY_LIMIT_EXCEEDED",
      explanation: `This agent has sent ${context.recentIntentCount} purchase attempts in the last hour, past your limit of ${policy.velocityMaxIntentsPerHour}. Further attempts are declined until it slows down.`,
    };
  }

  if (context.orderTotalMinor > ceiling) {
    const over = context.orderTotalMinor - ceiling;
    const multiple = (context.orderTotalMinor / ceiling).toFixed(1);
    return {
      ...base,
      decision: "STEP_UP",
      reasonCode: context.agentTrust === "KNOWN" ? "KNOWN_AGENT_CEILING_EXCEEDED" : "UNKNOWN_AGENT_CEILING_EXCEEDED",
      explanation:
        context.agentTrust === "KNOWN"
          ? `This agent has bought from you before, but ${majorUnits(context.orderTotalMinor, context.currency)} is ${multiple}x your ${majorUnits(ceiling, context.currency)} automatic limit — ${majorUnits(over, context.currency)} over. Sending it to you for approval instead of charging it.`
          : `This agent hasn't transacted with you before, and the order is ${multiple}x your ${majorUnits(ceiling, context.currency)} unknown-agent limit — ${majorUnits(over, context.currency)} over. Declining automatic approval and sending it to you for review.`,
    };
  }

  return {
    ...base,
    decision: "AUTO_APPROVE",
    reasonCode: "WITHIN_ENVELOPE",
    explanation: `${majorUnits(context.orderTotalMinor, context.currency)} is within your ${majorUnits(ceiling, context.currency)} limit for ${context.agentTrust === "KNOWN" ? "agents you've sold to before" : "agents you haven't seen before"}, and nothing in the basket is restricted. Approved automatically.`,
  };
}

/**
 * The negotiator's ceiling, enforced outside the model.
 *
 * The LLM proposes a discount; this clamps it. A model that returns 40%
 * because it was asked nicely, or because a product description told it
 * to, cannot move money — the returned figure is what applies.
 */
export function clampNegotiatedDiscountBps(proposedBps: number, policy: AgentGatewayPolicy): number {
  if (!Number.isFinite(proposedBps) || proposedBps <= 0) return 0;
  return Math.min(Math.floor(proposedBps), policy.maxNegotiationDiscountBps);
}

/**
 * Whether the negotiator should be consulted at all.
 *
 * A basket already at or above the bundle threshold is a sale in hand;
 * offering a discount on it is margin the merchant was going to keep.
 */
export function shouldNegotiate(lineCount: number, policy: AgentGatewayPolicy): boolean {
  return policy.maxNegotiationDiscountBps > 0 && lineCount < policy.negotiatorMinBundleItems;
}

export interface OfferUnitEconomics {
  /** Full bundle selling price before the proposed discount. */
  revenueMinor: number;
  /** Full bundle COGS. Null means the merchant has not supplied cost. */
  costMinor: number | null;
  discountBps: number;
}

/** Gross margin after discount, or null when it cannot be known safely. */
export function projectedGrossMarginBps(economics: OfferUnitEconomics): number | null {
  if (
    !Number.isInteger(economics.revenueMinor) ||
    economics.revenueMinor <= 0 ||
    economics.costMinor === null ||
    !Number.isInteger(economics.costMinor) ||
    economics.costMinor < 0 ||
    !Number.isInteger(economics.discountBps) ||
    economics.discountBps < 0 ||
    economics.discountBps > 10_000
  ) {
    return null;
  }

  // Round down revenue: a floor check may never gain a paisa through
  // optimistic rounding. Negative margin is preserved rather than clamped.
  const discountedRevenueMinor = Math.floor(
    (economics.revenueMinor * (10_000 - economics.discountBps)) / 10_000,
  );
  if (discountedRevenueMinor <= 0) return null;
  return Math.floor(
    ((discountedRevenueMinor - economics.costMinor) * 10_000) / discountedRevenueMinor,
  );
}

/**
 * Rejects an offer below the configured REAL gross-margin floor.
 *
 * Unknown or malformed cost data fails closed. The negotiator is optional;
 * protecting the approved base sale is not. This is intentionally stricter
 * than treating missing cost as zero, which would manufacture 100% margin.
 */
export function offerBreachesFloorMargin(
  economics: OfferUnitEconomics,
  policy: AgentGatewayPolicy,
): boolean {
  const projected = projectedGrossMarginBps(economics);
  return projected === null || projected < policy.negotiatorFloorMarginBps;
}
