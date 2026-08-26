import type { PrismaClient } from "@prisma/client";
import type { CatalogQualitySummaryDTO, ProductDTO } from "@razorgrowth/contracts";
import type { AvailabilityState } from "@razorgrowth/domain";
import { AppError } from "../../http/errors.js";
import { findProductById, listCategories, listProducts } from "./repository.js";
import { toProductDTO, toProductSummaryDTO } from "./mapper.js";
import { analyzeCatalog } from "./quality-analyzer.js";

export interface ListCatalogParams {
  merchantId: string;
  category?: string;
  search?: string;
  minPriceMinor?: number;
  maxPriceMinor?: number;
  availability?: AvailabilityState;
  page: number;
  limit: number;
}

export async function listCatalogProducts(prisma: PrismaClient, params: ListCatalogParams) {
  if (
    params.minPriceMinor !== undefined &&
    params.maxPriceMinor !== undefined &&
    params.minPriceMinor > params.maxPriceMinor
  ) {
    throw AppError.validation("minPriceMinor cannot be greater than maxPriceMinor.");
  }

  const { items, total } = await listProducts(prisma, params);
  return {
    items: items.map((p) => toProductSummaryDTO(p)),
    pagination: {
      page: params.page,
      limit: params.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / params.limit)),
    },
  };
}

export async function getCatalogProduct(
  prisma: PrismaClient,
  merchantId: string,
  productId: string,
): Promise<ProductDTO> {
  const product = await findProductById(prisma, merchantId, productId);
  if (!product) {
    throw AppError.notFound(`Product not found: ${productId}`);
  }
  return toProductDTO(product);
}

export async function listCatalogCategories(prisma: PrismaClient, merchantId: string): Promise<string[]> {
  const rows = await listCategories(prisma, merchantId);
  return rows.map((r) => r.category);
}

/** PART 02 §103 — every value here derives from real analyzed catalog
 * evidence, the same evidence the readiness engine uses. */
export async function getCatalogQualitySummary(
  prisma: PrismaClient,
  merchantId: string,
): Promise<CatalogQualitySummaryDTO> {
  const evidence = await analyzeCatalog(prisma, merchantId);
  return {
    activeProducts: evidence.activeProductCount,
    agentReadyProducts: evidence.agentReadyProductCount,
    partiallyReadyProducts: evidence.partiallyReadyProductCount,
    notReadyProducts: evidence.notReadyProductCount,
    missingReturnPolicies: evidence.productsMissingReturnPolicy,
    missingShippingPolicies: evidence.productsMissingShippingPolicy,
    unknownInventoryVariants: evidence.variantsWithUnknownInventory,
  };
}
