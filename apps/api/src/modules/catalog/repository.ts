import type { Prisma, PrismaClient } from "@prisma/client";
import { LOW_STOCK_THRESHOLD, type AvailabilityState } from "@razorgrowth/domain";

export interface ProductListFilters {
  merchantId: string;
  category?: string;
  search?: string;
  minPriceMinor?: number;
  maxPriceMinor?: number;
  availability?: AvailabilityState;
  page: number;
  limit: number;
}

export const productWithVariants = {
  include: { variants: { include: { inventory: true } } },
} satisfies Prisma.ProductDefaultArgs;

/**
 * Translate the derived `AvailabilityState` filter into a real Prisma
 * `where` clause (PART 02 §17, §74 — filter at the database layer, not by
 * loading everything into Node and filtering there).
 */
function availabilityWhere(availability: AvailabilityState): Prisma.ProductVariantListRelationFilter {
  switch (availability) {
    case "IN_STOCK":
      return { some: { active: true, inventory: { availableQuantity: { gt: LOW_STOCK_THRESHOLD } } } };
    case "LOW_STOCK":
      return { some: { active: true, inventory: { availableQuantity: { gt: 0, lte: LOW_STOCK_THRESHOLD } } } };
    case "OUT_OF_STOCK":
      return { some: { active: true, inventory: { availableQuantity: { lte: 0 } } } };
    case "UNAVAILABLE":
      return { some: { active: false } };
    case "UNKNOWN":
      return { some: { active: true, inventory: null } };
  }
}

export async function listProducts(prisma: PrismaClient, filters: ProductListFilters) {
  const where: Prisma.ProductWhereInput = {
    merchantId: filters.merchantId,
    status: "ACTIVE",
    ...(filters.category ? { category: filters.category } : {}),
    ...(filters.search
      ? {
          OR: [
            { name: { contains: filters.search, mode: "insensitive" } },
            { brand: { contains: filters.search, mode: "insensitive" } },
            { description: { contains: filters.search, mode: "insensitive" } },
          ],
        }
      : {}),
    ...(filters.minPriceMinor !== undefined || filters.maxPriceMinor !== undefined
      ? {
          variants: {
            some: {
              priceMinor: {
                ...(filters.minPriceMinor !== undefined ? { gte: filters.minPriceMinor } : {}),
                ...(filters.maxPriceMinor !== undefined ? { lte: filters.maxPriceMinor } : {}),
              },
            },
          },
        }
      : {}),
    ...(filters.availability ? { variants: availabilityWhere(filters.availability) } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.product.findMany({
      where,
      ...productWithVariants,
      orderBy: { name: "asc" },
      skip: (filters.page - 1) * filters.limit,
      take: filters.limit,
    }),
    prisma.product.count({ where }),
  ]);

  return { items, total };
}

/**
 * PART 02 §77 — only ACTIVE products are ever visible through either
 * catalog surface (human or agent-readable). DRAFT/ARCHIVED products
 * exist in the database but must never be returned here, regardless of
 * how the caller queries — enforced at the query level, not left to each
 * calling service to remember.
 */
export function findProductById(prisma: PrismaClient, merchantId: string, productId: string) {
  return prisma.product.findFirst({
    where: { id: productId, merchantId, status: "ACTIVE" },
    ...productWithVariants,
  });
}

export function listCategories(prisma: PrismaClient, merchantId: string) {
  return prisma.product.findMany({
    where: { merchantId, status: "ACTIVE" },
    distinct: ["category"],
    select: { category: true },
    orderBy: { category: "asc" },
  });
}

export type ProductWithVariants = Awaited<ReturnType<typeof findProductById>>;
