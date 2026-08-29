/**
 * Trust Trace — a typed, pure transformation layer from the real Agent
 * Action Ledger workflow trace (`GET /action-ledger/workflows/:id/trace`,
 * PART 08) into a small, fixed set of governance-pipeline stages for
 * display. This is a presentation read-model only: it never computes,
 * approves, authorizes, or asserts a financial outcome — every status
 * shown here is derived from ledger events the deterministic backend
 * already persisted. No stage status is ever hardcoded or guessed.
 */
import type { WorkflowTraceDTO, WorkflowTraceStepDTO } from "@razorgrowth/contracts";

export type TrustTraceActorClass = "AI" | "DETERMINISTIC" | "HUMAN" | "PROVIDER";

export type TrustTraceStageStatus = "NOT_REACHED" | "IN_PROGRESS" | "OK" | "ATTENTION" | "FAILED" | "BLOCKED";

export interface TrustTraceStage {
  id: string;
  label: string;
  status: TrustTraceStageStatus;
  actor: string | null;
  actorClass: TrustTraceActorClass | null;
  timestamp: string | null;
  headline: string;
  events: WorkflowTraceStepDTO[];
  isFinancialGate: boolean;
}

export interface TrustTraceModel {
  workflowId: string;
  financialOutcome: WorkflowTraceDTO["financialOutcome"];
  ledgerIntegrity: WorkflowTraceDTO["ledgerIntegrity"];
  startedAt: string | null;
  completedAt: string | null;
  stages: TrustTraceStage[];
  /** Events whose actionType is not in the known taxonomy — surfaced
   * honestly rather than silently dropped (§139 "unknown events"). */
  unrecognizedEvents: WorkflowTraceStepDTO[];
}

type RawGroup = "INTENT" | "PROPOSAL" | "POLICY" | "APPROVAL" | "AUTHORIZATION" | "COMMERCE" | "PAYMENT" | "RECOVERY";

const ACTION_GROUP: Record<string, RawGroup> = {
  BUYER_INTENT_EXTRACTED: "INTENT",
  PRODUCTS_DISCOVERED: "INTENT",
  RECOMMENDATION_PROPOSED: "INTENT",
  GROWTH_PROPOSAL_CREATED: "PROPOSAL",
  GROWTH_PROPOSAL_VALIDATION_FAILED: "PROPOSAL",
  POLICY_ALLOWED: "POLICY",
  POLICY_DENIED: "POLICY",
  POLICY_EVALUATED: "POLICY",
  APPROVAL_REQUESTED: "APPROVAL",
  APPROVAL_APPROVED: "APPROVAL",
  APPROVAL_REJECTED: "APPROVAL",
  EXECUTION_AUTHORIZATION_ISSUED: "AUTHORIZATION",
  EXECUTION_AUTHORIZATION_DENIED: "AUTHORIZATION",
  EXECUTION_AUTHORIZATION_CONSUMED: "AUTHORIZATION",
  AUTHORIZATION_VALIDATED: "AUTHORIZATION",
  COMMERCE_EXECUTION_REQUESTED: "COMMERCE",
  CART_CREATED: "COMMERCE",
  ORDER_CREATED: "COMMERCE",
  CHECKOUT_CREATED: "COMMERCE",
  CHECKOUT_READY_FOR_PAYMENT: "COMMERCE",
  AUTHORIZED_OFFER_APPLIED: "COMMERCE",
  PAYMENT_INITIATION_REQUESTED: "PAYMENT",
  PAYMENT_RECORD_CREATED: "PAYMENT",
  PROVIDER_ORDER_CREATED: "PAYMENT",
  CLIENT_PAYMENT_VERIFICATION_RECEIVED: "PAYMENT",
  CLIENT_PAYMENT_SIGNATURE_VERIFIED: "PAYMENT",
  CLIENT_PAYMENT_SIGNATURE_INVALID: "PAYMENT",
  WEBHOOK_RECEIVED: "PAYMENT",
  WEBHOOK_SIGNATURE_VERIFIED: "PAYMENT",
  PAYMENT_AUTHORIZED: "PAYMENT",
  PAYMENT_CAPTURED: "PAYMENT",
  PAYMENT_FAILED: "PAYMENT",
  PAYMENT_FINANCIAL_INTEGRITY_ERROR: "PAYMENT",
  PAYMENT_STATE_TRANSITION_REJECTED: "PAYMENT",
  PAYMENT_RECONCILED: "PAYMENT",
  RECOVERY_ELIGIBILITY_EVALUATED: "RECOVERY",
  RECOVERY_PROPOSAL_CREATED: "RECOVERY",
  RECOVERY_BLOCKED: "RECOVERY",
  RECOVERY_AUTHORIZATION_CONSUMED: "RECOVERY",
  RECOVERY_ATTEMPT_CREATED: "RECOVERY",
};

