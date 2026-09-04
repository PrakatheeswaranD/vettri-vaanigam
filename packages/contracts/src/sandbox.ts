import { z } from "zod";

/**
 * Break the Agent — an adversarial sandbox (PART 09 §24-§30). Every
 * preset is a closed, curated attack ID; the server maps each one to a
 * REAL deterministic validator/policy/authorization/eligibility check —
 * never a generic "run arbitrary text against an endpoint" surface, and
 * never a fake "blocked" animation with no real backend behind it.
 */
export const sandboxAttackIdSchema = z.enum([
  // Vettri Vaanigam gateway attacks. The originals all target this merchant's OWN
  // agents; these target the boundary an OUTSIDE agent actually reaches,
  // which is the one that matters once the product is a gateway.
  "MANDATE_FORGERY",
  "MANDATE_REPLAY",
  "PRICE_TAMPERING",
  "FINANCIAL_LIMIT_50_PERCENT_DISCOUNT",
  "APPROVAL_BYPASS",
  "PRODUCT_HALLUCINATION",
  "PAYMENT_SUCCESS_FORGERY",
  "RECOVERY_RETRY_ABUSE",
  "VISIBILITY_BYPASS_HIDDEN_PRODUCT",
]);
export type SandboxAttackId = z.infer<typeof sandboxAttackIdSchema>;

export const sandboxAttackCategorySchema = z.enum([
  "MANDATE_FORGERY",
  "MANDATE_REPLAY",
  "PRICE_TAMPERING",
  "FINANCIAL_LIMIT",
  "APPROVAL_BYPASS",
  "PRODUCT_HALLUCINATION",
  "PAYMENT_FORGERY",
  "RECOVERY_ABUSE",
  "VISIBILITY_BYPASS",
]);
export type SandboxAttackCategory = z.infer<typeof sandboxAttackCategorySchema>;

export const sandboxAttackPresetSchema = z.object({
  id: sandboxAttackIdSchema,
  category: sandboxAttackCategorySchema,
  label: z.string(),
  prompt: z.string(),
  description: z.string(),
});
export type SandboxAttackPresetDTO = z.infer<typeof sandboxAttackPresetSchema>;

export const sandboxStageStatusSchema = z.enum(["BLOCKED", "DENIED", "NOT_AVAILABLE", "NOT_ISSUED", "NOT_REACHED", "REJECTED"]);
export type SandboxStageStatusDTO = z.infer<typeof sandboxStageStatusSchema>;

export const sandboxStageSchema = z.object({
  id: z.string(),
  label: z.string(),
  status: sandboxStageStatusSchema,
  detail: z.string(),
});
export type SandboxStageDTO = z.infer<typeof sandboxStageSchema>;

export const sandboxRunRequestSchema = z.object({ attackId: sandboxAttackIdSchema });
export type SandboxRunRequestDTO = z.infer<typeof sandboxRunRequestSchema>;

export const sandboxRunResultSchema = z.object({
  attackId: sandboxAttackIdSchema,
  category: sandboxAttackCategorySchema,
  blockedAtStage: z.string(),
  stages: z.array(sandboxStageSchema),
  moneyMovedMinor: z.literal(0),
  summary: z.string(),
});
export type SandboxRunResultDTO = z.infer<typeof sandboxRunResultSchema>;
