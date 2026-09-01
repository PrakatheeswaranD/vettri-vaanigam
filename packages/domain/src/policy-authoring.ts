/**
 * Natural-language policy authoring — the model drafts, code bounds it, a
 * human applies it.
 *
 * WHY THIS IS THE RISKIEST LLM CALL IN THE PRODUCT
 *
 * Everywhere else, a model influences ONE transaction and a deterministic
 * gate stands behind it. Here the model is writing the gate. A prompt
 * injection that raises `unknownAgentCeilingMinor` to ₹10,00,000 does not
 * affect one order — it affects every order afterwards, silently, and the
 * merchant sees nothing unusual because the system is behaving exactly as
 * configured.
 *
 * So this module exists to make sure the model's output is never a
 * configuration. It is a PROPOSAL: parsed into known fields, clamped to
 * bounds a human set, diffed field by field, and applied only by an
 * explicit authenticated act. The same shape as the rest of the product —
 * AI proposes, deterministic code bounds, a human decides.
 *
 * THREE THINGS THIS REFUSES TO DO
 *
 * 1. It will not invent a field. Anything outside the known policy keys is
 *    dropped and reported as ignored, not silently merged.
 *
 * 2. It will not exceed `POLICY_AUTHORING_BOUNDS`. A model asked to "let
 *    agents spend whatever they want" produces a clamped number and a
 *    visible note saying it was clamped — never the number it asked for.
 *
 * 3. It will not loosen a guardrail by omission. A field the model did not
 *    mention keeps its current value; there is no "reset to default"
 *    reachable from a sentence.
 *
 * Pure: no database, no model, no I/O. The model call lives in the API
 * layer; everything that decides what a draft MEANS lives here, where it
 * can be tested without one.
 */
import type { AgentGatewayPolicy } from "./agent-gateway-policy.js";
import type { CurrencyCode } from "./money.js";

/**
 * Hard bounds on anything a sentence can produce.
 *
 * These are not the merchant's policy — they are the outer edge of what
 * ANY merchant may reach through this authoring path. A merchant who
 * genuinely wants a ₹50,00,000 automatic ceiling can still set it in the
 * form; they just cannot get there by asking a language model nicely.
 */
export const POLICY_AUTHORING_BOUNDS = {
  /** ₹5,00,000. Above this, a human types the number themselves. */
  maxCeilingMinor: 50_000_000,
  minCeilingMinor: 0,
  /** 50%. A model that proposes more is clamped and reported. */
  maxNegotiationDiscountBps: 5000,
  /** Refusing to sell below cost is not negotiable from a prompt. */
  minFloorMarginBps: 0,
  maxFloorMarginBps: 9000,
  maxVelocityPerHour: 1000,
  minVelocityPerHour: 1,
  maxBlockedCategories: 50,
} as const;

/** The subset of policy a sentence is allowed to touch. */
export const AUTHORABLE_POLICY_FIELDS = [
  "unknownAgentCeilingMinor",
  "knownAgentCeilingMinor",
  "blockedCategories",
  "maxNegotiationDiscountBps",
  "negotiatorFloorMarginBps",
  "velocityMaxIntentsPerHour",
] as const;

export type AuthorablePolicyField = (typeof AUTHORABLE_POLICY_FIELDS)[number];

/**
 * `allowFirstUseKeyPinning` is deliberately absent from the list above.
 *
 * It is the one setting whose "on" state weakens an authenticity
 * guarantee rather than a spending limit, and it is exactly what a
 * prompt-injection attack would want turned on. Reaching it requires the
 * explicit form, where the copy explains what trust-on-first-use does and
 * does not give you.
 */
export const DELIBERATELY_UNAUTHORABLE_FIELDS = ["allowFirstUseKeyPinning", "policyVersion", "currency"] as const;

