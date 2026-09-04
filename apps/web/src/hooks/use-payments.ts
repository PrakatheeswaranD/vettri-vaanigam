/**
 * PART 07 — Razorpay Test Mode payment hooks. Every mutation here sends
 * only references (a checkout ID, a payment ID, provider-returned
 * completion identifiers) — never an amount, currency, or success/failure
 * boolean (PART 07 §14, §37). `usePayment`'s bounded polling is the only
 * source of "did it work" the UI trusts; nothing here assumes success
 * from a Razorpay Checkout callback alone.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { PaymentClientVerificationRequestDTO, PaymentDTO, PaymentInitiationResponseDTO } from "@razorgrowth/contracts";
import { apiGet, apiPost } from "../lib/api-client";

const TERMINAL_PAYMENT_STATES = new Set(["CAPTURED", "FAILED", "CANCELLED"]);

export function useInitiatePayment() {
  return useMutation({
    mutationFn: (checkoutId: string) => apiPost<PaymentInitiationResponseDTO>("/payments/initiate", { checkoutId }),
  });
}

export function useVerifyPaymentCompletion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: PaymentClientVerificationRequestDTO) => apiPost<PaymentDTO>("/payments/razorpay/verify", request),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["ledger"] });
    },
  });
}

/*
 * `useReconcilePayment` used to live here — a second browser path to
 * reconciliation, unused. The UI reconciles through
 * `useRunAgentTool("reconcile_payment")`, which goes via the agent tool
 * registry and records the action in the ledger with agent attribution.
 * Two client paths to the same money operation, one of them bypassing the
 * audit trail, is not redundancy worth keeping.
 *
 * `POST /payments/:id/reconcile` is untouched: it is the API surface the
 * agent tool itself calls, and reconciliation still works.
 */

/** Polls a payment's authoritative state for a bounded window after
 * initiation/verification (PART 07 §70, §169-§172) — never indefinitely,
 * and never faster than the server needs to see real traffic. Stops the
 * instant a terminal state is reached. */
export function usePayment(paymentId: string | null, options?: { poll?: boolean }) {
  return useQuery({
    queryKey: ["payments", paymentId],
    queryFn: () => apiGet<PaymentDTO>(`/payments/${paymentId}`),
    enabled: Boolean(paymentId),
    refetchInterval: (query) => {
      if (!options?.poll) return false;
      const data = query.state.data as PaymentDTO | undefined;
      if (data && TERMINAL_PAYMENT_STATES.has(data.state)) return false;
      return 1500;
    },
  });
}

export function isTerminalPaymentState(state: string): boolean {
  return TERMINAL_PAYMENT_STATES.has(state);
}
