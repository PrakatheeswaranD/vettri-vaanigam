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
