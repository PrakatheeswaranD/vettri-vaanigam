import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AuthorizationResultDTO,
  ExecutionAuthorizationDTO,
  GrowthActionProposalDTO,
  LedgerVerificationResultDTO,
  MerchantPolicyDTO,
  MerchantPolicyUpdateDTO,
  PolicyDecisionDTO,
  WorkflowTraceDTO,
} from "@razorgrowth/contracts";
import { apiGet, apiPatch, apiPost } from "../lib/api-client";
import { growthProposalQueryKey } from "./use-merchant-agent";

export interface PolicyEvaluateResult {
  decision: PolicyDecisionDTO;
  authorization: AuthorizationResultDTO | null;
}

/** PART 05 §34 — evaluates policy for one proposal and, on ALLOW,
 * immediately attempts execution authorization in the same round trip. */
export function useEvaluatePolicy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (proposalId: string) => apiPost<PolicyEvaluateResult>("/policy/evaluate", { proposalId }),
    onSuccess: (_data, proposalId) => {
      void queryClient.invalidateQueries({ queryKey: growthProposalQueryKey(proposalId) });
      void queryClient.invalidateQueries({ queryKey: ["ledger"] });
      void queryClient.invalidateQueries({ queryKey: ["approvals", "pending"] });
    },
  });
}

export interface ApprovalActionResult {
  approval: { id: string; decision: "APPROVED" | "REJECTED"; approverId: string; reason: string | null; expiresAt: string };
  authorization?: AuthorizationResultDTO;
}

export function useApproveProposal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ proposalId, reason }: { proposalId: string; reason?: string }) =>
      apiPost<ApprovalActionResult>(`/approvals/${proposalId}/approve`, reason ? { reason } : {}),
    onSuccess: (_data, { proposalId }) => {
      void queryClient.invalidateQueries({ queryKey: growthProposalQueryKey(proposalId) });
      void queryClient.invalidateQueries({ queryKey: ["ledger"] });
      void queryClient.invalidateQueries({ queryKey: ["approvals", "pending"] });
    },
  });
}

export function useRejectProposal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ proposalId, reason }: { proposalId: string; reason?: string }) =>
      apiPost<ApprovalActionResult>(`/approvals/${proposalId}/reject`, reason ? { reason } : {}),
    onSuccess: (_data, { proposalId }) => {
      void queryClient.invalidateQueries({ queryKey: growthProposalQueryKey(proposalId) });
      void queryClient.invalidateQueries({ queryKey: ["ledger"] });
      void queryClient.invalidateQueries({ queryKey: ["approvals", "pending"] });
    },
  });
}

export interface PendingApprovalItem {
  proposal: GrowthActionProposalDTO;
  policyDecision: PolicyDecisionDTO | null;
}

export function usePendingApprovals() {
  return useQuery({
    queryKey: ["approvals", "pending"],
    queryFn: () => apiGet<{ items: PendingApprovalItem[] }>("/approvals/pending"),
  });
}

/** Manual retry — meaningful only if an earlier automatic issuance attempt
 * (right after ALLOW/approve) failed revalidation (PART 05 §43, §151). */
export function useIssueAuthorization() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (proposalId: string) => apiPost<AuthorizationResultDTO>(`/execution-authorizations/${proposalId}/issue`),
    onSuccess: (_data, proposalId) => {
      void queryClient.invalidateQueries({ queryKey: growthProposalQueryKey(proposalId) });
      void queryClient.invalidateQueries({ queryKey: ["ledger"] });
    },
  });
}

export function useExecutionAuthorization(id: string | null) {
  return useQuery({
    queryKey: ["execution-authorization", id],
    queryFn: () => apiGet<ExecutionAuthorizationDTO>(`/execution-authorizations/${id}`),
    enabled: Boolean(id),
  });
}

export function usePolicyDecision(id: string | null) {
  return useQuery({
    queryKey: ["policy", "decision", id],
    queryFn: () => apiGet<PolicyDecisionDTO>(`/policy/decisions/${id}`),
    enabled: Boolean(id),
  });
}

export function useUpdateMerchantPolicy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (update: MerchantPolicyUpdateDTO) => apiPatch<MerchantPolicyDTO>("/merchant/policy", update),
    onSuccess: (data) => {
      queryClient.setQueryData(["merchant", "policy"], data);
      void queryClient.invalidateQueries({ queryKey: ["ledger"] });
    },
  });
}

export function useWorkflowLedgerVerification(workflowId: string | null) {
  return useQuery({
    queryKey: ["ledger", "verify", workflowId],
    queryFn: () => apiGet<LedgerVerificationResultDTO>(`/action-ledger/workflows/${workflowId}/verify`),
    enabled: Boolean(workflowId),
  });
}

/** PART 09 §60, §118 — the jury/technical-panel-facing financial-outcome
 * aggregate (PART 08's `/trace` endpoint), surfaced alongside the existing
 * integrity indicator so a workflow's PENDING/FAILED/RECOVERED/CAPTURED
 * status is readable without a raw API call. */
export function useWorkflowTrace(workflowId: string | null) {
  return useQuery({
    queryKey: ["ledger", "trace", workflowId],
    queryFn: () => apiGet<WorkflowTraceDTO>(`/action-ledger/workflows/${workflowId}/trace`),
    enabled: Boolean(workflowId),
  });
}
