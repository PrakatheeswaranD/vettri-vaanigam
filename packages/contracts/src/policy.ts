import { z } from "zod";
import { SUPPORTED_CURRENCIES } from "@razorgrowth/domain";

/**
 * PART 05 — Deterministic Policy Engine, Approval Lifecycle, and Execution
 * Authorization wire contracts. Every schema here describes the OUTPUT of
 * deterministic application code — the LLM never produces any of these
 * shapes directly (PART 00 §5, PART 05 §100-§102).
 */

export const POLICY_SCHEMA_VERSION = "1.0" as const;

export const policyOutcomeSchema = z.enum(["ALLOW", "DENY", "REQUIRE_APPROVAL"]);
export type PolicyOutcomeDTO = z.infer<typeof policyOutcomeSchema>;

export const policyReasonCodeSchema = z.enum([
  "WITHIN_AUTONOMOUS_LIMIT",
  "DISCOUNT_REQUIRES_APPROVAL",
  "DISCOUNT_LIMIT_EXCEEDED",
  "ORDER_AMOUNT_REQUIRES_APPROVAL",
  "ORDER_AMOUNT_LIMIT_EXCEEDED",
  "ACTION_TYPE_DISABLED",
  "CURRENCY_MISMATCH",
  "PROPOSAL_EXPIRED",
  "PROPOSAL_INVALID",
  "PRODUCT_NOT_ELIGIBLE",
  "PRODUCT_NOT_AVAILABLE",
  "POLICY_CONFIGURATION_INVALID",
  "RECOVERY_LIMIT_EXCEEDED",
]);
export type PolicyReasonCodeDTO = z.infer<typeof policyReasonCodeSchema>;

export const authorizationDenialReasonCodeSchema = z.enum([
  "POLICY_DENIED",
  "APPROVAL_REQUIRED",
  "APPROVAL_MISSING_OR_REJECTED",
  "APPROVAL_EXPIRED",
  "POLICY_VERSION_STALE",
  "PROPOSAL_CHANGED",
  "PRODUCT_NOT_ELIGIBLE",
  "PRODUCT_NOT_AVAILABLE",
  "CURRENCY_MISMATCH",
]);
export type AuthorizationDenialReasonCodeDTO = z.infer<typeof authorizationDenialReasonCodeSchema>;

export const policyEvaluatedValuesSchema = z.object({
  requestedDiscountBps: z.number().int().nullable(),
  requestedDiscountMinor: z.number().int().nullable(),
  orderAmountMinor: z.number().int().nullable(),
  currency: z.enum(SUPPORTED_CURRENCIES),
});

/**
 * A persisted `PolicyEvaluation` row (PART 05 §7, §13, §50). `triggeredRules`
 * intentionally is not a separate field from `reasonCodes` — each reason
 * code IS the identifier of the rule that fired, so duplicating them as a
 * second parallel list would just be the same data twice.
 */
export const policyDecisionSchema = z.object({
  id: z.string().uuid(),
  schemaVersion: z.literal(POLICY_SCHEMA_VERSION),
  proposalId: z.string().uuid(),
  merchantId: z.string().uuid(),
  workflowId: z.string().uuid(),
  outcome: policyOutcomeSchema,
  reasonCodes: z.array(policyReasonCodeSchema),
  explanation: z.string(),
  evaluatedPolicyVersion: z.number().int().min(1),
  evaluatedValues: policyEvaluatedValuesSchema,
  proposalFingerprint: z.string(),
  fingerprintVersion: z.string(),
  createdAt: z.string().datetime(),
});
export type PolicyDecisionDTO = z.infer<typeof policyDecisionSchema>;

export const policyEvaluateRequestSchema = z.object({
  proposalId: z.string().uuid(),
});
export type PolicyEvaluateRequestDTO = z.infer<typeof policyEvaluateRequestSchema>;

export const approvalDecisionSchema = z.enum(["APPROVED", "REJECTED"]);
export type ApprovalDecisionDTO = z.infer<typeof approvalDecisionSchema>;

/** A persisted `Approval` row (PART 05 §29-§32). Scoped to one exact
 * proposal fingerprint — never reusable against a changed proposal. */
export const approvalSchema = z.object({
  id: z.string().uuid(),
  proposalId: z.string().uuid(),
  proposalFingerprint: z.string(),
  merchantId: z.string().uuid(),
  policyDecisionId: z.string().uuid(),
  evaluatedPolicyVersion: z.number().int().min(1),
  decision: approvalDecisionSchema,
  reason: z.string().nullable(),
  approverId: z.string(),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});
export type ApprovalDTO = z.infer<typeof approvalSchema>;

export const approvalRequestBodySchema = z.object({
  reason: z.string().max(500).optional(),
});
export type ApprovalRequestBodyDTO = z.infer<typeof approvalRequestBodySchema>;

export const executionAuthorizationStatusSchema = z.enum(["ACTIVE", "CONSUMED", "EXPIRED", "REVOKED"]);
export type ExecutionAuthorizationStatusDTO = z.infer<typeof executionAuthorizationStatusSchema>;

export const authorizationFinancialBoundsSchema = z.object({
  actionType: z.string(),
  discountBps: z.number().int().nullable(),
  discountMinor: z.number().int().nullable(),
  orderAmountMinor: z.number().int().nullable(),
  currency: z.enum(SUPPORTED_CURRENCIES),
});

/** A persisted `ExecutionAuthorization` row (PART 05 §37-§45). NOT a bearer
 * token — PART 06/07 must load and revalidate this server-side by
 * `authorizationId`, never accept it as self-certifying proof. */
export const executionAuthorizationSchema = z.object({
  id: z.string().uuid(),
  proposalId: z.string().uuid(),
  proposalFingerprint: z.string(),
  merchantId: z.string().uuid(),
  policyDecisionId: z.string().uuid(),
  approvalId: z.string().uuid().nullable(),
  authorizedActionType: z.string(),
  financialBounds: authorizationFinancialBoundsSchema,
  issuedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  status: executionAuthorizationStatusSchema,
  authorizationVersion: z.string(),
  createdAt: z.string().datetime(),
});
export type ExecutionAuthorizationDTO = z.infer<typeof executionAuthorizationSchema>;

/** Returned whenever authorization issuance is attempted but does not
 * succeed — a structured, honest "not yet authorized" result, never a
 * generic 500 for an entirely expected governance outcome. */
export const authorizationDenialSchema = z.object({
  denied: z.literal(true),
  reasonCode: authorizationDenialReasonCodeSchema,
  explanation: z.string(),
});
export type AuthorizationDenialDTO = z.infer<typeof authorizationDenialSchema>;

export const authorizationResultSchema = z.union([executionAuthorizationSchema, authorizationDenialSchema]);
export type AuthorizationResultDTO = z.infer<typeof authorizationResultSchema>;

/** PART 05 §61-§63 — application-level tamper evidence, explicitly NOT a
 * blockchain claim (§130). */
export const ledgerVerificationResultSchema = z.object({
  workflowId: z.string().uuid(),
  valid: z.boolean(),
  eventCount: z.number().int().min(0),
  brokenAtSequence: z.number().int().nullable(),
  verifiedAt: z.string().datetime(),
});
export type LedgerVerificationResultDTO = z.infer<typeof ledgerVerificationResultSchema>;
