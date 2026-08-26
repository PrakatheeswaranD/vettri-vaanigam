/**
 * Agent Action Ledger status lifecycle (PART 00 §11, §20).
 *
 * Approval is a real domain concept, not a boolean. This enum is shared by
 * the AgentAction persistence model and the future Policy/Approval flow so
 * both stay in lockstep.
 */
export const AGENT_ACTION_STATUSES = [
  "PROPOSED",
  "PENDING_APPROVAL",
  "APPROVED",
  "REJECTED",
  "EXPIRED",
  "EXECUTED",
  "FAILED",
  "VERIFIED",
] as const;

export type AgentActionStatus = (typeof AGENT_ACTION_STATUSES)[number];

/**
 * PART 05 §53 adds `MERCHANT_USER` — the human approver. Note what is
 * deliberately absent: `POLICY_ENGINE` is here because it is deterministic
 * application code emitting an auditable decision, never an AI agent; only
 * `BUYER_AGENT` and `MERCHANT_AGENT` are actual AI actors (PART 00 §6,
 * PART 05 §143).
 */
export const AGENT_ACTOR_TYPES = [
  "BUYER_AGENT",
  "MERCHANT_AGENT",
  "POLICY_ENGINE",
  "MERCHANT_USER",
  "CUSTOMER",
  "SYSTEM",
] as const;
export type AgentActorType = (typeof AGENT_ACTOR_TYPES)[number];

/**
 * PART 05 §54 — closed ledger event-type taxonomy. Not enforced at the
 * database/wire level (existing rows predate this list and `actionType`
 * stays a plain string column so it never has to migrate historical data),
 * but every NEW ledger write in application code should use one of these
 * so the vocabulary stays closed and grep-able in one place rather than
 * accreting ad hoc strings across modules.
 */
export const LEDGER_EVENT_TYPES = [
  "BUYER_INTENT_EXTRACTED",
  "PRODUCTS_DISCOVERED",
  "RECOMMENDATION_PROPOSED",
  "GROWTH_PROPOSAL_CREATED",
  "GROWTH_PROPOSAL_VALIDATION_FAILED",
  "POLICY_EVALUATED",
  "POLICY_ALLOWED",
  "POLICY_DENIED",
  "APPROVAL_REQUESTED",
  "APPROVAL_APPROVED",
  "APPROVAL_REJECTED",
  "APPROVAL_EXPIRED",
  "EXECUTION_AUTHORIZATION_ISSUED",
  "EXECUTION_AUTHORIZATION_DENIED",
  "EXECUTION_AUTHORIZATION_EXPIRED",
  "EXECUTION_AUTHORIZATION_REVOKED",
  "MERCHANT_POLICY_UPDATED",
] as const;
export type LedgerEventType = (typeof LEDGER_EVENT_TYPES)[number];

/**
 * A terminal status. `EXECUTED` is intentionally NOT terminal here: an
 * executed action still awaits verification against provider-confirmed
 * truth (PART 00 §12) before it can be marked `VERIFIED` or `FAILED`.
 */
const TERMINAL_ACTION_STATUSES: ReadonlySet<AgentActionStatus> = new Set([
  "REJECTED",
  "EXPIRED",
  "FAILED",
  "VERIFIED",
]);

export function isTerminalActionStatus(status: AgentActionStatus): boolean {
  return TERMINAL_ACTION_STATUSES.has(status);
}
