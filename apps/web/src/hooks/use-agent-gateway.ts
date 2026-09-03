import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, apiPut } from "../lib/api-client";

export interface GatewayPolicy {
  merchantId: string;
  policyVersion: number;
  /** Absent on a saved policy; false only on the synthesised defaults, so
   * the console can say "defaults in force" rather than implying the
   * merchant chose these numbers. */
  configured?: boolean;
  currency: string;
  unknownAgentCeilingMinor: number;
  knownAgentCeilingMinor: number;
  blockedCategories: string[];
  maxNegotiationDiscountBps: number;
  negotiatorMinBundleItems: number;
  negotiatorFloorMarginBps: number;
  velocityMaxIntentsPerHour: number;
}

export interface DecisionMetrics {
  totalDecisions: number;
  autoApprovalRatePct: number | null;
  medianDecisionLatencyMs: number | null;
  decisionsWithWrittenReasonPct: number | null;
  negotiatorAovLiftPct: number | null;
  basis: string;
}

export interface DecisionLogEntry {
  id: string;
  outcome: "AUTO_APPROVE" | "STEP_UP" | "DECLINE";
  reasonCode: string;
  explanation: string;
  protocol: string | null;
  externalAgentId: string | null;
  agentTrust: string | null;
  computedTotalMinor: number | null;
  claimedTotalMinor: number | null;
  appliedCeilingMinor: number | null;
  currency: string | null;
  stepUpPaymentLinkUrl: string | null;
  providerOrderId: string | null;
  negotiatedDiscountBps: number | null;
  rawProtocolPayload: unknown;
  protocolActorRef: string | null;
  permissionType: string | null;
  buyerEmail: string | null;
  decisionLatencyMs: number;
  createdAt: string;
}

export function useGatewayPolicy() {
  return useQuery({
    queryKey: ["agent-gateway", "policy"],
    queryFn: () => apiGet<GatewayPolicy>("/agent-gateway/policy"),
  });
}

export function useSaveGatewayPolicy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: Omit<GatewayPolicy, "merchantId" | "policyVersion" | "currency" | "configured">) =>
      apiPut<GatewayPolicy>("/agent-gateway/policy", body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["agent-gateway"] });
    },
  });
}

export interface RunDemoResult {
  ok: boolean;
  exitCode: number | null;
  durationMs: number;
  output: string;
  error: string | null;
}

/** Fires the five scripted intents so a jury watches the log fill in live
 * (TECH_SPEC §8) rather than reading a screenshot. */
export function useRunDemo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost<RunDemoResult>("/agent-gateway/run-demo", {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["agent-gateway"] });
    },
  });
}

export function useGatewayMetrics() {
  return useQuery({
    queryKey: ["agent-gateway", "metrics"],
    queryFn: () => apiGet<DecisionMetrics>("/agent-gateway/metrics"),
    // Decisions arrive from outside agents, not from anything this console
    // did, so it has to poll to stay current during a live demo.
    refetchInterval: 5000,
  });
}

export function useDecisionLog(outcome?: DecisionLogEntry["outcome"]) {
  return useQuery({
    queryKey: ["agent-gateway", "decisions", outcome ?? "all"],
    queryFn: () =>
      apiGet<{ items: DecisionLogEntry[] }>(`/agent-gateway/decisions?limit=50${outcome ? `&outcome=${outcome}` : ""}`),
    refetchInterval: 5000,
  });
}

// ── Adaptive agent trust (FEATURES_1.md §A) ──────────────────────────

export interface EnrolledAgentRow {
  id: string;
  externalAgentId: string;
  displayName: string | null;
  hasRegisteredKey: boolean;
  keyTrustSource: string | null;
  hasActiveCredential: boolean;
  settledOrderCount: number;
  lastSeenAt: string;
  /** Null on an agent the server could not score. Never faked as 50. */
  trustScore: number | null;
  trustBand: "UNTRUSTED" | "PROVISIONAL" | "ESTABLISHED" | "TRUSTED" | null;
  trustExplanation: string | null;
  effectiveCeilingMinor: number | null;
  trustCeilingEarned: boolean;
  trustCeilingCollapsed: boolean;
  declineCount: number;
  flaggedAttackCount: number;
}

