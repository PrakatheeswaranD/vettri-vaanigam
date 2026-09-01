/**
 * Adaptive agent trust — a ceiling that earns itself up and collapses fast.
 *
 * Replaces the flat known/unknown binary with a score derived from an
 * agent's OWN history with THIS merchant. It is a pure derived view: no new
 * write path, just arithmetic over Decision Records already being written.
 *
 * THE SHAPE IS DELIBERATE
 *
 *   +10 per settled order      earning trust is slow
 *   -25 per policy decline     losing it is faster
 *   -40 per flagged attack     losing it after cheating is fastest
 *
 * TRUST SATURATES, AND THAT IS NOT AN IMPLEMENTATION DETAIL
 *
 * Credit for good behaviour stops at `TRUST_MAX_EARNED_ORDERS`. Without a
 * cap, an agent with 500 settled orders scores 5,050 before clamping, so
 * every penalty is absorbed by the clamp and the agent is permanently
 * immune to being caught. A high-volume integration would literally buy
 * impunity. Saturating the earning side means an attack always moves the
 * score, however long the agent has been around — which is the only way
 * "collapses the moment an agent misbehaves" can be true of a real,
 * busy counterparty rather than only of a toy one.
 *
 * PENALTIES ARE COUNTED OVER A WINDOW, NOT FOREVER
 *
 * The caller supplies counts; it is the caller's job to bound them to a
 * trailing window (see `TRUST_PENALTY_WINDOW_DAYS`). A score nothing can
 * ever fall off is a ban, not a score, and it would leave an agent that
 * fixed its integration permanently throttled with no route back.
 *
 * A single detected attack cancels exactly four clean orders (-40 against
 * +10 each). That 4:1 asymmetry is the point: an agent that has behaved
 * well for months and then replays a mandate should not keep its elevated
 * ceiling while a human works out what happened.
 *
 * TWO SAFETY PROPERTIES THE RAW FORMULA DOES NOT GIVE YOU
 *
 * 1. The spec's `base * (1 + score/100)` means a brand-new agent at the
 *    starting score of 50 would get 1.5x the merchant's unknown-agent
 *    ceiling — MORE authority than the merchant configured, for an agent
 *    nobody has ever transacted with. So the ramp is anchored at the
 *    BASELINE, not at zero: only the part of a score ABOVE 50 is "earned",
 *    and a fresh agent lands exactly on the configured unknown ceiling.
 *
 * 2. The result is capped at the merchant's KNOWN-agent ceiling. Trust may
 *    move an agent up through the band the merchant already authorised; it
 *    may never mint authority beyond the maximum a human set. A derived
 *    score must not be able to exceed a configured limit.
 *
 * And the ramp runs BOTH ways. Below the baseline it collapses toward
 * zero, so a caught agent does not merely lose its earned headroom — it
 * loses the unknown-agent ceiling too, and everything it sends steps up to
 * a human. That is the "collapses the moment an agent misbehaves" half of
 * the idea, which a one-sided ramp would quietly drop.
 */

/** Where an agent with no history starts. */
export const TRUST_SCORE_BASELINE = 50;

/**
 * Settled orders beyond this earn no further credit.
 *
 * Five is deliberate: it is exactly enough to reach 100 from the baseline,
 * so a clean agent can still reach the full ceiling its merchant
 * configured, and not one order more, so it can never bank surplus points
 * as a buffer against future penalties.
 */
export const TRUST_MAX_EARNED_ORDERS = 5;

/**
 * How far back the caller should count declines and attacks.
 *
 * Advisory — this module is pure and takes counts, not dates — but it
 * belongs here so the window is stated once next to the weights it
 * modifies, rather than buried in whichever query happens to run.
 */
export const TRUST_PENALTY_WINDOW_DAYS = 30;

export const TRUST_WEIGHTS = {
  settledOrder: 10,
  decline: -25,
  flaggedAttack: -40,
} as const;

export interface AgentTrustInputs {
  /** Lifetime settled orders. Credit saturates at TRUST_MAX_EARNED_ORDERS. */
  settledOrders: number;
  /** Policy declines inside the penalty window. Integration errors — a
   * malformed mandate, an unresolvable SKU — are NOT declines for this
   * purpose: they describe a badly-wired agent, not a hostile one, and
   * charging 25 points for a typo would collapse an honest integration. */
  declines: number;
  /** Attack-shaped decisions inside the penalty window. */
  flaggedAttacks: number;
}

