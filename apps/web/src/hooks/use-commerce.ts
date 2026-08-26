import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CheckoutResponseDTO, CheckoutSessionDTO, CommerceExecutionRequestDTO, OrderDTO } from "@razorgrowth/contracts";
import { apiGet, apiPost } from "../lib/api-client";

export function useExecuteCheckout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: CommerceExecutionRequestDTO) => apiPost<CheckoutResponseDTO>("/commerce/checkout", request),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["ledger"] });
    },
  });
}

export function useCheckoutSession(id: string | null) {
  return useQuery({
    queryKey: ["commerce", "checkout", id],
    queryFn: () => apiGet<CheckoutSessionDTO>(`/commerce/checkouts/${id}`),
    enabled: Boolean(id),
  });
}

export function useOrder(id: string | null) {
  return useQuery({
    queryKey: ["commerce", "order", id],
    queryFn: () => apiGet<OrderDTO>(`/commerce/orders/${id}`),
    enabled: Boolean(id),
  });
}
