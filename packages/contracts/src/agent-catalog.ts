import { z } from "zod";
import { SUPPORTED_CURRENCIES } from "@razorgrowth/domain";
import { moneySchema, productRelationshipTypeSchema, relationshipProvenanceSchema } from "./common.js";

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

/**
 * A product this one is related to, as an AI buyer may read it.
 *
 * WHY THIS IS ON THE WIRE AT ALL
 *
 * The merchant records relationships — complementary, upsell, similar,
 * bundle — and the Merchant Agent has always used them to build its own
 * bounded candidate set. The AI-readable catalogue exposed none of them.
 * An outside buyer agent reading the published catalogue could see every
 * product in isolation and nothing about how they go together, which is
 * exactly the information that turns a search into a basket.
 *
 * WHY `provenance` IS NOT OPTIONAL
 *
 * This is the field that keeps "never invent product facts" checkable
 * rather than merely promised. `MERCHANT_CONFIGURED` means a person
 * asserted this pairing. `SYSTEM_DERIVED` means something inferred it.
 * `DEMO_SEED` means it is fixture data. A buyer agent weighing whether to
 * add an accessory to a basket should be able to tell those apart, and
 * without this field it cannot — every relationship would arrive looking
 * equally authoritative.
 *
 * ONLY AGENT-VISIBLE TARGETS APPEAR HERE. A relationship pointing at a
 * draft or archived product is dropped rather than exposed: surfacing it
 * would both leak the existence of an unpublished product and offer an
 * agent something it can never buy.
 */
export const agentRelatedProductSchema = z.object({
  productId: z.string().uuid(),
  name: z.string(),
  category: z.string(),
  relationship: productRelationshipTypeSchema,
  provenance: relationshipProvenanceSchema,
  /** Enough to decide without a second fetch. Null when the related
   * product has no priced active variant — which is itself the answer to
   * "can I add this?". */
  priceRange: z
    .object({ minMinor: z.number().int(), maxMinor: z.number().int(), currency: z.enum(SUPPORTED_CURRENCIES) })
    .nullable(),
  availability: availabilityStateSchema,
});
export type AgentRelatedProductDTO = z.infer<typeof agentRelatedProductSchema>;

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
  /**
   * How this product relates to others in the same catalogue, grouped so a
   * buyer agent does not have to re-derive the grouping from a flat list.
   *
   * `upsell` is a dearer alternative TO this product; `crossSell` is
   * something to buy ALONGSIDE it. Keeping them apart on the wire matters:
   * an agent that conflates them offers a substitute where an addition was
   * meant, which is the difference between a bigger basket and a lost sale.
   */
  relationships: z.object({
    crossSell: z.array(agentRelatedProductSchema),
    upsell: z.array(agentRelatedProductSchema),
    similar: z.array(agentRelatedProductSchema),
    bundle: z.array(agentRelatedProductSchema),
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

/**
 * A catalogue gap, named products included.
 *
 * `suggestedAttributeKeys` is the merchant's own vocabulary from their own
 * products in the same category — never a generated suggestion. That
 * distinction is the whole reason an agent may report this at all: it is a
 * statement about the catalogue, checkable against it, rather than a guess
 * about what the product ought to say.
 */
export const catalogGapSchema = z.object({
  code: z.enum([
    "NO_PURCHASABLE_VARIANT",
    "MISSING_ATTRIBUTES",
    "INCONSISTENT_ATTRIBUTES",
    "UNKNOWN_INVENTORY",
    "MISSING_RETURN_POLICY",
    "MISSING_SHIPPING_POLICY",
    "THIN_DESCRIPTION",
  ]),
  title: z.string(),
  /** What an AI buyer does about this product today, as a consequence. */
  why: z.string(),
  /** What the merchant does about it. Never performed automatically —
   * every one of these is a product fact only they can supply. */
  fix: z.string(),
  /** The true total. `products` below may be capped. */
  affectedCount: z.number().int().min(0),
  products: z.array(
    z.object({ productId: z.string().uuid(), name: z.string(), category: z.string() }),
  ),
  suggestedAttributeKeys: z.array(z.string()),
});
export type CatalogGapDTO = z.infer<typeof catalogGapSchema>;

export const catalogGapReportSchema = z.object({
  activeProducts: z.number().int().min(0),
  /** Products with no gap at all — the only ones an agent can buy without
   * qualification, and the number the merchant is actually moving. */
  fullyReadyProducts: z.number().int().min(0),
  gaps: z.array(catalogGapSchema),
  generatedAt: z.string().datetime(),
});
export type CatalogGapReportDTO = z.infer<typeof catalogGapReportSchema>;
