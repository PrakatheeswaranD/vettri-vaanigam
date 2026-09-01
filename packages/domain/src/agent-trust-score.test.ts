import { describe, it, expect } from "vitest";
import {
  computeAgentTrust,
  effectiveCeilingMinor,
  bandForScore,
  isAttackShapedReason,
  isPolicyDeclineReason,
  ATTACK_REASON_CODES,
  TRUST_MAX_EARNED_ORDERS,
  TRUST_SCORE_BASELINE,
} from "./agent-trust-score.js";

const CEILINGS = { unknownAgentCeilingMinor: 1_000_000, knownAgentCeilingMinor: 5_000_000 };

describe("agent trust score", () => {
  it("starts a brand-new agent at the baseline", () => {
    const trust = computeAgentTrust({ settledOrders: 0, declines: 0, flaggedAttacks: 0 });
    expect(trust.score).toBe(TRUST_SCORE_BASELINE);
    expect(trust.explanation).toContain("No history with you yet");
  });

  it("earns trust slowly on settled orders", () => {
    expect(computeAgentTrust({ settledOrders: 3, declines: 0, flaggedAttacks: 0 }).score).toBe(80);
  });

  it("loses trust faster than it earns it", () => {
    const earned = computeAgentTrust({ settledOrders: 1, declines: 0, flaggedAttacks: 0 }).score;
    const lost = computeAgentTrust({ settledOrders: 0, declines: 1, flaggedAttacks: 0 }).score;
    expect(TRUST_SCORE_BASELINE - lost).toBeGreaterThan(earned - TRUST_SCORE_BASELINE);
  });

  /** The asymmetry is the whole design: cheating must cost far more than
   * good behaviour earns, or an attacker simply farms trust first. */
  it("makes one flagged attack cancel exactly four clean orders", () => {
    const fourOrders = computeAgentTrust({ settledOrders: 4, declines: 0, flaggedAttacks: 0 }).score;
    const sameAgentCaught = computeAgentTrust({ settledOrders: 4, declines: 0, flaggedAttacks: 1 }).score;

    expect(fourOrders).toBe(90);
    // Back to baseline: four orders of good behaviour, erased.
    expect(sameAgentCaught).toBe(TRUST_SCORE_BASELINE);
    expect(fourOrders - sameAgentCaught).toBe(40);
  });

  it("drops a previously-trusted agent below baseline on a second attack", () => {
    expect(computeAgentTrust({ settledOrders: 4, declines: 0, flaggedAttacks: 2 }).score).toBe(10);
  });

  /**
   * Without a cap on earned credit, an agent with hundreds of orders sits
   * so far above 100 that every penalty vanishes into the clamp — it buys
   * permanent immunity by being busy. This is the property that stops it.
   */
  it("does not let a high-volume agent buy immunity to being caught", () => {
    const busyAndClean = computeAgentTrust({ settledOrders: 500, declines: 0, flaggedAttacks: 0 });
    expect(busyAndClean.score).toBe(100);

    const busyAndCaught = computeAgentTrust({ settledOrders: 500, declines: 0, flaggedAttacks: 1 });
    expect(busyAndCaught.score).toBe(60);
    expect(busyAndCaught.score).toBeLessThan(busyAndClean.score);
  });

  it("saturates earned credit at the documented order count", () => {
    const atCap = computeAgentTrust({ settledOrders: TRUST_MAX_EARNED_ORDERS, declines: 0, flaggedAttacks: 0 }).score;
    const wellPast = computeAgentTrust({ settledOrders: TRUST_MAX_EARNED_ORDERS * 20, declines: 0, flaggedAttacks: 0 }).score;
    expect(atCap).toBe(100);
    expect(wellPast).toBe(atCap);
  });

  it("says how many orders actually counted when the cap bit", () => {
    const trust = computeAgentTrust({ settledOrders: 40, declines: 0, flaggedAttacks: 0 });
    expect(trust.explanation).toContain("40 settled orders");
    expect(trust.explanation).toContain(`${TRUST_MAX_EARNED_ORDERS} of them counted`);
  });

  it("clamps to 0..100 rather than running away", () => {
    expect(computeAgentTrust({ settledOrders: 999, declines: 0, flaggedAttacks: 0 }).score).toBe(100);
    expect(computeAgentTrust({ settledOrders: 0, declines: 0, flaggedAttacks: 99 }).score).toBe(0);
  });

  it("ignores nonsensical negative history instead of inflating the score", () => {
    expect(computeAgentTrust({ settledOrders: -5, declines: -5, flaggedAttacks: -5 }).score).toBe(TRUST_SCORE_BASELINE);
  });

  it("says plainly when an attack is what moved the score", () => {
    const trust = computeAgentTrust({ settledOrders: 2, declines: 0, flaggedAttacks: 1 });
    expect(trust.explanation).toContain("flagged attack");
    expect(trust.explanation).toContain("cancels four clean orders");
  });

  it("bands the score for a merchant rather than showing a bare number", () => {
    expect(bandForScore(0)).toBe("UNTRUSTED");
    expect(bandForScore(30)).toBe("PROVISIONAL");
    expect(bandForScore(60)).toBe("ESTABLISHED");
    expect(bandForScore(95)).toBe("TRUSTED");
  });
});

