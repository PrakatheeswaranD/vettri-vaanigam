import { z } from "zod";
import { SUPPORTED_CURRENCIES } from "@razorgrowth/domain";
import { moneySchema } from "./common.js";

/**
 * Agent-readable commerce contract (PART 02 §6-§9, §51, §120).
 *
 * This is the canonical machine-consumable product representation — the
 * same structured data whether rendered as the human "Agent View" panel
 * or served from the `/agent-commerce` API. `UNKNOWN` is a first-class
 * value throughout: missing data is never silently upgraded into a
 * positive answer (PART 02 §9).
 */

export const availabilityStateSchema = z.enum(["IN_STOCK", "LOW_STOCK", "OUT_OF_STOCK", "UNAVAILABLE", "UNKNOWN"]);
export type AvailabilityStateDTO = z.infer<typeof availabilityStateSchema>;

export const knownStatusSchema = z.enum(["KNOWN", "UNKNOWN"]);
export const promotionEligibilitySchema = z.enum(["ELIGIBLE", "INELIGIBLE", "UNKNOWN"]);
export const productReadinessStateSchema = z.enum(["AGENT_READY", "PARTIALLY_READY", "NOT_READY"]);

export const agentAvailabilitySchema = z.object({
  state: availabilityStateSchema,
  availableQuantity: z.number().int().nullable(),
  updatedAt: z.string().datetime().nullable(),
});

export const agentVariantSchema = z.object({
  variantId: z.string().uuid(),
  sku: z.string(),
  title: z.string(),
  price: moneySchema,
  priceUpdatedAt: z.string().datetime(),
  availability: agentAvailabilitySchema,
  attributes: z.record(z.string(), z.string()),
  active: z.boolean(),
});
export type AgentVariantDTO = z.infer<typeof agentVariantSchema>;

export const agentPolicyFieldSchema = z.object({
  status: knownStatusSchema,
  summary: z.string().nullable(),
});

export const agentReadableProductSchema = z.object({
  productId: z.string().uuid(),
  merchantId: z.string().uuid(),
  identity: z.object({
    name: z.string(),
    brand: z.string(),
    category: z.string(),
    description: z.string(),
  }),
  variants: z.array(agentVariantSchema),
  commerce: z.object({
    currency: z.enum(SUPPORTED_CURRENCIES),
    priceRange: z
      .object({ minMinor: z.number().int(), maxMinor: z.number().int(), currency: z.enum(SUPPORTED_CURRENCIES) })
      .nullable(),
    purchasableVariantCount: z.number().int().min(0),
  }),
  policies: z.object({
    returns: agentPolicyFieldSchema,
    shipping: agentPolicyFieldSchema,
    promotionEligibility: promotionEligibilitySchema,
  }),
  freshness: z.object({
    productUpdatedAt: z.string().datetime(),
    oldestPriceUpdateAt: z.string().datetime().nullable(),
    oldestInventoryUpdateAt: z.string().datetime().nullable(),
  }),
  readiness: z.object({
    state: productReadinessStateSchema,
    missingCritical: z.array(z.string()),
    missingImportant: z.array(z.string()),
  }),
  provenance: z.object({
    source: z.literal("MERCHANT_AUTHORED"),
    derivedFields: z.literal("SYSTEM_DERIVED"),
    dataset: z.enum(["SYNTHETIC_DEMO", "LIVE"]),
  }),
});
export type AgentReadableProductDTO = z.infer<typeof agentReadableProductSchema>;

export const agentCatalogQuerySchema = z.object({
  category: z.string().max(100).optional(),
  minPriceMinor: z.coerce.number().int().min(0).optional(),
  maxPriceMinor: z.coerce.number().int().min(0).optional(),
  availability: availabilityStateSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type AgentCatalogQueryDTO = z.infer<typeof agentCatalogQuerySchema>;

/** PART 02 §103 — catalog quality summary, all values data-derived. */
export const catalogQualitySummarySchema = z.object({
  activeProducts: z.number().int().min(0),
  agentReadyProducts: z.number().int().min(0),
  partiallyReadyProducts: z.number().int().min(0),
  notReadyProducts: z.number().int().min(0),
  missingReturnPolicies: z.number().int().min(0),
  missingShippingPolicies: z.number().int().min(0),
  unknownInventoryVariants: z.number().int().min(0),
});
export type CatalogQualitySummaryDTO = z.infer<typeof catalogQualitySummarySchema>;