export function useEnrolledAgents() {
  return useQuery({
    queryKey: ["agent-gateway", "agents"],
    queryFn: () => apiGet<{ items: EnrolledAgentRow[] }>("/agent-gateway/agents"),
    // The score moves when outside agents transact, not when this console
    // does anything, so it has to poll to be watchable during a demo.
    refetchInterval: 5000,
  });
}

// ── Red-team agent (FEATURES_1.md §B) ────────────────────────────────

export interface RedTeamResult {
  allDefencesHeld: boolean;
  exitCode: number | null;
  durationMs: number;
  defences: { name: string; held: boolean }[];
  output: string;
  error: string | null;
}

/** Turns an adversary loose on this merchant's own gateway, live. */
export function useRunRedTeam() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost<RedTeamResult>("/agent-gateway/run-redteam", {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["agent-gateway"] });
    },
  });
}

// ── Natural-language policy authoring (FEATURES_1.md §C) ─────────────

export interface PolicyFieldChange {
  field: string;
  label: string;
  before: number | string[];
  after: number | string[];
  clampedFrom: number | null;
  effect: string;
  loosens: boolean;
}

export interface PolicyDraft {
  instruction: string;
  modelMode: string;
  current: GatewayPolicy;
  proposed: GatewayPolicy;
  changes: PolicyFieldChange[];
  ignoredFields: string[];
  clampNotes: string[];
  loosensAnyGuardrail: boolean;
  /** Fields the draft understood, even where the value was unchanged.
   * Lets the UI tell "already your policy" apart from "not understood". */
  matchedFields: string[];
  /** Always false. The draft endpoint writes nothing, by design. */
  applied: boolean;
  note: string;
}

/**
 * Drafts a policy change from a sentence.
 *
 * A mutation rather than a query because it costs a model call and must
 * only run when a merchant asks — but it is READ-ONLY on the server. The
 * separate save is what applies it.
 */
export function useDraftPolicy() {
  return useMutation({
    mutationFn: (instruction: string) => apiPost<PolicyDraft>("/agent-gateway/policy/draft", { instruction }),
  });
}

/**
 * The queue of orders the gateway refused to auto-approve and handed to a
 * human, and the act of deciding one.
 *
 * `GET /agent-gateway/step-ups` and `POST /agent-gateway/decisions/:id/decide`
 * were both implemented, RBAC-gated and tested, and neither was reachable
 * from anywhere in the console. The single most important moment in a
 * governed agentic purchase — a person deciding an order an agent was not
 * trusted to place alone — could only be performed with curl.
 */
export interface PendingStepUp {
  id: string;
  externalAgentId: string | null;
  protocol: string | null;
  computedTotalMinor: number | null;
  currency: string | null;
  appliedCeilingMinor: number | null;
  reasonCode: string;
  explanation: string;
  createdAt: string;
}

export function usePendingStepUps() {
  return useQuery({
    queryKey: ["agent-gateway", "step-ups"],
    queryFn: () => apiGet<{ items: PendingStepUp[] }>("/agent-gateway/step-ups"),
  });
}

export function useDecideStepUp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { decisionId: string; decision: "APPROVED" | "REJECTED"; note?: string }) =>
      apiPost<{ id: string; stepUpStatus: string }>(`/agent-gateway/decisions/${params.decisionId}/decide`, {
        decision: params.decision,
        ...(params.note ? { note: params.note } : {}),
      }),
    onSuccess: () => {
      // The decision changes both the queue and the decision log beneath
      // it, so both are refetched rather than leaving the log showing a
      // step-up that has just been resolved.
      void queryClient.invalidateQueries({ queryKey: ["agent-gateway", "step-ups"] });
      void queryClient.invalidateQueries({ queryKey: ["agent-gateway", "decisions"] });
      void queryClient.invalidateQueries({ queryKey: ["agent-gateway", "metrics"] });
    },
  });
}
