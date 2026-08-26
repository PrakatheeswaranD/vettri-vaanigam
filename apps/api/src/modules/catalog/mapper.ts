import type { Inventory, Product, ProductVariant } from "@prisma/client";
import type { ProductDTO, ProductSummaryDTO, ProductVariantDTO } from "@razorgrowth/contracts";
import { deriveAvailabilityState, systemClock, type Clock } from "@razorgrowth/domain";
import { analyzeProduct, type ProductWithRelations } from "./quality-analyzer.js";

type VariantWithInventory = ProductVariant & { inventory: Inventory | null };
type ProductWithVariants = Product & { variants: VariantWithInventory[] };

function toVariantDTO(variant: VariantWithInventory): ProductVariantDTO {
  return {
    id: variant.id,
    productId: variant.productId,
    sku: variant.sku,
    title: variant.title,
    price: { amountMinor: variant.priceMinor, currency: variant.currency },
    attributes: (variant.attributes as Record<string, string>) ?? {},
    active: variant.active,
    inventory: variant.inventory
      ? {
          variantId: variant.inventory.variantId,
          availableQuantity: variant.inventory.availableQuantity,
          updatedAt: variant.inventory.updatedAt.toISOString(),
        }
      : null,
    availability: deriveAvailabilityState(variant.inventory?.availableQuantity ?? null, variant.active),
  };
}

export function toProductDTO(product: ProductWithVariants, clock: Clock = systemClock): ProductDTO {
  const readiness = analyzeProduct(product as ProductWithRelations, clock).readiness;
  return {
    id: product.id,
    merchantId: product.merchantId,
    name: product.name,
    slug: product.slug,
    description: product.description,
    category: product.category,
    brand: product.brand,
    status: product.status,
    returnPolicySummary: product.returnPolicySummary,
    shippingSummary: product.shippingSummary,
    promotionEligibility: product.promotionEligibility,
    variants: product.variants.map(toVariantDTO),
    readiness: readiness.state,
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
  };
}

export function toProductSummaryDTO(product: ProductWithVariants, clock: Clock = systemClock): ProductSummaryDTO {
  const activeVariants = product.variants.filter((v) => v.active);
  const prices = activeVariants.map((v) => v.priceMinor);
  const currency = activeVariants[0]?.currency ?? "INR";
  const totalAvailable = activeVariants.reduce((sum, v) => sum + (v.inventory?.availableQuantity ?? 0), 0);
  const readiness = analyzeProduct(product as ProductWithRelations, clock).readiness;

  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    category: product.category,
    brand: product.brand,
    status: product.status,
    minPrice: prices.length > 0 ? { amountMinor: Math.min(...prices), currency } : null,
    maxPrice: prices.length > 0 ? { amountMinor: Math.max(...prices), currency } : null,
    totalAvailable,
    variantCount: product.variants.length,
    readiness: readiness.state,
  };
}