const BLOCK_SIGNALS = new Set([
  "GROWTH_PROPOSAL_VALIDATION_FAILED",
  "POLICY_DENIED",
  "APPROVAL_REJECTED",
  "EXECUTION_AUTHORIZATION_DENIED",
  "RECOVERY_BLOCKED",
  "CLIENT_PAYMENT_SIGNATURE_INVALID",
  "PAYMENT_STATE_TRANSITION_REJECTED",
]);
const FAILURE_SIGNALS = new Set(["PAYMENT_FAILED"]);
const ATTENTION_SIGNALS = new Set(["POLICY_EVALUATED", "APPROVAL_REQUESTED", "PAYMENT_FINANCIAL_INTEGRITY_ERROR"]);
/** Explicit terminal-success markers. A stage resolves to OK if ANY of
 * these is present, even if an earlier ATTENTION event (e.g.
 * `APPROVAL_REQUESTED`) also occurred in the same stage — the later,
 * more decisive fact wins over the earlier waiting state. */
const SUCCESS_SIGNALS = new Set([
  "GROWTH_PROPOSAL_CREATED",
  "POLICY_ALLOWED",
  "APPROVAL_APPROVED",
  "EXECUTION_AUTHORIZATION_ISSUED",
  "EXECUTION_AUTHORIZATION_CONSUMED",
  "AUTHORIZATION_VALIDATED",
  "COMMERCE_EXECUTION_REQUESTED",
  "CART_CREATED",
  "ORDER_CREATED",
  "CHECKOUT_CREATED",
  "CHECKOUT_READY_FOR_PAYMENT",
  "AUTHORIZED_OFFER_APPLIED",
  "PAYMENT_CAPTURED",
  "PAYMENT_RECONCILED",
  "RECOVERY_PROPOSAL_CREATED",
  "RECOVERY_AUTHORIZATION_CONSUMED",
  "RECOVERY_ATTEMPT_CREATED",
  "BUYER_INTENT_EXTRACTED",
  "PRODUCTS_DISCOVERED",
  "RECOMMENDATION_PROPOSED",
]);

const ACTOR_CLASS: Record<string, TrustTraceActorClass> = {
  BUYER_AGENT: "AI",
  MERCHANT_AGENT: "AI",
  POLICY_ENGINE: "DETERMINISTIC",
  SYSTEM: "DETERMINISTIC",
  COMMERCE: "DETERMINISTIC",
  PAYMENT_SYSTEM: "DETERMINISTIC",
  RAZORPAY: "PROVIDER",
  MERCHANT_USER: "HUMAN",
  CUSTOMER: "HUMAN",
};

const GROUP_LABEL: Record<RawGroup, string> = {
  INTENT: "Buyer Intent",
  PROPOSAL: "Merchant Proposal",
  POLICY: "Policy Decision",
  APPROVAL: "Human Approval",
  AUTHORIZATION: "Execution Authorization",
  COMMERCE: "Commerce Execution",
  PAYMENT: "Payment Attempt",
  RECOVERY: "Recovery",
};

const FINANCIAL_GATE_GROUPS = new Set<RawGroup>(["POLICY", "APPROVAL", "AUTHORIZATION", "PAYMENT"]);
const FIXED_LEADING_ORDER: RawGroup[] = ["INTENT", "PROPOSAL", "POLICY", "APPROVAL", "AUTHORIZATION", "COMMERCE"];

function deriveStatus(events: WorkflowTraceStepDTO[]): TrustTraceStageStatus {
  if (events.length === 0) return "NOT_REACHED";
  const types = events.map((e) => e.event);
  if (types.some((t) => BLOCK_SIGNALS.has(t))) return "BLOCKED";
  if (types.some((t) => FAILURE_SIGNALS.has(t))) return "FAILED";
  if (types.some((t) => SUCCESS_SIGNALS.has(t))) return "OK";
  if (types.some((t) => ATTENTION_SIGNALS.has(t))) return "ATTENTION";
  return "IN_PROGRESS";
}

