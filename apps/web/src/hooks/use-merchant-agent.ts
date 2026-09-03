import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AgentRunResultDTO, AgentStatusDTO, GrowthActionProposalDTO, MerchantGrowthConfigDTO } from "@razorgrowth/contracts";
import { apiGet, apiPost } from "../lib/api-client";

/** Query key shared with the PART 05 policy/approval/authorization
 * mutations (`use-policy.ts`) so they can invalidate exactly this
 * proposal's cached read after evaluating/approving/rejecting it. */
export function growthProposalQueryKey(proposalId: string) {
  return ["merchant-agent", "growth-proposal", proposalId] as const;
}

export function useGrowthProposal(proposalId: string, initialData?: GrowthActionProposalDTO) {
  return useQuery({
    queryKey: growthProposalQueryKey(proposalId),
    queryFn: () => apiGet<GrowthActionProposalDTO>(`/merchant-agent/growth/proposals/${proposalId}`),
    initialData,
    enabled: Boolean(proposalId),
  });
}

export function useGrowthConfig() {
  return useQuery({
    queryKey: ["merchant-agent", "growth-config"],
    queryFn: () => apiGet<MerchantGrowthConfigDTO>("/merchant-agent/growth/config"),
  });
}

export interface ProposeGrowthActionParams {
  primaryProductId: string;
  conversationId?: string;
  recommendationId?: string;
}

export function useProposeGrowthAction() {
  return useMutation({
    mutationFn: (params: ProposeGrowthActionParams | string) =>
      apiPost<GrowthActionProposalDTO>(
        "/merchant-agent/growth/proposals",
        typeof params === "string" ? { primaryProductId: params } : params,
      ),
  });
}

/**
 * The agent's operating state, and the control that makes it act.
 *
 * `useAgentStatus` is a pure read model over proposals, ledger entries and
 * payments — safe to poll, creates nothing.
 *
 * `useRunAgentCycle` is the opposite: it detects, proposes, applies policy
 * and — inside the merchant's own automatic-approval limits — executes.
 * It is a mutation for that reason, and every query the cycle can change
 * is invalidated on success rather than left showing the state from
 * before the agent acted.
 */
export function useAgentStatus() {
  return useQuery({
    queryKey: ["merchant-agent", "status"],
    queryFn: () => apiGet<AgentStatusDTO>("/merchant-agent/status"),
  });
}

export function useRunAgentCycle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost<AgentRunResultDTO>("/merchant-agent/run"),
    onSuccess: () => {
      for (const key of [
        ["merchant-agent", "status"],
        ["growth", "revenue-opportunities"],
        ["growth", "summary"],
        ["approvals", "pending"],
        ["ledger"],
      ]) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
  });
}
