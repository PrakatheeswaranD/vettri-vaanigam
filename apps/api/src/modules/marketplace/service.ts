import type { PrismaClient } from "@prisma/client";
import type { MarketplaceDiscoveryResponseDTO } from "@razorgrowth/contracts";
import { listAgentCatalog } from "../agent-commerce/service.js";
import { toAgentReadableProduct } from "../agent-commerce/mapper.js";
import { productWithVariants } from "../catalog/repository.js";
import { AppError } from "../../http/errors.js";

export async function discoverMarketplace(
  prisma: PrismaClient,
  filters: { category?: string; search?: string; limitPerMerchant: number },
): Promise<MarketplaceDiscoveryResponseDTO> {
  const merchants = await prisma.merchant.findMany({
    where: {
      status: "ACTIVE",
      products: { some: { status: "ACTIVE", ...(filters.category ? { category: filters.category } : {}) } },
    },
    orderBy: { name: "asc" },
    // Fetch a bounded search window, then retain at most five merchants
    // whose published catalog actually matches the requested category.
    // Taking five before catalog filtering can let unrelated merchants hide
    // valid sellers merely because their names sort earlier.
    take: 50,
    select: { id: true, name: true, slug: true, businessCategory: true },
  });

  const results = [];
  for (const merchant of merchants) {
    const catalog = await listAgentCatalog(prisma, {
      merchantId: merchant.id,
      category: filters.category,
      search: filters.search,
      page: 1,
      limit: filters.limitPerMerchant,
    });
    if (catalog.items.length === 0) continue;
    results.push({
      merchantId: merchant.id,
      name: merchant.name,
      slug: merchant.slug,
      businessCategory: merchant.businessCategory,
      agenticCheckout: true,
      products: catalog.items,
      // How many this merchant actually publishes, not how many fit in
      // the page. Without it the console reported the truncated count as
      // the catalogue size — a merchant with 25 products was described as
      // having 10, with nothing on screen suggesting otherwise.
      productTotal: catalog.pagination.total,
    });
    if (results.length === 5) break;
  }

  return {
    merchants: results,
    merchantCount: results.length,
    productCount: results.reduce((total, merchant) => total + merchant.products.length, 0),
    productTotal: results.reduce((total, merchant) => total + merchant.productTotal, 0),
    generatedAt: new Date().toISOString(),
  };
}

/**
 * One product, as a SHOPPER may read it.
 *
 * A customer session is confined to `/marketplace/*` and `/buyer/*` by the
 * auth middleware, which is correct — but it left the "View details" link
 * on every recommendation with nowhere legitimate to point. The merchant
 * catalog route it used answers 403 for a shopper, so the only product a
 * customer could look at closely was one they had already been shown a
 * summary of.
 *
 * Scoped the same way discovery is: an ACTIVE product belonging to an
 * ACTIVE merchant, mapped through the same agent-readable mapper so a
 * shopper and an agent are looking at exactly one description of the
 * product. No merchant-internal fields are reachable through here.
 */
export async function getMarketplaceProduct(prisma: PrismaClient, productId: string) {
  const product = await prisma.product.findFirst({
    where: { id: productId, status: "ACTIVE", merchant: { status: "ACTIVE" } },
    ...productWithVariants,
  });
  if (!product) throw AppError.notFound(`Product not found: ${productId}`);

  const merchant = await prisma.merchant.findUniqueOrThrow({
    where: { id: product.merchantId },
    select: { id: true, name: true, slug: true },
  });
  return { merchant, product: toAgentReadableProduct(product) };
}