describe("effective ceiling", () => {
  /**
   * The raw spec formula (`base * (1 + score/100)`) would hand a brand-new
   * agent 1.5x the merchant's unknown-agent ceiling — more authority than
   * was configured, for an agent nobody has transacted with.
   */
  it("never gives an unproven agent more than the configured unknown-agent ceiling", () => {
    // A brand-new agent scores the BASELINE, not zero. This is the case the
    // spec's raw formula gets wrong, so it is the case worth pinning.
    const fresh = effectiveCeilingMinor({ trustScore: TRUST_SCORE_BASELINE, ...CEILINGS });
    expect(fresh.ceilingMinor).toBe(CEILINGS.unknownAgentCeilingMinor);
    expect(fresh.earned).toBe(false);
    expect(fresh.collapsed).toBe(false);
  });

  it("ramps toward the known-agent ceiling as trust is earned", () => {
    const mid = effectiveCeilingMinor({ trustScore: 75, ...CEILINGS });
    expect(mid.ceilingMinor).toBe(3_000_000);
    expect(mid.earned).toBe(true);
  });

  it("rises monotonically — more trust never means less ceiling", () => {
    let previous = -1;
    for (let score = 0; score <= 100; score += 1) {
      const { ceilingMinor } = effectiveCeilingMinor({ trustScore: score, ...CEILINGS });
      expect(ceilingMinor).toBeGreaterThanOrEqual(previous);
      previous = ceilingMinor;
    }
  });

  /**
   * The half a one-sided ramp silently drops. "Collapses the moment an
   * agent misbehaves" has to mean below the unknown-agent floor too, or a
   * caught agent still auto-approves everything a stranger could.
   */
  it("collapses a caught agent BELOW the unknown-agent floor", () => {
    const caught = effectiveCeilingMinor({ trustScore: 25, ...CEILINGS });
    expect(caught.ceilingMinor).toBeLessThan(CEILINGS.unknownAgentCeilingMinor);
    expect(caught.collapsed).toBe(true);
    expect(caught.earned).toBe(false);
  });

  it("takes a zero-trust agent to a zero ceiling, so everything steps up", () => {
    expect(effectiveCeilingMinor({ trustScore: 0, ...CEILINGS }).ceilingMinor).toBe(0);
  });

  it("still collapses for a merchant who set both ceilings the same", () => {
    const flat = { unknownAgentCeilingMinor: 1_000_000, knownAgentCeilingMinor: 1_000_000 };
    expect(effectiveCeilingMinor({ trustScore: 0, ...flat }).ceilingMinor).toBe(0);
  });

  /** A derived score must never mint authority beyond a configured limit. */
  it("caps at the merchant's known-agent ceiling even at a perfect score", () => {
    const perfect = effectiveCeilingMinor({ trustScore: 100, ...CEILINGS });
    expect(perfect.ceilingMinor).toBe(CEILINGS.knownAgentCeilingMinor);
    expect(perfect.cappedByPolicy).toBe(true);
  });

  it("grants no extra ceiling to a merchant who never configured a higher one", () => {
    const flat = { unknownAgentCeilingMinor: 1_000_000, knownAgentCeilingMinor: 1_000_000 };
    for (const score of [50, 75, 100]) {
      expect(effectiveCeilingMinor({ trustScore: score, ...flat }).ceilingMinor).toBe(1_000_000);
    }
  });

  it("survives a misconfigured policy where known is below unknown", () => {
    const inverted = { unknownAgentCeilingMinor: 5_000_000, knownAgentCeilingMinor: 1_000_000 };
    const result = effectiveCeilingMinor({ trustScore: 100, ...inverted });
    // The floor wins: a bad config must not silently reduce authority
    // below what the merchant set for unknown agents.
    expect(result.ceilingMinor).toBe(5_000_000);
  });
});

