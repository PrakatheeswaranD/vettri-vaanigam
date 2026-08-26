import { z } from "zod";

export const agentActorTypeSchema = z.enum([
  "BUYER_AGENT",
  "MERCHANT_AGENT",
  "POLICY_ENGINE",
  "MERCHANT_USER",
  "CUSTOMER",
  "SYSTEM",
  "COMMERCE",
  "PAYMENT_SYSTEM",
  "RAZORPAY",
]);
export const agentActionStatusSchema = z.enum([
  "PROPOSED",
  "PENDING_APPROVAL",
  "APPROVED",
  "REJECTED",
  "EXPIRED",
  "EXECUTED",
  "FAILED",
  "VERIFIED",
]);

/**
 * Agent Action Ledger entry (PART 00 §20, §38). `conciseReason` is a
 * short auditable explanation — never hidden chain-of-thought (PART 00 §20,
 * §85).
 */
export const agentActionSchema = z.object({
  id: z.string().uuid(),
  workflowId: z.string().uuid(),
  agentRunId: z.string().uuid().nullable(),
  merchantId: z.string().uuid(),
  actorType: agentActorTypeSchema,
  actionType: z.string(),
  status: agentActionStatusSchema,
  conciseReason: z.string(),
  policyDecision: z.enum(["ALLOW", "DENY", "REQUIRE_APPROVAL"]).nullable(),
  relatedEntityType: z.string().nullable(),
  relatedEntityId: z.string().nullable(),
  /** PART 05 §52, §64 — compact structured metadata only (e.g. proposal
   * id, policy decision id, reason codes, amounts) — never a full AI
   * prompt/response or chain-of-thought (§102). */
  metadata: z.record(z.string(), z.unknown()).nullable(),
  /** PART 05 §57-§60, §140 — position within this event's `workflowId`
   * hash chain, 1-indexed. */
  sequence: z.number().int().min(1),
  previousEventHash: z.string().nullable(),
  eventHash: z.string(),
  ledgerHashVersion: z.string(),
  isSyntheticDemo: z.boolean(),
  createdAt: z.string().datetime(),
  executedAt: z.string().datetime().nullable(),
});
export type AgentActionDTO = z.infer<typeof agentActionSchema>;

export const ledgerListQuerySchema = z.object({
  actorType: agentActorTypeSchema.optional(),
  status: agentActionStatusSchema.optional(),
  workflowId: z.string().uuid().optional(),
});
export type LedgerListQueryDTO = z.infer<typeof ledgerListQuerySchema>;
