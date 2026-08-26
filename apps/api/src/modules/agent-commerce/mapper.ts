/**
 * Maps a Product (with variants+inventory) to the canonical
 * `AgentReadableProductDTO` (PART 02 §6, §18-§19, §51, §76-§78).
 *
 * This is a dedicated mapper, not a re-export of the human catalog DTO —
 * it deliberately omits anything an external commerce surface shouldn't
 * expose (PART 02 §76: no cost price, no margins, no internal IDs beyond
 * the opaque product/variant UUIDs already used elsewhere) and adds
 * fields an AI buyer specifically needs (freshness, provenance,
 * per-product readiness) that the human UI DTO doesn't need to carry.
 */
import type { Inventory, Product, ProductVariant } from "@prisma/client";
import type { AgentReadableProductDTO, AgentVariantDTO } from "@razorgrowth/contracts";
import { deriveAvailabilityState, knownStatusOf, systemClock, type Clock } from "@razorgrowth/domain";
import { analyzeProduct, type ProductWithRelations } from "../catalog/quality-analyzer.js";

type VariantWithInventory = ProductVariant & { inventory: Inventory | null };
type ProductWithVariants = Product & { variants: VariantWithInventory[] };

function toAgentVariant(variant: VariantWithInventory): AgentVariantDTO {
  return {
    variantId: variant.id,
    sku: variant.sku,
    title: variant.title,
    price: { amountMinor: variant.priceMinor, currency: variant.currency },
    priceUpdatedAt: variant.priceUpdatedAt.toISOString(),
    availability: {
      state: deriveAvailabilityState(variant.inventory?.availableQuantity ?? null, variant.active),
      availableQuantity: variant.inventory?.availableQuantity ?? null,
      updatedAt: variant.inventory?.updatedAt.toISOString() ?? null,
    },
    attributes: (variant.attributes as Record<string, string>) ?? {},
    active: variant.active,
  };
}

export function toAgentReadableProduct(
  product: ProductWithVariants,
  clock: Clock = systemClock,
): AgentReadableProductDTO {
  const activeVariants = product.variants.filter((v) => v.active);
  const purchasablePrices = activeVariants
    .filter((v) => deriveAvailabilityState(v.inventory?.availableQuantity ?? null, v.active) !== "UNAVAILABLE")
    .map((v) => v.priceMinor);
  const currency = activeVariants[0]?.currency ?? "INR";

  const priceUpdateTimes = activeVariants.map((v) => v.priceUpdatedAt.getTime());
  const inventoryUpdateTimes = activeVariants
    .filter((v) => v.inventory !== null)
    .map((v) => v.inventory!.updatedAt.getTime());

  const readiness = analyzeProduct(product as ProductWithRelations, clock).readiness;
  const purchasableVariantCount = activeVariants.filter(
    (v) => deriveAvailabilityState(v.inventory?.availableQuantity ?? null, v.active) === "IN_STOCK" ||
      deriveAvailabilityState(v.inventory?.availableQuantity ?? null, v.active) === "LOW_STOCK",
  ).length;

  return {
    productId: product.id,
    merchantId: product.merchantId,
    identity: {
      name: product.name,
      brand: product.brand,
      category: product.category,
      description: product.description,
    },
    variants: product.variants.map(toAgentVariant),
    commerce: {
      currency,
      priceRange:
        purchasablePrices.length > 0
          ? { minMinor: Math.min(...purchasablePrices), maxMinor: Math.max(...purchasablePrices), currency }
          : null,
      purchasableVariantCount,
    },
    policies: {
      returns: {
        status: knownStatusOf(product.returnPolicySummary),
        summary: product.returnPolicySummary,
      },
      shipping: {
        status: knownStatusOf(product.shippingSummary),
        summary: product.shippingSummary,
      },
      promotionEligibility: product.promotionEligibility,
    },
    freshness: {
      productUpdatedAt: product.updatedAt.toISOString(),
      oldestPriceUpdateAt: priceUpdateTimes.length > 0 ? new Date(Math.min(...priceUpdateTimes)).toISOString() : null,
      oldestInventoryUpdateAt:
        inventoryUpdateTimes.length > 0 ? new Date(Math.min(...inventoryUpdateTimes)).toISOString() : null,
    },
    readiness: {
      state: readiness.state,
      missingCritical: readiness.missingCritical,
      missingImportant: readiness.missingImportant,
    },
    provenance: {
      source: "MERCHANT_AUTHORED",
      derivedFields: "SYSTEM_DERIVED",
      dataset: "SYNTHETIC_DEMO",
    },
  };
}