export type TrustBand = "UNTRUSTED" | "PROVISIONAL" | "ESTABLISHED" | "TRUSTED";

export interface AgentTrust {
  score: number;
  band: TrustBand;
  /** Plain English, for a merchant reading why a ceiling moved. */
  explanation: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function bandForScore(score: number): TrustBand {
  if (score >= 80) return "TRUSTED";
  if (score >= 55) return "ESTABLISHED";
  if (score >= 25) return "PROVISIONAL";
  return "UNTRUSTED";
}

export function computeAgentTrust(inputs: AgentTrustInputs): AgentTrust {
  const creditedOrders = Math.min(Math.max(0, inputs.settledOrders), TRUST_MAX_EARNED_ORDERS);

  const raw =
    TRUST_SCORE_BASELINE +
    TRUST_WEIGHTS.settledOrder * creditedOrders +
    TRUST_WEIGHTS.decline * Math.max(0, inputs.declines) +
    TRUST_WEIGHTS.flaggedAttack * Math.max(0, inputs.flaggedAttacks);

  const score = clamp(Math.round(raw), 0, 100);

  const parts: string[] = [];
  if (inputs.settledOrders > 0) {
    const capped = inputs.settledOrders > TRUST_MAX_EARNED_ORDERS ? ` (${TRUST_MAX_EARNED_ORDERS} of them counted)` : "";
    parts.push(`${inputs.settledOrders} settled order${inputs.settledOrders === 1 ? "" : "s"}${capped}`);
  }
  if (inputs.declines > 0) parts.push(`${inputs.declines} decline${inputs.declines === 1 ? "" : "s"}`);
  if (inputs.flaggedAttacks > 0) {
    parts.push(`${inputs.flaggedAttacks} flagged attack${inputs.flaggedAttacks === 1 ? "" : "s"}`);
  }

  const explanation =
    parts.length === 0
      ? "No history with you yet, so this agent starts at the baseline and is held to your unknown-agent limit."
      : inputs.flaggedAttacks > 0
        ? `Scored ${score} from ${parts.join(", ")}. Each flagged attack cancels four clean orders — deliberately asymmetric.`
        : `Scored ${score} from ${parts.join(", ")}.`;

  return { score, band: bandForScore(score), explanation };
}

export interface EffectiveCeilingInputs {
  trustScore: number;
  /** The merchant's configured floor — what an unknown agent may spend. */
  unknownAgentCeilingMinor: number;
  /** The merchant's configured maximum. Trust can never exceed this. */
  knownAgentCeilingMinor: number;
}

export interface EffectiveCeiling {
  ceilingMinor: number;
  /** True when trust moved the ceiling above the unknown-agent floor. */
  earned: boolean;
  /** True when past behaviour pulled the ceiling BELOW the unknown floor. */
  collapsed: boolean;
  /** True when the configured maximum, not the score, is what binds. */
  cappedByPolicy: boolean;
}

/**
 * Turns a score into the ceiling that actually applies.
 *
 * Anchored at the BASELINE score, ramping in both directions:
 *
 *   score 100  ->  the merchant's known-agent ceiling (never past it)
 *   score  50  ->  the merchant's unknown-agent ceiling, exactly
 *   score   0  ->  zero: nothing auto-approves, everything steps up
 *
 * A merchant who has not configured a higher known-agent ceiling therefore
 * gets no upward change at all, which is correct — they never authorised a
 * larger number — while the downward collapse still applies, because that
 * direction only ever removes authority.
 */
export function effectiveCeilingMinor(inputs: EffectiveCeilingInputs): EffectiveCeiling {
  const floor = Math.max(0, inputs.unknownAgentCeilingMinor);
  const max = Math.max(floor, inputs.knownAgentCeilingMinor);
  const score = clamp(inputs.trustScore, 0, 100);

  let ceilingMinor: number;
  if (score >= TRUST_SCORE_BASELINE) {
    const earnedRatio = (score - TRUST_SCORE_BASELINE) / (100 - TRUST_SCORE_BASELINE);
    ceilingMinor = Math.min(Math.round(floor + (max - floor) * earnedRatio), max);
  } else {
    // Collapsing. Scaled off the floor, so a merchant with no elevated
    // known-agent ceiling still gets the protective half of this feature.
    ceilingMinor = Math.round(floor * (score / TRUST_SCORE_BASELINE));
  }

  return {
    ceilingMinor,
    earned: ceilingMinor > floor,
    collapsed: ceilingMinor < floor,
    cappedByPolicy: ceilingMinor === max && max > floor,
  };
}

/**
 * Which recorded declines count as an ATTACK rather than a mishap.
 *
 * This is what makes the trust score a derived view with no new write
 * path: the gateway already records a `reasonCode` on every decision, so
 * "flagged attacks" is a filter over history, not a new counter someone
 * has to remember to increment.
 *
 * The line is drawn at intent, and drawn conservatively — a false attack
 * flag costs an honest agent 40 points, so anything genuinely ambiguous is
 * left out:
 *
 *   IN   a replayed nonce, a signature that does not verify, a key that is
 *        not the registered one, a mandate issued to a different agent or
 *        scoped to a different merchant. None of these happen by accident.
 *
 *   IN   a mandate presented past its own stated expiry, and a cart whose
 *        server-priced total exceeds the mandate's own max. The agent
 *        signed both constraints itself; sending something that breaks
 *        them is the agent ignoring its own declaration.
 *
 *   OUT  a missing or malformed mandate, an unresolvable SKU, a blocked
 *        category, a ceiling exceeded. These are what a badly-integrated
 *        but honest agent looks like, and they already cost 25 as declines.
 */
export const ATTACK_REASON_CODES = [
  "MANDATE_NONCE_REPLAYED",
  "MANDATE_SIGNATURE_INVALID",
  "MANDATE_KEY_MISMATCH",
  "MANDATE_AGENT_MISMATCH",
  "MANDATE_MERCHANT_SCOPE_MISMATCH",
  "MANDATE_EXPIRED",
  "MANDATE_NOT_YET_VALID",
  "MANDATE_AMOUNT_EXCEEDED",
  "MANDATE_CURRENCY_MISMATCH",
] as const;

export type AttackReasonCode = (typeof ATTACK_REASON_CODES)[number];

const ATTACK_REASON_SET: ReadonlySet<string> = new Set(ATTACK_REASON_CODES);

/** True when a recorded decision reason indicates deliberate cheating. */
export function isAttackShapedReason(reasonCode: string | null | undefined): boolean {
  return reasonCode != null && ATTACK_REASON_SET.has(reasonCode);
}

/**
 * Which recorded declines count as the agent OVERSTEPPING, at -25.
 *
 * Narrower than "everything that got declined", on purpose. A decline has
 * three quite different causes and only one of them says anything about
 * the agent's judgement:
 *
 *   -40  it cheated              (ATTACK_REASON_CODES, above)
 *   -25  it overstepped          this list: it tried to buy something the
 *                                merchant refuses, or hammered the gate
 *     0  it is badly wired       a malformed mandate, an unresolvable SKU,
 *                                an unreadable protocol
 *
 * The third case is the one worth being careful about. An integration bug
 * is a support ticket, not a risk signal, and at -25 a pair of them would
 * halve an honest merchant integration's ceiling before anyone noticed.
 * Those decisions are still recorded and still visible in the console —
 * they simply do not move the score.
 *
 * Ceiling step-ups are absent for the same reason twice over: a step-up is
 * not a decline at all, and penalising an agent for correctly triggering
 * the very escalation the system is built around would make the score
 * punish the guardrail working.
 */
export const POLICY_DECLINE_REASON_CODES = [
  "CATEGORY_BLOCKED",
  "VELOCITY_LIMIT_EXCEEDED",
  "AMOUNT_MISMATCH",
  "ALLOWANCE_INVALID",
  "ALLOWANCE_UNAUTHENTICATED",
] as const;

export type PolicyDeclineReasonCode = (typeof POLICY_DECLINE_REASON_CODES)[number];

const POLICY_DECLINE_SET: ReadonlySet<string> = new Set(POLICY_DECLINE_REASON_CODES);

/** True when a decline reflects the agent overstepping a known boundary. */
export function isPolicyDeclineReason(reasonCode: string | null | undefined): boolean {
  return reasonCode != null && POLICY_DECLINE_SET.has(reasonCode);
}
