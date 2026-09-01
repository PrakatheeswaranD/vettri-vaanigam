import type { Prisma, PrismaClient } from "@prisma/client";
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

/**
 * Create a product with its first variant and opening stock.
 *
 * The console has shipped an "Add Product" modal since PART 02 — fully
 * built, validated, wired to `POST /catalog/products`. That route did not
 * exist, so the only thing the button could ever do was surface
 * "Route not found: POST /api/v1/catalog/products" inside the dialog.
 *
 * Written as ONE transaction on purpose: a product row without its
 * variant is a product with no price, which the readiness engine reports
 * as MISSING_PRICE and the agent catalogue refuses to sell. A partial
 * write here would create exactly the data defect the rest of the system
 * is built to detect.
 *
 * `costMinor` is optional and stays NULL when absent rather than
 * defaulting to zero — the negotiator treats unknown cost as "cannot
 * check a margin" and fails closed, which is correct, whereas a zero cost
 * would look like 100% margin and authorise discounts that give money
 * away.
 */
export async function createCatalogProduct(
  prisma: PrismaClient,
  merchantId: string,
  input: {
    name: string;
    description: string;
    category: string;
    brand?: string;
    returnPolicySummary?: string;
    shippingSummary?: string;
    variants: {
      sku: string;
      title: string;
      priceMinor: number;
      costMinor?: number;
      currency: "INR" | "USD";
      attributes?: Record<string, string>;
      inventory?: { availableQuantity: number };
    }[];
  },
): Promise<ProductDTO> {
  const slug = input.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  if (!slug) throw AppError.validation("Product name must contain at least one letter or number.");

  const skus = input.variants.map((variant) => variant.sku);
  if (new Set(skus).size !== skus.length) throw AppError.validation("Variant SKUs must be unique within a product.");

  const [slugTaken, skuTaken] = await Promise.all([
    prisma.product.findFirst({ where: { merchantId, slug }, select: { id: true } }),
    prisma.productVariant.findFirst({ where: { sku: { in: skus }, product: { merchantId } }, select: { sku: true } }),
  ]);
  if (slugTaken) throw AppError.conflict(`A product named "${input.name}" already exists.`);
  if (skuTaken) throw AppError.conflict(`SKU "${skuTaken.sku}" is already used by another product.`);

  const productId = await prisma.$transaction(async (tx) => {
    const product = await tx.product.create({
      data: {
        merchantId,
        name: input.name,
        slug,
        description: input.description,
        category: input.category,
        brand: input.brand?.trim() || input.name.split(" ")[0] || input.category,
        ...(input.returnPolicySummary ? { returnPolicySummary: input.returnPolicySummary } : {}),
        ...(input.shippingSummary ? { shippingSummary: input.shippingSummary } : {}),
      },
    });

    for (const variant of input.variants) {
      const created = await tx.productVariant.create({
        data: {
          productId: product.id,
          sku: variant.sku,
          title: variant.title,
          priceMinor: variant.priceMinor,
          ...(variant.costMinor !== undefined ? { costMinor: variant.costMinor } : {}),
          currency: variant.currency,
          attributes: (variant.attributes ?? {}) as Prisma.InputJsonValue,
        },
      });
      // Absent inventory stays absent. PART 02 §9 treats "never recorded"
      // as UNKNOWN — a real state an agent must not read as zero or as
      // available — so a merchant who does not know their stock yet is not
      // made to assert a number.
      if (variant.inventory) {
        await tx.inventory.create({
          data: { variantId: created.id, availableQuantity: variant.inventory.availableQuantity },
        });
      }
    }

    return product.id;
  });

  return getCatalogProduct(prisma, merchantId, productId);
}
