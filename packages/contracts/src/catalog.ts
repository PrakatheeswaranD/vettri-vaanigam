import { z } from "zod";
import { moneySchema } from "./common.js";
import { availabilityStateSchema, productReadinessStateSchema, promotionEligibilitySchema } from "./agent-catalog.js";

export const inventorySchema = z.object({
  variantId: z.string().uuid(),
  availableQuantity: z.number().int().min(0),
  updatedAt: z.string().datetime(),
});
export type InventoryDTO = z.infer<typeof inventorySchema>;

export const productVariantSchema = z.object({
  id: z.string().uuid(),
  productId: z.string().uuid(),
  sku: z.string(),
  title: z.string(),
  price: moneySchema,
  attributes: z.record(z.string(), z.string()),
  active: z.boolean(),
  inventory: inventorySchema.nullable(),
  availability: availabilityStateSchema,
});
export type ProductVariantDTO = z.infer<typeof productVariantSchema>;

/**
 * Agent-readable product representation (PART 00 §17, §43 step 3; PART 01
 * §43). This is the same DTO used for both the human-facing catalog UI and
 * the "agent-readable data" panel on the product-detail page — the point
 * being that it genuinely is one structured representation, not a
 * human view plus a separate fabricated "AI view".
 */
export const productSchema = z.object({
  id: z.string().uuid(),
  merchantId: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  description: z.string(),
  category: z.string(),
  brand: z.string(),
  status: z.enum(["ACTIVE", "DRAFT", "ARCHIVED"]),
  returnPolicySummary: z.string().nullable(),
  shippingSummary: z.string().nullable(),
  promotionEligibility: promotionEligibilitySchema,
  variants: z.array(productVariantSchema),
  readiness: productReadinessStateSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ProductDTO = z.infer<typeof productSchema>;

/** Lighter-weight shape for list views (no full variant array). */
export const productSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  category: z.string(),
  brand: z.string(),
  status: z.enum(["ACTIVE", "DRAFT", "ARCHIVED"]),
  minPrice: moneySchema.nullable(),
  maxPrice: moneySchema.nullable(),
  totalAvailable: z.number().int().min(0),
  variantCount: z.number().int().min(0),
  readiness: productReadinessStateSchema,
});
export type ProductSummaryDTO = z.infer<typeof productSummarySchema>;

export const catalogListQuerySchema = z.object({
  category: z.string().optional(),
  search: z.string().max(200).optional(),
  minPriceMinor: z.coerce.number().int().min(0).optional(),
  maxPriceMinor: z.coerce.number().int().min(0).optional(),
  availability: availabilityStateSchema.optional(),
});
export type CatalogListQueryDTO = z.infer<typeof catalogListQuerySchema>;