/**
 * A stage's actor class normally comes from its last event, but provider
 * evidence outranks that.
 *
 * A payment stage ends on `PAYMENT_CAPTURED` / `PAYMENT_FAILED`, which
 * this system records under `PAYMENT_SYSTEM` because our own code wrote
 * the row. Labelling the stage "Deterministic" on that basis is
 * misleading: the state changed only because a signature-verified
 * provider event arrived earlier in the same stage. The provider is where
 * that stage's TRUTH came from, and saying so is the whole claim — payment
 * state is never something this application decided for itself.
 *
 * So: if any event in a stage came from a provider actor, the stage is
 * PROVIDER.
 */
function deriveActorClass(events: WorkflowTraceStepDTO[]): TrustTraceActorClass | null {
  if (events.some((e) => ACTOR_CLASS[e.actor] === "PROVIDER")) return "PROVIDER";
  const last = events[events.length - 1];
  return last ? (ACTOR_CLASS[last.actor] ?? null) : null;
}

function buildStage(id: string, group: RawGroup, events: WorkflowTraceStepDTO[], label?: string): TrustTraceStage {
  const status = deriveStatus(events);
  const last = events[events.length - 1] ?? null;
  return {
    id,
    label: label ?? GROUP_LABEL[group],
    status,
    actor: last?.actor ?? null,
    actorClass: deriveActorClass(events),
    timestamp: last?.timestamp ?? null,
    headline: last?.conciseReason ?? "This stage was never reached — an earlier stage stopped the chain.",
    events,
    isFinancialGate: FINANCIAL_GATE_GROUPS.has(group),
  };
}

/**
 * Pure transformation: `WorkflowTraceDTO` → an ordered list of governance
 * stages. Payment/Recovery events are segmented into repeatable
 * "Payment Attempt N" / "Recovery" stage instances (never a single fixed
 * bucket), since a real workflow may contain more than one payment
 * attempt (PART 08's bounded recovery).
 */
export function buildTrustTraceModel(trace: WorkflowTraceDTO): TrustTraceModel {
  const byGroup = new Map<RawGroup, WorkflowTraceStepDTO[]>();
  const unrecognizedEvents: WorkflowTraceStepDTO[] = [];
  const paymentRecoverySteps: WorkflowTraceStepDTO[] = [];

  // Defensive: the real API already returns steps ordered by `sequence`,
  // but the payment/recovery segmentation below depends on order, so
  // this transform never trusts caller order silently.
  const orderedSteps = [...trace.steps].sort((a, b) => a.sequence - b.sequence);

  for (const step of orderedSteps) {
    const group = ACTION_GROUP[step.event];
    if (!group) {
      unrecognizedEvents.push(step);
      continue;
    }
    if (group === "PAYMENT" || group === "RECOVERY") {
      paymentRecoverySteps.push(step);
      continue;
    }
    const list = byGroup.get(group) ?? [];
    list.push(step);
    byGroup.set(group, list);
  }

  const stages: TrustTraceStage[] = FIXED_LEADING_ORDER.map((group) => buildStage(group.toLowerCase(), group, byGroup.get(group) ?? []));

  // Segment the trailing payment/recovery events into alternating
  // "Payment Attempt N" / "Recovery" stage instances, in event order.
  let attemptNumber = 0;
  let currentGroup: "PAYMENT" | "RECOVERY" | null = null;
  let currentEvents: WorkflowTraceStepDTO[] = [];
  const flush = () => {
    if (!currentGroup || currentEvents.length === 0) return;
    if (currentGroup === "PAYMENT") {
      attemptNumber += 1;
      stages.push(buildStage(`payment-${attemptNumber}`, "PAYMENT", currentEvents, `Payment Attempt ${attemptNumber}`));
    } else {
      stages.push(buildStage(`recovery-${attemptNumber}`, "RECOVERY", currentEvents));
    }
    currentEvents = [];
  };

  for (const step of paymentRecoverySteps) {
    const group = ACTION_GROUP[step.event] as "PAYMENT" | "RECOVERY";
    if (currentGroup !== null && group !== currentGroup) flush();
    currentGroup = group;
    currentEvents.push(step);
  }
  flush();

  return {
    workflowId: trace.workflowId,
    financialOutcome: trace.financialOutcome,
    ledgerIntegrity: trace.ledgerIntegrity,
    startedAt: trace.startedAt,
    completedAt: trace.completedAt,
    stages,
    unrecognizedEvents,
  };
}
