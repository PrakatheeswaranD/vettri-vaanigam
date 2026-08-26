import { z } from "zod";
import { SUPPORTED_CURRENCIES } from "@razorgrowth/domain";
import { moneySchema } from "./common.js";

export const merchantSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  defaultCurrency: z.enum(SUPPORTED_CURRENCIES),
  businessCategory: z.string(),
  status: z.enum(["ACTIVE", "SUSPENDED"]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type MerchantDTO = z.infer<typeof merchantSchema>;

/**
 * Deterministic policy configuration (PART 00 §11; PART 01 §11; PART 05
 * §11-§13). This is the data the real Policy Engine (`@razorgrowth/domain`
 * `evaluatePolicy`, `apps/api` `modules/policy`) reads to decide ALLOW /
 * DENY / REQUIRE_APPROVAL — it is data, never decision logic itself.
 *
 * Superseded the PART 01 placeholder shape (`maxDiscountPercent` as a
 * single ceiling, no distinction between a hard limit and an auto-approval
 * threshold) once PART 05 actually needed that distinction (PART 00 §54 —
 * evolving a read-only placeholder is not the same as silently weakening
 * an already-enforced contract, since nothing enforced the old shape yet).
 */
export const merchantPolicySchema = z.object({
  merchantId: z.string().uuid(),
  policyVersion: z.number().int().min(1),
  currency: z.enum(SUPPORTED_CURRENCIES),
  /** Basis points throughout (500 = 5%) — never a bare percent, matching
   * every other bps-denominated boundary in the system. */
  maxDiscountBps: z.number().int().min(0).max(10_000),
  autoApprovalDiscountBps: z.number().int().min(0).max(10_000),
  maxOrderAmount: moneySchema,
  autoApprovalOrderAmount: moneySchema,
  maxRecoveryAttempts: z.number().int().min(0),
  proposalValidityMinutes: z.number().int().min(1),
  approvalValidityMinutes: z.number().int().min(1),
  authorizationValidityMinutes: z.number().int().min(1),
  updatedAt: z.string().datetime(),
});
export type MerchantPolicyDTO = z.infer<typeof merchantPolicySchema>;

/** PART 05 §75-§76 — merchant-editable subset only; `merchantId`,
 * `policyVersion`, and `updatedAt` are always server-derived. */
export const merchantPolicyUpdateSchema = z.object({
  maxDiscountBps: z.number().int().min(0).max(10_000),
  autoApprovalDiscountBps: z.number().int().min(0).max(10_000),
  maxOrderAmountMinor: z.number().int().min(0),
  autoApprovalOrderAmountMinor: z.number().int().min(0),
  maxRecoveryAttempts: z.number().int().min(0),
  proposalValidityMinutes: z.number().int().min(1),
  approvalValidityMinutes: z.number().int().min(1),
  authorizationValidityMinutes: z.number().int().min(1),
});
export type MerchantPolicyUpdateDTO = z.infer<typeof merchantPolicyUpdateSchema>;

export const merchantStatsSchema = z.object({
  productCount: z.number().int().min(0),
  orderCount: z.number().int().min(0),
  capturedPayments: z.number().int().min(0),
  failedPayments: z.number().int().min(0),
  outOfStockVariants: z.number().int().min(0),
});
export type MerchantStatsDTO = z.infer<typeof merchantStatsSchema>;
