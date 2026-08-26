/**
 * PART 08 — failure-first recovery hooks. `useEvaluateRecovery` sends
 * only a failed payment's ID; `useExecuteRecovery` sends only a recovery
 * authorization ID plus an idempotency key — never an amount, a desired
 * outcome, or an attempt number (PART 08 §54, §118-§119).
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { GrowthActionProposalDTO, RecoveryExecutionResponseDTO } from "@razorgrowth/contracts";
import { apiPost } from "../lib/api-client";

export function useEvaluateRecovery() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (paymentId: string) => apiPost<GrowthActionProposalDTO>("/payments/recovery/evaluate", { paymentId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["ledger"] });
    },
  });
}

export function useExecuteRecovery() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ authorizationId, idempotencyKey }: { authorizationId: string; idempotencyKey: string }) =>
      apiPost<RecoveryExecutionResponseDTO>(`/payments/recovery/${authorizationId}/execute`, { idempotencyKey }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["ledger"] });
    },
  });
}