describe("attack-shaped reason codes", () => {
  it("counts forgery and replay as attacks", () => {
    for (const code of ["MANDATE_NONCE_REPLAYED", "MANDATE_SIGNATURE_INVALID", "MANDATE_KEY_MISMATCH"]) {
      expect(isAttackShapedReason(code)).toBe(true);
    }
  });

  /** A false attack flag costs an honest agent 40 points, so the ambiguous
   * cases must stay out and be charged the lighter decline penalty. */
  it("does NOT count a badly-integrated but honest agent as an attacker", () => {
    for (const code of [
      "MANDATE_MISSING",
      "MANDATE_MALFORMED",
      "UNRESOLVABLE_ITEMS",
      "CATEGORY_BLOCKED",
      "UNKNOWN_AGENT_CEILING_EXCEEDED",
      "KNOWN_AGENT_CEILING_EXCEEDED",
      "VELOCITY_LIMIT_EXCEEDED",
      "EMPTY_INTENT",
    ]) {
      expect(isAttackShapedReason(code)).toBe(false);
    }
  });

  it("treats absent reasons as not an attack rather than throwing", () => {
    expect(isAttackShapedReason(null)).toBe(false);
    expect(isAttackShapedReason(undefined)).toBe(false);
    expect(isAttackShapedReason("")).toBe(false);
  });

  it("covers every attack the red-team script runs", () => {
    // B's four attacks must each land on a code that actually scores.
    expect(ATTACK_REASON_CODES).toContain("MANDATE_NONCE_REPLAYED");
    expect(ATTACK_REASON_CODES).toContain("MANDATE_EXPIRED");
    expect(ATTACK_REASON_CODES).toContain("MANDATE_AMOUNT_EXCEEDED");
  });
});

describe("policy declines vs integration errors", () => {
  it("counts overstepping a known boundary", () => {
    for (const code of ["CATEGORY_BLOCKED", "VELOCITY_LIMIT_EXCEEDED", "AMOUNT_MISMATCH"]) {
      expect(isPolicyDeclineReason(code)).toBe(true);
    }
  });

  /** A support ticket is not a risk signal. Two typo'd SKUs must not halve
   * an honest integration's ceiling. */
  it("does not charge an agent for being badly wired", () => {
    for (const code of [
      "UNRESOLVABLE_ITEMS",
      "MANDATE_MISSING",
      "MANDATE_MALFORMED",
      "PROTOCOL_UNSUPPORTED",
      "EMPTY_INTENT",
      "CURRENCY_UNSUPPORTED",
    ]) {
      expect(isPolicyDeclineReason(code)).toBe(false);
      expect(isAttackShapedReason(code)).toBe(false);
    }
  });

  /** Penalising a step-up would make the score punish the guardrail for
   * working, which is the opposite of what it is for. */
  it("never treats a step-up as a decline", () => {
    for (const code of ["UNKNOWN_AGENT_CEILING_EXCEEDED", "KNOWN_AGENT_CEILING_EXCEEDED", "WITHIN_ENVELOPE"]) {
      expect(isPolicyDeclineReason(code)).toBe(false);
      expect(isAttackShapedReason(code)).toBe(false);
    }
  });

  it("keeps the two penalty lists disjoint, so nothing is charged twice", () => {
    for (const code of ATTACK_REASON_CODES) {
      expect(isPolicyDeclineReason(code)).toBe(false);
    }
  });
});