/** What the model returned, before anything trusts it. */
export interface RawPolicyDraft {
  unknownAgentCeilingMinor?: unknown;
  knownAgentCeilingMinor?: unknown;
  blockedCategories?: unknown;
  maxNegotiationDiscountBps?: unknown;
  negotiatorFloorMarginBps?: unknown;
  velocityMaxIntentsPerHour?: unknown;
  [key: string]: unknown;
}

export interface PolicyFieldChange {
  field: AuthorablePolicyField;
  /** Human label, for a merchant reading a diff rather than a schema. */
  label: string;
  before: number | string[];
  after: number | string[];
  /** Set when the requested value was reduced to a safe bound. */
  clampedFrom: number | null;
  /** Plain English: what this change means for the merchant's business. */
  effect: string;
  /** True when this change makes the gate MORE permissive. */
  loosens: boolean;
}

export interface PolicyDraftResult {
  changes: PolicyFieldChange[];
  /**
   * Known fields the draft actually named, whether or not the value
   * differed from what is already saved.
   *
   * Separate from `changes` because "I could not understand you" and
   * "that is already your policy" are completely different answers, and a
   * caller with only `changes.length` cannot tell them apart. Reporting
   * the first when the second is true makes a working feature look broken.
   */
  matchedFields: AuthorablePolicyField[];
  /** Keys the model returned that this system does not accept. Reported
   * rather than dropped in silence — an integrator needs to know their
   * sentence went nowhere. */
  ignoredFields: string[];
  /** Set when the draft would have exceeded a hard bound. */
  clampNotes: string[];
  /** True when any change widens what agents may do without a human. */
  loosensAnyGuardrail: boolean;
  /** The full policy that WOULD apply. Never saved by this function. */
  resulting: AgentGatewayPolicy;
}

const FIELD_LABELS: Record<AuthorablePolicyField, string> = {
  unknownAgentCeilingMinor: "Automatic limit — agents you have not sold to before",
  knownAgentCeilingMinor: "Automatic limit — agents with a settled order",
  blockedCategories: "Categories agents may never buy automatically",
  maxNegotiationDiscountBps: "Largest discount the negotiator may ever offer",
  negotiatorFloorMarginBps: "Floor margin an offer may not breach",
  velocityMaxIntentsPerHour: "Purchase attempts allowed per agent per hour",
};

