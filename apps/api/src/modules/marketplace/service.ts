import type { PrismaClient } from "@prisma/client";
import type { MarketplaceDiscoveryResponseDTO } from "@razorgrowth/contracts";
import { listAgentCatalog } from "../agent-commerce/service.js";

export async function discoverMarketplace(
  prisma: PrismaClient,
  filters: { category?: string; limitPerMerchant: number },
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
    });
    if (results.length === 5) break;
  }

  return {
    merchants: results,
    merchantCount: results.length,
    productCount: results.reduce((total, merchant) => total + merchant.products.length, 0),
    generatedAt: new Date().toISOString(),
  };
}
