import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AgentActionDTO,
  AgentReadableProductDTO,
  CatalogQualitySummaryDTO,
  ConnectedSystemsDTO,
  GrowthSummaryDTO,
  MerchantDTO,
  MerchantPolicyDTO,
  MarketplaceDiscoveryResponseDTO,
  BuyerSpendingPolicyDTO,
  BuyerSpendingPolicyUpdateDTO,
  PaginationMetaDTO,
  ProductDTO,
  ProductSummaryDTO,
  ReadinessAssessmentResponseDTO,
  ReadinessSnapshotDTO,
  SystemCapabilitiesDTO,
  TransactionDTO,
} from "@razorgrowth/contracts";
import { apiGet, apiPost, apiPut, type QueryParams } from "../lib/api-client";

interface Paginated<T> {
  items: T[];
  pagination: PaginationMetaDTO;
}

export function useMerchant(enabled = true) {
  return useQuery({
    queryKey: ["merchant"],
    queryFn: () => apiGet<MerchantDTO>("/merchant"),
    enabled,
  });
}

export function useMerchantPolicy() {
  return useQuery({
    queryKey: ["merchant", "policy"],
    queryFn: () => apiGet<MerchantPolicyDTO>("/merchant/policy"),
  });
}

export interface CatalogFilters {
  page?: number;
  limit?: number;
  category?: string;
  search?: string;
  minPriceMinor?: number;
  maxPriceMinor?: number;
  availability?: string;
}

export function useCatalog(params: CatalogFilters = {}) {
  return useQuery({
    queryKey: ["catalog", "products", params],
    queryFn: () => apiGet<Paginated<ProductSummaryDTO>>("/catalog/products", params as QueryParams),
    placeholderData: (prev) => prev,
  });
}

export function useCatalogCategories() {
  return useQuery({
    queryKey: ["catalog", "categories"],
    queryFn: () => apiGet<{ items: string[] }>("/catalog/categories"),
  });
}

/**
 * `limitPerMerchant` defaults to 10 server-side. The discovery screen was
 * taking that default and labelling the result "Products normalized",
 * which described a 25-product catalogue as a 10-product one. It asks for
 * the server's maximum, and the response now also carries the real total
 * so the screen can say when it is showing a subset.
 */
export function useMarketplaceDiscovery(filters: { category?: string; search?: string } = {}) {
  const { category, search } = filters;
  return useQuery({
    queryKey: ["marketplace", "discovery", category ?? null, search ?? null],
    queryFn: () =>
      apiGet<MarketplaceDiscoveryResponseDTO>("/marketplace/discovery", {
        limitPerMerchant: "20",
        ...(category ? { category } : {}),
        ...(search ? { search } : {}),
      }),
    // A filter change should redraw the table, not blank it: keeping the
    // previous rows on screen while the next set loads is the difference
    // between a filter and a page reload.
    placeholderData: (previous) => previous,
  });
}

export function useBuyerSpendingPolicy() {
  return useQuery({ queryKey: ["buyer", "policy"], queryFn: () => apiGet<BuyerSpendingPolicyDTO>("/buyer/policy") });
}

export function useUpdateBuyerSpendingPolicy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: BuyerSpendingPolicyUpdateDTO) => apiPut<BuyerSpendingPolicyDTO>("/buyer/policy", body),
    onSuccess: (data) => queryClient.setQueryData(["buyer", "policy"], data),
  });
}

export function useCatalogQualitySummary() {
  return useQuery({
    queryKey: ["catalog", "quality-summary"],
    queryFn: () => apiGet<CatalogQualitySummaryDTO>("/catalog/quality-summary"),
  });
}

export function useProduct(productId: string | undefined) {
  return useQuery({
    queryKey: ["catalog", "products", productId],
    queryFn: () => apiGet<ProductDTO>(`/catalog/products/${productId}`),
    enabled: Boolean(productId),
  });
}

export function useAgentProduct(productId: string | undefined) {
  return useQuery({
    queryKey: ["agent-commerce", "catalog", productId],
    queryFn: () => apiGet<AgentReadableProductDTO>(`/agent-commerce/catalog/${productId}`),
    enabled: Boolean(productId),
  });
}

export function useReadinessLatest() {
  return useQuery({
    queryKey: ["readiness", "latest"],
    queryFn: () => apiGet<ReadinessAssessmentResponseDTO>("/readiness/latest"),
    retry: false,
  });
}

export function useReadinessHistory(limit = 10) {
  return useQuery({
    queryKey: ["readiness", "history", limit],
    queryFn: () => apiGet<{ items: ReadinessSnapshotDTO[] }>("/readiness/history", { limit }),
  });
}

/** PART 02 §70, §102 — deterministic recalculation, disabled while
 * in-flight to prevent duplicate-click snapshot spam. */
export function useRecalculateReadiness() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost<ReadinessAssessmentResponseDTO>("/readiness/recalculate"),
    onSuccess: (data) => {
      queryClient.setQueryData(["readiness", "latest"], data);
      void queryClient.invalidateQueries({ queryKey: ["readiness", "history"] });
      void queryClient.invalidateQueries({ queryKey: ["ledger"] });
    },
  });
}

export function useLedger(
  params: { page?: number; limit?: number; actorType?: string; status?: string; workflowId?: string } = {},
) {
  return useQuery({
    queryKey: ["ledger", params],
    queryFn: () => apiGet<Paginated<AgentActionDTO>>("/ledger", params as QueryParams),
    placeholderData: (prev) => prev,
  });
}

export function useGrowthSummary() {
  return useQuery({
    queryKey: ["growth", "summary"],
    queryFn: () => apiGet<GrowthSummaryDTO>("/growth/summary"),
  });
}

export function useSystemCapabilities() {
  return useQuery({
    queryKey: ["system", "capabilities"],
    queryFn: () => apiGet<SystemCapabilitiesDTO>("/system/capabilities"),
  });
}

export function useConnectedSystems() {
  return useQuery({
    queryKey: ["system", "connected-systems"],
    queryFn: () => apiGet<ConnectedSystemsDTO>("/system/connected-systems"),
  });
}

export function useTransactions(params: { page?: number; limit?: number } = {}) {
  return useQuery({
    queryKey: ["transactions", params],
    queryFn: () => apiGet<Paginated<TransactionDTO>>("/transactions", params as QueryParams),
    placeholderData: (prev) => prev,
  });
}
