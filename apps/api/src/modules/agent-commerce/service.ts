import type { PrismaClient } from "@prisma/client";
import type { AgentReadableProductDTO } from "@razorgrowth/contracts";
import type { AvailabilityState } from "@razorgrowth/domain";
import { AppError } from "../../http/errors.js";
import { findProductById, listProducts } from "../catalog/repository.js";
import { toAgentReadableProduct } from "./mapper.js";

export interface ListAgentCatalogParams {
  merchantId: string;
  category?: string;
  minPriceMinor?: number;
  maxPriceMinor?: number;
  availability?: AvailabilityState;
  page: number;
  limit: number;
}

export async function listAgentCatalog(prisma: PrismaClient, params: ListAgentCatalogParams) {
  if (
    params.minPriceMinor !== undefined &&
    params.maxPriceMinor !== undefined &&
    params.minPriceMinor > params.maxPriceMinor
  ) {
    throw AppError.validation("minPriceMinor cannot be greater than maxPriceMinor.");
  }

  // Reuses the same server-side query/filtering the human catalog uses
  // (PART 02 §45, §77-§78) — only the response mapper differs.
  const { items, total } = await listProducts(prisma, params);
  return {
    items: items.map((p) => toAgentReadableProduct(p)),
    pagination: {
      page: params.page,
      limit: params.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / params.limit)),
    },
  };
}

export async function getAgentCatalogProduct(
  prisma: PrismaClient,
  merchantId: string,
  productId: string,
): Promise<AgentReadableProductDTO> {
  // `findProductById` already restricts to ACTIVE products server-side
  // (PART 02 §77) — no additional status check needed here.
  const product = await findProductById(prisma, merchantId, productId);
  if (!product) {
    throw AppError.notFound(`Product not found: ${productId}`);
  }
  return toAgentReadableProduct(product);
}
