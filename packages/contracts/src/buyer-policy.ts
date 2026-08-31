import { z } from "zod";
import { SUPPORTED_CURRENCIES } from "@razorgrowth/domain";

export const buyerSpendingPolicySchema = z.object({
  id: z.string().uuid(),
  currency: z.enum(SUPPORTED_CURRENCIES),
  autonomousPurchaseLimitMinor: z.number().int().min(0),
  dailyLimitMinor: z.number().int().min(0),
  allowedCategories: z.array(z.string()),
  approvalRequiredAboveLimit: z.boolean(),
  updatedAt: z.string().datetime(),
});
export type BuyerSpendingPolicyDTO = z.infer<typeof buyerSpendingPolicySchema>;

export const buyerSpendingPolicyUpdateSchema = z.object({
  autonomousPurchaseLimitMinor: z.number().int().min(0).max(100_000_000),
  dailyLimitMinor: z.number().int().min(0).max(100_000_000),
  allowedCategories: z.array(z.string().trim().min(1).max(100)).max(50),
  approvalRequiredAboveLimit: z.boolean(),
}).refine((value) => value.dailyLimitMinor >= value.autonomousPurchaseLimitMinor, {
  message: "Daily limit must be at least the autonomous purchase limit.",
});
export type BuyerSpendingPolicyUpdateDTO = z.infer<typeof buyerSpendingPolicyUpdateSchema>;
