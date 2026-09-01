import { describe, it, expect } from "vitest";
import {
  buildPolicyDraft,
  POLICY_AUTHORING_BOUNDS,
  AUTHORABLE_POLICY_FIELDS,
  DELIBERATELY_UNAUTHORABLE_FIELDS,
} from "./policy-authoring.js";
import type { AgentGatewayPolicy } from "./agent-gateway-policy.js";

const CURRENT: AgentGatewayPolicy = {
  policyVersion: 4,
  currency: "INR",
  unknownAgentCeilingMinor: 1_000_000,
  knownAgentCeilingMinor: 5_000_000,
  blockedCategories: ["Gift Cards"],
  maxNegotiationDiscountBps: 1000,
  negotiatorMinBundleItems: 2,
  negotiatorFloorMarginBps: 2000,
  velocityMaxIntentsPerHour: 20,
  allowFirstUseKeyPinning: false,
};

describe("policy authoring — the model drafts, it does not decide", () => {
  it("produces no changes from an empty draft", () => {
    const draft = buildPolicyDraft(CURRENT, {});
    expect(draft.changes).toEqual([]);
    expect(draft.resulting).toEqual(CURRENT);
  });

  it("never mutates the policy it was given", () => {
    const snapshot = structuredClone(CURRENT);
    buildPolicyDraft(CURRENT, { unknownAgentCeilingMinor: 42, blockedCategories: ["Everything"] });
    expect(CURRENT).toEqual(snapshot);
  });

  it("translates a ceiling change into a sentence a shop owner can read", () => {
    const draft = buildPolicyDraft(CURRENT, { unknownAgentCeilingMinor: 2_000_000 });
    expect(draft.changes).toHaveLength(1);
    expect(draft.changes[0]!.before).toBe(1_000_000);
    expect(draft.changes[0]!.after).toBe(2_000_000);
    expect(draft.changes[0]!.effect).toContain("₹20,000");
    expect(draft.changes[0]!.loosens).toBe(true);
  });

  it("does not flag a tightening change as loosening a guardrail", () => {
    const draft = buildPolicyDraft(CURRENT, { unknownAgentCeilingMinor: 500_000 });
    expect(draft.changes[0]!.loosens).toBe(false);
    expect(draft.loosensAnyGuardrail).toBe(false);
  });

  it("reports nothing when the draft restates what is already configured", () => {
    const draft = buildPolicyDraft(CURRENT, {
      unknownAgentCeilingMinor: CURRENT.unknownAgentCeilingMinor,
      blockedCategories: ["gift cards"],
    });
    expect(draft.changes).toEqual([]);
  });
});

/**
 * The attack this module exists for: a sentence — or an injection hidden
 * in one — that tries to write the gate rather than pass through it.
 */
describe("policy authoring — bounds a sentence cannot cross", () => {
  it("clamps a runaway ceiling and says so out loud", () => {
    const draft = buildPolicyDraft(CURRENT, { unknownAgentCeilingMinor: 999_999_999 });
    expect(draft.changes[0]!.after).toBe(POLICY_AUTHORING_BOUNDS.maxCeilingMinor);
    expect(draft.changes[0]!.clampedFrom).toBe(999_999_999);
    expect(draft.clampNotes[0]).toContain("reduced");
  });

  it("clamps a 90% discount to the authoring maximum", () => {
    const draft = buildPolicyDraft(CURRENT, { maxNegotiationDiscountBps: 9000 });
    expect(draft.changes[0]!.after).toBe(POLICY_AUTHORING_BOUNDS.maxNegotiationDiscountBps);
    expect(draft.clampNotes).toHaveLength(1);
  });

  it("refuses to invent fields the schema does not have", () => {
    const draft = buildPolicyDraft(CURRENT, {
      unknownAgentCeilingMinor: 1_500_000,
      disableAllChecks: true,
      adminOverride: "yes",
    });
    expect(draft.ignoredFields).toContain("disableAllChecks");
    expect(draft.ignoredFields).toContain("adminOverride");
    expect(Object.keys(draft.resulting)).not.toContain("disableAllChecks");
  });

  /**
   * The single most dangerous field. Trust-on-first-use weakens an
   * authenticity guarantee rather than a spending limit, so it is not
   * reachable from a sentence at all.
   */
  it("will not turn on first-use key pinning from a sentence", () => {
    const draft = buildPolicyDraft(CURRENT, { allowFirstUseKeyPinning: true } as never);
    expect(draft.resulting.allowFirstUseKeyPinning).toBe(false);
    expect(draft.ignoredFields).toContain("allowFirstUseKeyPinning");
    expect(draft.changes).toEqual([]);
  });

  it("keeps the unauthorable list and the authorable list disjoint", () => {
    for (const field of DELIBERATELY_UNAUTHORABLE_FIELDS) {
      expect(AUTHORABLE_POLICY_FIELDS).not.toContain(field as never);
    }
  });

  it("cannot bump the policy version or switch the currency", () => {
    const draft = buildPolicyDraft(CURRENT, { policyVersion: 99, currency: "USD" } as never);
    expect(draft.resulting.policyVersion).toBe(CURRENT.policyVersion);
    expect(draft.resulting.currency).toBe("INR");
  });

  it("ignores values that are not numbers rather than coercing them to zero", () => {
    const draft = buildPolicyDraft(CURRENT, {
      unknownAgentCeilingMinor: "not a number",
      velocityMaxIntentsPerHour: null,
      maxNegotiationDiscountBps: {},
    });
    expect(draft.changes).toEqual([]);
    expect(draft.resulting.unknownAgentCeilingMinor).toBe(CURRENT.unknownAgentCeilingMinor);
  });

  it("does not let a negative number become a negative limit", () => {
    const draft = buildPolicyDraft(CURRENT, { unknownAgentCeilingMinor: -5_000_000, velocityMaxIntentsPerHour: -3 });
    expect(draft.resulting.unknownAgentCeilingMinor).toBe(0);
    expect(draft.resulting.velocityMaxIntentsPerHour).toBe(POLICY_AUTHORING_BOUNDS.minVelocityPerHour);
  });

  /** A field nobody mentioned keeps its value. There is no path from a
   * sentence to "reset everything to defaults". */
  it("leaves unmentioned fields exactly as they were", () => {
    const draft = buildPolicyDraft(CURRENT, { unknownAgentCeilingMinor: 1_200_000 });
    expect(draft.resulting.blockedCategories).toEqual(CURRENT.blockedCategories);
    expect(draft.resulting.negotiatorFloorMarginBps).toBe(CURRENT.negotiatorFloorMarginBps);
    expect(draft.resulting.velocityMaxIntentsPerHour).toBe(CURRENT.velocityMaxIntentsPerHour);
  });
});

