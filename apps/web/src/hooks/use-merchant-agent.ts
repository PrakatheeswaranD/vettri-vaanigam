import { useMutation, useQuery } from "@tanstack/react-query";
import type { GrowthActionProposalDTO, MerchantGrowthConfigDTO } from "@razorgrowth/contracts";
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
