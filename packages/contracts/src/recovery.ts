import { z } from "zod";

/**
 * PART 08 — Failure-first recovery wire contracts. Every request here
 * carries only a reference (a payment ID, an authorization ID) — never
 * an amount, a desired outcome, or a retry count (PART 08 §54, §118).
 * The recovery proposal ITSELF reuses `growthActionProposalSchema`
 * (`merchant-agent.ts`) unchanged — this file only adds what that
 * schema doesn't already cover: the eligibility check's own request/
 * response, the recovery-execution request, and the workflow trace.
 */

export const recoveryEligibilityOutcomeSchema = z.enum(["ELIGIBLE", "NOT_ELIGIBLE", "RECONCILIATION_REQUIRED"]);
export type RecoveryEligibilityOutcomeDTO = z.infer<typeof recoveryEligibilityOutcomeSchema>;

export const recoveryReasonCodeSchema = z.enum([
  "RECOVERY_ALLOWED",
  "RECOVERY_LIMIT_REACHED",
  "FAILURE_NOT_RETRYABLE",
  "PAYMENT_STATE_UNKNOWN",
  "PAYMENT_ALREADY_CAPTURED",
  "ORDER_ALREADY_PAID",
  "ORDER_CANCELLED",
  "RECONCILIATION_REQUIRED",
  "INTEGRITY_FAILURE",
]);
export type RecoveryReasonCodeDTO = z.infer<typeof recoveryReasonCodeSchema>;

/** PART 08 §118 — the ONLY input the client controls: which failed
 * payment to evaluate recovery for. */
export const recoveryEvaluationRequestSchema = z.object({
  paymentId: z.string().uuid(),
});
export type RecoveryEvaluationRequestDTO = z.infer<typeof recoveryEvaluationRequestSchema>;

/** PART 08 §118-§119 — no amount, currency, desired state, or attempt
 * number; the server derives everything from the authorization. */
export const recoveryExecutionRequestSchema = z.object({
  idempotencyKey: z.string().min(1).max(200),
});
export type RecoveryExecutionRequestDTO = z.infer<typeof recoveryExecutionRequestSchema>;

export const recoveryExecutionResponseSchema = z.object({
  checkoutId: z.string().uuid(),
});
export type RecoveryExecutionResponseDTO = z.infer<typeof recoveryExecutionResponseSchema>;

/** PART 08 §64, §72, §107-§109 — a jury/technical-panel-facing aggregate
 * view over the Agent Action Ledger for one workflow: every event this
 * project's own actors recorded, in order, plus a derived financial
 * outcome. Built entirely from already-persisted `AgentAction` rows —
 * never a second audit log. */
export const workflowTraceStepSchema = z.object({
  sequence: z.number().int().min(1),
  actor: z.string(),
  event: z.string(),
  status: z.string(),
  conciseReason: z.string(),
  timestamp: z.string().datetime(),
  relatedEntityType: z.string().nullable(),
  relatedEntityId: z.string().nullable(),
});
export type WorkflowTraceStepDTO = z.infer<typeof workflowTraceStepSchema>;

export const workflowFinancialOutcomeSchema = z.enum(["PENDING", "FAILED", "RECOVERED", "CAPTURED"]);
export type WorkflowFinancialOutcomeDTO = z.infer<typeof workflowFinancialOutcomeSchema>;

export const workflowTraceSchema = z.object({
  workflowId: z.string().uuid(),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  steps: z.array(workflowTraceStepSchema),
  financialOutcome: workflowFinancialOutcomeSchema,
  ledgerIntegrity: z.object({ valid: z.boolean(), eventCount: z.number().int(), brokenAtSequence: z.number().int().nullable() }),
});
export type WorkflowTraceDTO = z.infer<typeof workflowTraceSchema>;
