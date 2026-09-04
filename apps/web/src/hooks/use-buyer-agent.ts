import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { BuyerAgentResponseDTO } from "@razorgrowth/contracts";
import { apiPost } from "../lib/api-client";

/**
 * The Buyer Agent lives entirely under `/buyer/`.
 *
 * This used to pick between `/buyer/marketplace/messages` and
 * `/buyer-agent/messages` by role. They were the same handler, and the
 * second one was refused for every role — so the branch's only real effect
 * was that anyone who was not a customer got a 403 out of a chat box. The
 * Buyer Agent is a shopper's tool; there is one endpoint and no branch.
 */
export function useSendBuyerMessage() {
  return useMutation({
    mutationFn: (params: { conversationId?: string; message: string }) =>
      apiPost<BuyerAgentResponseDTO>("/buyer/messages", params),
  });
}

export function useResetBuyerConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (conversationId: string) => apiPost<void>(`/buyer/conversations/${conversationId}/reset`),
    onSuccess: (_data, conversationId) => {
      void queryClient.invalidateQueries({ queryKey: ["buyer-agent", "conversation", conversationId] });
    },
  });
}