function rupees(minor: number): string {
  return `₹${(minor / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function clampInt(value: number, min: number, max: number): { value: number; clamped: boolean } {
  const rounded = Math.round(value);
  const bounded = Math.min(max, Math.max(min, rounded));
  return { value: bounded, clamped: bounded !== rounded };
}

/** A finite, non-negative number, or null for anything else. */
function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const strings = value.filter((v): v is string => typeof v === "string" && v.trim().length > 0).map((v) => v.trim());
  return strings.slice(0, POLICY_AUTHORING_BOUNDS.maxBlockedCategories);
}

function sameCategories(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].map((s) => s.toLowerCase()).sort();
  const right = [...b].map((s) => s.toLowerCase()).sort();
  return left.every((value, index) => value === right[index]);
}

/**
 * Turns a raw model draft into a bounded, explained diff.
 *
 * Never mutates `current`, never returns anything outside the bounds, and
 * never saves. The caller shows the result to a human.
 */
export function buildPolicyDraft(current: AgentGatewayPolicy, raw: RawPolicyDraft): PolicyDraftResult {
  const changes: PolicyFieldChange[] = [];
  const clampNotes: string[] = [];
  const matchedFields: AuthorablePolicyField[] = [];

  const known = new Set<string>([...AUTHORABLE_POLICY_FIELDS]);
  const ignoredFields = Object.keys(raw ?? {}).filter((key) => !known.has(key) && raw[key] !== undefined);

  const resulting: AgentGatewayPolicy = { ...current };

  function numericChange(
    field: Exclude<AuthorablePolicyField, "blockedCategories">,
    min: number,
    max: number,
    describe: (value: number) => string,
    loosensWhen: (before: number, after: number) => boolean,
    format: (value: number) => string,
  ) {
    const proposed = asNumber(raw[field]);
    if (proposed === null) return;

    // Understood, even if it turns out to change nothing.
    matchedFields.push(field);

    const { value, clamped } = clampInt(proposed, min, max);
    const before = current[field];
    if (value === before) return;

    if (clamped) {
      clampNotes.push(
        `${FIELD_LABELS[field]}: asked for ${format(Math.round(proposed))}, reduced to the ${format(value)} maximum this authoring path allows.`,
      );
    }

    resulting[field] = value;
    changes.push({
      field,
      label: FIELD_LABELS[field],
      before,
      after: value,
      clampedFrom: clamped ? Math.round(proposed) : null,
      effect: describe(value),
      loosens: loosensWhen(before, value),
    });
  }

  numericChange(
    "unknownAgentCeilingMinor",
    POLICY_AUTHORING_BOUNDS.minCeilingMinor,
    POLICY_AUTHORING_BOUNDS.maxCeilingMinor,
    (v) => `An agent you have never sold to can spend up to ${rupees(v)} without asking you. Anything above comes to you for approval.`,
    (before, after) => after > before,
    rupees,
  );

  numericChange(
    "knownAgentCeilingMinor",
    POLICY_AUTHORING_BOUNDS.minCeilingMinor,
    POLICY_AUTHORING_BOUNDS.maxCeilingMinor,
    (v) => `An agent with a settled order can spend up to ${rupees(v)} without asking you.`,
    (before, after) => after > before,
    rupees,
  );

  numericChange(
    "maxNegotiationDiscountBps",
    0,
    POLICY_AUTHORING_BOUNDS.maxNegotiationDiscountBps,
    (v) =>
      v === 0
        ? "The negotiator is switched off. No automatic discount will ever be offered."
        : `The negotiator may offer at most ${v / 100}% off, enforced in code whatever the model proposes.`,
    (before, after) => after > before,
    (v) => `${v / 100}%`,
  );

  numericChange(
    "negotiatorFloorMarginBps",
    POLICY_AUTHORING_BOUNDS.minFloorMarginBps,
    POLICY_AUTHORING_BOUNDS.maxFloorMarginBps,
    (v) => `An offer that would take a basket below ${v / 100}% margin is refused outright, not reduced.`,
    // A LOWER floor is the permissive direction here.
    (before, after) => after < before,
    (v) => `${v / 100}%`,
  );

  numericChange(
    "velocityMaxIntentsPerHour",
    POLICY_AUTHORING_BOUNDS.minVelocityPerHour,
    POLICY_AUTHORING_BOUNDS.maxVelocityPerHour,
    (v) => `One agent may attempt ${v} purchases an hour before further attempts are refused.`,
    (before, after) => after > before,
    (v) => `${v}/hour`,
  );

  const categories = asStringArray(raw.blockedCategories);
  if (categories !== null) matchedFields.push("blockedCategories");
  if (categories !== null && !sameCategories(categories, current.blockedCategories)) {
    const removed = current.blockedCategories.filter(
      (c) => !categories.some((n) => n.toLowerCase() === c.toLowerCase()),
    );
    resulting.blockedCategories = categories;
    changes.push({
      field: "blockedCategories",
      label: FIELD_LABELS.blockedCategories,
      before: current.blockedCategories,
      after: categories,
      clampedFrom: null,
      effect:
        categories.length === 0
          ? "No category is blocked. Agents may buy anything in your catalogue automatically, subject to the limits above."
          : `Agents may never buy ${categories.join(", ")} automatically, at any value.`,
      // Removing a block is the permissive direction; adding one is not.
      loosens: removed.length > 0,
    });
  }

  return {
    changes,
    matchedFields,
    ignoredFields,
    clampNotes,
    loosensAnyGuardrail: changes.some((c) => c.loosens),
    resulting,
  };
}

/** A currency is never authorable; this keeps the type honest. */
export function draftPreservesCurrency(current: CurrencyCode, resulting: AgentGatewayPolicy): boolean {
  return resulting.currency === current;
}