describe("policy authoring — the merchant sees which way a change points", () => {
  it("flags removing a category block as loosening", () => {
    const draft = buildPolicyDraft(CURRENT, { blockedCategories: [] });
    expect(draft.changes[0]!.loosens).toBe(true);
    expect(draft.loosensAnyGuardrail).toBe(true);
    expect(draft.changes[0]!.effect).toContain("No category is blocked");
  });

  it("does not flag adding a category block as loosening", () => {
    const draft = buildPolicyDraft(CURRENT, { blockedCategories: ["Gift Cards", "Skincare"] });
    expect(draft.changes[0]!.loosens).toBe(false);
  });

  /** A LOWER floor margin is the permissive direction, which is easy to
   * get backwards when every other field's larger number is the risky one. */
  it("treats a lower floor margin as loosening, not tightening", () => {
    const lower = buildPolicyDraft(CURRENT, { negotiatorFloorMarginBps: 500 });
    expect(lower.changes[0]!.loosens).toBe(true);

    const higher = buildPolicyDraft(CURRENT, { negotiatorFloorMarginBps: 3000 });
    expect(higher.changes[0]!.loosens).toBe(false);
  });

  it("gives every change a label and an effect a non-engineer can read", () => {
    const draft = buildPolicyDraft(CURRENT, {
      unknownAgentCeilingMinor: 2_000_000,
      knownAgentCeilingMinor: 4_000_000,
      maxNegotiationDiscountBps: 500,
      negotiatorFloorMarginBps: 2500,
      velocityMaxIntentsPerHour: 30,
      blockedCategories: ["Gift Cards", "Supplements"],
    });
    expect(draft.changes).toHaveLength(6);
    for (const change of draft.changes) {
      expect(change.label.length).toBeGreaterThan(10);
      expect(change.effect.length).toBeGreaterThan(20);
      expect(change.label).not.toMatch(/Minor|Bps/);
    }
  });

  it("explains a switched-off negotiator rather than showing a bare zero", () => {
    const draft = buildPolicyDraft(CURRENT, { maxNegotiationDiscountBps: 0 });
    expect(draft.changes[0]!.effect).toContain("switched off");
  });
});

/**
 * "I did not understand you" and "that is already your policy" are
 * different answers. A caller with only `changes.length` cannot tell them
 * apart, and reporting the first when the second is true makes a working
 * feature look broken.
 */
describe("policy authoring — understood is not the same as changed", () => {
  it("reports a field as matched even when the value is unchanged", () => {
    const draft = buildPolicyDraft(CURRENT, { unknownAgentCeilingMinor: CURRENT.unknownAgentCeilingMinor });
    expect(draft.changes).toEqual([]);
    expect(draft.matchedFields).toEqual(["unknownAgentCeilingMinor"]);
  });

  it("matches nothing when the draft is genuinely empty", () => {
    expect(buildPolicyDraft(CURRENT, {}).matchedFields).toEqual([]);
  });

  it("matches nothing when the model returned only unknown keys", () => {
    expect(buildPolicyDraft(CURRENT, { somethingElse: 5 }).matchedFields).toEqual([]);
  });

  it("matches an unchanged category list too", () => {
    const draft = buildPolicyDraft(CURRENT, { blockedCategories: ["Gift Cards"] });
    expect(draft.changes).toEqual([]);
    expect(draft.matchedFields).toContain("blockedCategories");
  });

  it("matches a field whose value was clamped back to what is already saved", () => {
    const atMax = { ...CURRENT, unknownAgentCeilingMinor: POLICY_AUTHORING_BOUNDS.maxCeilingMinor };
    const draft = buildPolicyDraft(atMax, { unknownAgentCeilingMinor: 999_999_999 });
    expect(draft.changes).toEqual([]);
    expect(draft.matchedFields).toContain("unknownAgentCeilingMinor");
  });
});
