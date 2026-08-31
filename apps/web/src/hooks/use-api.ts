import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AgentActionDTO,
  AgentReadableProductDTO,
  CatalogQualitySummaryDTO,
  ConnectedSystemsDTO,
  GrowthOpportunityDTO,
  GrowthSummaryDTO,
  MerchantDTO,
  MerchantPolicyDTO,
  MerchantStatsDTO,
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

export function useMerchantStats() {
  return useQuery({
    queryKey: ["merchant", "stats"],
    queryFn: () => apiGet<MerchantStatsDTO>("/merchant/stats"),
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

export function useMarketplaceDiscovery(category?: string) {
  return useQuery({
    queryKey: ["marketplace", "discovery", category],
    queryFn: () => apiGet<MarketplaceDiscoveryResponseDTO>("/marketplace/discovery", category ? { category } : undefined),
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

export function useGrowthOpportunities() {
  return useQuery({
    queryKey: ["growth", "opportunities"],
    queryFn: () => apiGet<{ items: GrowthOpportunityDTO[] }>("/growth/opportunities"),
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
