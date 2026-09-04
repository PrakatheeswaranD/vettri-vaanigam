import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AgentToolInvocationResultDTO,
  AgentToolsResponseDTO,
  CheckoutResponseDTO,
  CommerceCustomersResponseDTO,
  CommerceExecutionRequestDTO,
  CommerceOrdersResponseDTO,
  CommercePaymentsResponseDTO,
  CommerceProductsResponseDTO,
} from "@razorgrowth/contracts";
import { apiGet, apiPost } from "../lib/api-client";

/* ═══════════════════════════════════════════════════════════════════════
 * Checkout execution — the buyer-facing half of commerce.
 * ══════════════════════════════════════════════════════════════════════ */

export function useExecuteCheckout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: CommerceExecutionRequestDTO) => apiPost<CheckoutResponseDTO>("/commerce/checkout", request),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["ledger"] });
    },
  });
}

/* ═══════════════════════════════════════════════════════════════════════
 * The merchant operational views, and the agent action layer.
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * 🛍 Commerce — the four operational views, and the agent's action layer.
 *
 * Each view is a read model that already carries the Growth findings
 * attached to its rows, so a screen never has to fetch the opportunity
 * engine separately and re-associate the results itself. That association
 * happens once, on the server, from `subjectIds`.
 *
 * Short `staleTime` throughout on purpose: these are operational screens.
 * A payment that has just been reconciled must stop saying "unknown", and
 * a stale row here is worse than a slower page.
 */
const OPERATIONAL_STALE_MS = 15_000;

export function useCommerceProducts() {
  return useQuery({
    queryKey: ["commerce", "products"],
    queryFn: () => apiGet<CommerceProductsResponseDTO>("/commerce/products"),
    staleTime: OPERATIONAL_STALE_MS,
  });
}

export function useCommerceCustomers() {
  return useQuery({
    queryKey: ["commerce", "customers"],
    queryFn: () => apiGet<CommerceCustomersResponseDTO>("/commerce/customers"),
    staleTime: OPERATIONAL_STALE_MS,
  });
}

export function useCommerceOrders() {
  return useQuery({
    queryKey: ["commerce", "orders"],
    queryFn: () => apiGet<CommerceOrdersResponseDTO>("/commerce/orders"),
    staleTime: OPERATIONAL_STALE_MS,
  });
}

export function useCommercePayments() {
  return useQuery({
    queryKey: ["commerce", "payments"],
    queryFn: () => apiGet<CommercePaymentsResponseDTO>("/commerce/payments"),
    staleTime: OPERATIONAL_STALE_MS,
  });
}

/** What the agent can do, as the server declares it. Rarely changes, so it
 * is cached for the session rather than refetched per screen. */
export function useAgentTools() {
  return useQuery({
    queryKey: ["merchant-agent", "tools"],
    queryFn: () => apiGet<AgentToolsResponseDTO>("/merchant-agent/tools"),
    staleTime: 5 * 60_000,
  });
}

/**
 * Ask the agent to run one tool on one row.
 *
 * Invalidates broadly on success, and deliberately so: reconciling a
 * payment changes that payment, its order, and every opportunity derived
 * from either. Refetching only the screen you are standing on is how two
 * tabs come to disagree about the same payment.
 */
export function useRunAgentTool() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ tool, subjectId }: { tool: string; subjectId: string }) =>
      apiPost<AgentToolInvocationResultDTO>(`/merchant-agent/tools/${tool}`, { subjectId }),
    onSuccess: () => {
      for (const key of [
        ["commerce", "payments"],
        ["commerce", "orders"],
        ["commerce", "products"],
        ["commerce", "customers"],
        ["growth", "revenue-opportunities"],
        ["merchant-agent", "status"],
        ["merchant", "commerce-overview"],
      ]) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
  });
}
