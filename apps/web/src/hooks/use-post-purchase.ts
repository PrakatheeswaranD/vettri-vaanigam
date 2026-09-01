/**
 * Post-purchase operations: refunds, returns, fulfillment, disputes, GST.
 *
 * WHY THIS FILE EXISTS
 *
 * All five surfaces were built, state-machine-tested and reachable over
 * HTTP — and none of them had a single frontend caller. A merchant could
 * not refund a payment, approve a return, attach a tracking number or
 * record a chargeback from the console, because the console never asked.
 *
 * Money moves through refunds and disputes, so these are mutations with
 * real financial consequence. Each one invalidates the payment and
 * transaction views it affects, so the console cannot keep showing a
 * payment as fully captured after part of it has been sent back.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MoneyDTO } from "@razorgrowth/contracts";
import { apiGet, apiPost } from "../lib/api-client";

export interface RefundRow {
  id: string;
  paymentId: string;
  amountMinor: number;
  currency: MoneyDTO["currency"];
  status: string;
  reason: string | null;
  createdAt: string;
}

export interface ReturnItemRow {
  id: string;
  orderItemId: string;
  quantity: number;
  reason: string | null;
}

export interface ReturnRow {
  id: string;
  orderId: string;
  status: string;
  reason: string | null;
  createdAt: string;
  items: ReturnItemRow[];
}

export interface FulfillmentRow {
  id: string;
  orderId: string;
  carrier: string;
  trackingNumber: string;
  status: string;
  estimatedDeliveryAt: string | null;
  createdAt: string;
  items: { id: string; orderItemId: string; quantity: number }[];
}

export interface DisputeRow {
  id: string;
  paymentId: string;
  amountMinor: number;
  currency: MoneyDTO["currency"];
  status: string;
  reason: string | null;
  providerDisputeId: string | null;
  feeMinor: number | null;
  createdAt: string;
}

export interface TaxBreakdown {
  isInterState: boolean;
  totalTaxAmountMinor: number;
  totalCgstMinor: number;
  totalSgstMinor: number;
  totalIgstMinor: number;
  taxableAmountMinor?: number;
  totalWithTaxMinor?: number;
}

const list = <T,>(key: string) => ({
  queryKey: ["post-purchase", key],
  queryFn: () => apiGet<{ items: T[] }>(`/${key}`),
});

export const useRefunds = () => useQuery(list<RefundRow>("refunds"));
export const useReturns = () => useQuery(list<ReturnRow>("returns"));
export const useFulfillments = () => useQuery(list<FulfillmentRow>("fulfillments"));
export const useDisputes = () => useQuery(list<DisputeRow>("disputes"));

/** Everything a refund or dispute touches, so no view keeps showing a
 *  payment as untouched after money has moved back. */
function invalidateMoneyViews(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: ["post-purchase"] });
  void queryClient.invalidateQueries({ queryKey: ["transactions"] });
  void queryClient.invalidateQueries({ queryKey: ["ledger"] });
  void queryClient.invalidateQueries({ queryKey: ["merchant", "stats"] });
}

export function useCreateRefund() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { paymentId: string; amountMinor: number; reason: string }) => apiPost<RefundRow>("/refunds", body),
    onSuccess: () => invalidateMoneyViews(queryClient),
  });
}

export function useCreateReturn() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { orderId: string; reason: string; items: { orderItemId: string; quantity: number }[] }) =>
      apiPost<ReturnRow>("/returns", body),
    onSuccess: () => invalidateMoneyViews(queryClient),
  });
}

export function useAdvanceReturn() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ returnId, status }: { returnId: string; status: string }) =>
      apiPost<ReturnRow>(`/returns/${returnId}/status`, { status }),
    onSuccess: () => invalidateMoneyViews(queryClient),
  });
}

export function useCreateFulfillment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { orderId: string; carrier: string; trackingNumber: string; items: { orderItemId: string; quantity: number }[] }) =>
      apiPost<FulfillmentRow>("/fulfillments", body),
    onSuccess: () => invalidateMoneyViews(queryClient),
  });
}

export function useAdvanceFulfillment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ fulfillmentId, status }: { fulfillmentId: string; status: string }) =>
      apiPost<FulfillmentRow>(`/fulfillments/${fulfillmentId}/status`, { status }),
    onSuccess: () => invalidateMoneyViews(queryClient),
  });
}

export function useCreateDispute() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { paymentId: string; amountMinor: number; reason: string }) => apiPost<DisputeRow>("/disputes", body),
    onSuccess: () => invalidateMoneyViews(queryClient),
  });
}

export function useAdvanceDispute() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ disputeId, status }: { disputeId: string; status: string }) =>
      apiPost<DisputeRow>(`/disputes/${disputeId}/status`, { status }),
    onSuccess: () => invalidateMoneyViews(queryClient),
  });
}

export function useCalculateTax() {
  return useMutation({
    mutationFn: (body: { amountMinor: number; taxRateBps: number; merchantStateCode: string; buyerStateCode: string }) =>
      apiPost<TaxBreakdown>("/taxes/calculate", body),
  });
}
