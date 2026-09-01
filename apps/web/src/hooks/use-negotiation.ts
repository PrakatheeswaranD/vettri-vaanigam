import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost } from "../lib/api-client";

/** What a shopper's own settled history has earned them. */
export interface BuyerStanding {
  tier: "NEW" | "RETURNING" | "LOYAL" | "VIP";
  earnedDiscountBps: number;
  effectiveOrders: number;
  ordersToNextTier: number | null;
  explanation: string;
  settledOrders: number;
  lifetimeSpendMinor: number;
  disputedOrders: number;
  /** The merchant's line, so the UI can show it rather than have the
   * shopper discover it by being refused. */
  autoApplyCeilingBps: number;
  maxNegotiableDiscountBps: number;
  maxAutoApplyDiscountMinor: number;
  automationEnabled: boolean;
  currency: string;
}

export interface NegotiationResult {
  proposalId: string;
  outcome: "AUTO_APPLIED" | "PROPOSED_TO_MERCHANT" | "DECLINED";
  reasonCode: string;
  explanation: string;
  requestedDiscountBps: number | null;
  appliedDiscountBps: number;
  appliedDiscountMinor: number;
  originalTotalMinor: number;
  finalTotalMinor: number;
  counterOfferBps: number;
  counterOfferMinor: number;
  cappedByAmount: boolean;
  standing: Pick<BuyerStanding, "tier" | "earnedDiscountBps" | "explanation">;
  currency: string;
  awaitingMerchant: boolean;
}

export function useBuyerStanding(merchantId?: string, enabled = true) {
  return useQuery({
    queryKey: ["buyer", "standing", merchantId],
    queryFn: () => apiGet<BuyerStanding>(`/buyer/standing?merchantId=${encodeURIComponent(merchantId!)}`),
    enabled: enabled && Boolean(merchantId),
  });
}

// ── Merchant side ────────────────────────────────────────────────────

export interface PendingNegotiation {
  id: string;
  requestedDiscountBps: number;
  /** The figure a merchant actually decides on. A percentage is not what
   * leaves their account. */
  requestedDiscountMinor: number;
  originalTotalMinor: number;
  wouldBecomeMinor: number;
  customerTier: string | null;
  explanation: string | null;
  currency: string | null;
  createdAt: string;
}

/**
 * Only the requests the automation deliberately did NOT decide.
 *
 * Everything a customer's own record already entitled them to has been
 * applied without reaching this list — a queue full of routine loyalty
 * discounts would be a queue nobody reads.
 */
export function usePendingNegotiations() {
  return useQuery({
    queryKey: ["agent-gateway", "negotiations"],
    queryFn: () => apiGet<{ items: PendingNegotiation[] }>("/agent-gateway/negotiations"),
    refetchInterval: 5000,
  });
}

export function useDecideNegotiation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, approve }: { id: string; approve: boolean }) =>
      apiPost<{ proposalId: string; status: string; appliedDiscountBps: number; finalTotalMinor: number; explanation: string }>(
        `/agent-gateway/negotiations/${id}/decide`,
        { approve },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["agent-gateway"] });
    },
  });
}
