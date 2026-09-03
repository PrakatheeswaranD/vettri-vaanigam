import { useQuery } from "@tanstack/react-query";
import type { RevenueOpportunityReportDTO } from "@razorgrowth/contracts";
import { apiGet } from "../lib/api-client";

/**
 * The Revenue Opportunity Engine's report.
 *
 * Computed server-side from current rows on every read, so it is never
 * cached long: an opportunity that has just been acted on should stop
 * being offered, and a stale card that still says "recover this payment"
 * after the payment was recovered is worse than a slower page.
 */
export function useRevenueOpportunities() {
  return useQuery({
    queryKey: ["growth", "revenue-opportunities"],
    queryFn: () => apiGet<RevenueOpportunityReportDTO>("/growth/revenue-opportunities"),
    staleTime: 30_000,
  });
}
