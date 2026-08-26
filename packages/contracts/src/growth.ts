import { z } from "zod";
import { moneySchema, valueClassificationSchema } from "./common.js";

export const opportunityCategorySchema = z.enum([
  "CROSS_SELL",
  "UPSELL",
  "CATALOG_GAP",
  "READINESS_GAP",
  "PAYMENT_RECOVERY",
]);

/**
 * Signal → Opportunity → Recommendation (PART 00 §19). PART 01 seeds a
 * small number of these deterministically from real seed-data conditions
 * (PART 01 §79); the full Revenue Opportunity Engine is a later part.
 */
export const growthOpportunitySchema = z.object({
  id: z.string().uuid(),
  merchantId: z.string().uuid(),
  category: opportunityCategorySchema,
  signal: z.string(),
  recommendation: z.string(),
  estimatedValue: moneySchema.nullable(),
  valueClassification: valueClassificationSchema,
  status: z.enum(["IDENTIFIED", "PROPOSED", "ACTED_ON"]),
  isSyntheticDemo: z.boolean(),
  createdAt: z.string().datetime(),
});
export type GrowthOpportunityDTO = z.infer<typeof growthOpportunitySchema>;
