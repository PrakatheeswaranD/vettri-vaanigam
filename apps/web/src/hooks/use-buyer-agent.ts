import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BuyerAgentResponseDTO, BuyerConversationDTO } from "@razorgrowth/contracts";
import { apiGet, apiPost } from "../lib/api-client";

export function useSendBuyerMessage() {
  return useMutation({
    mutationFn: (params: { conversationId?: string; message: string }) =>
      apiPost<BuyerAgentResponseDTO>("/buyer-agent/messages", params),
  });
}

export function useBuyerConversation(conversationId: string | undefined) {
  return useQuery({
    queryKey: ["buyer-agent", "conversation", conversationId],
    queryFn: () => apiGet<BuyerConversationDTO>(`/buyer-agent/conversations/${conversationId}`),
    enabled: Boolean(conversationId),
  });
}

export function useResetBuyerConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (conversationId: string) => apiPost<void>(`/buyer-agent/conversations/${conversationId}/reset`),
    onSuccess: (_data, conversationId) => {
      void queryClient.invalidateQueries({ queryKey: ["buyer-agent", "conversation", conversationId] });
    },
  });
}
