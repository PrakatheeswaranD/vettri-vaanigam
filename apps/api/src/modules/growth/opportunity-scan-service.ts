/**
 * Runs the catalogue scan and records what it found.
 *
 * WHAT THIS CLOSES
 *
 * `GrowthOpportunity` rows previously came only from the seed script —
 * nothing in the running system ever wrote one. The Growth page therefore
 * showed fifteen fixed rows beside the real proposal pipeline, and nothing
 * distinguished them.
 *
 * Now the Merchant Agent's catalogue scan writes real rows, marked
 * `isSyntheticDemo: false`, and the console can tell the two apart. Seeded
 * rows are left alone rather than deleted: they are honest demo content as
 * long as they are labelled, and silently removing a merchant's existing
 * feed to make room for ours would be worse than the problem.
 *
 * WHY THIS IS THE `catalog.published` TRIGGER
 *
 * Publishing is exactly when a scan is worth running and exactly when its
 * result is most useful: the merchant has just changed what agents can see,
 * so telling them what is now unbuyable, unmatched or unlinked closes the
 * loop between "agent-readable catalogue" and "grows revenue" in one
 * visible step.
 */
import type { PrismaClient } from "@prisma/client";
import { scanCatalogueForOpportunities, type ScanProduct } from "@razorgrowth/domain";
import { appendLedgerEvent } from "../audit/ledger.js";
import { logger } from "../../observability/logger.js";

export interface OpportunityScanResult {
  productsScanned: number;
  opportunitiesFound: number;
  opportunitiesRecorded: number;
}

async function collectScanInput(prisma: PrismaClient, merchantId: string): Promise<ScanProduct[]> {
  const products = await prisma.product.findMany({
    where: { merchantId, status: "ACTIVE" },
    include: {
      variants: { include: { inventory: true } },
      relationshipsAsSource: { select: { id: true } },
    },
  });

  return products.map((product) => {
    const activeVariants = product.variants.filter((v) => v.active);
    return {
      productId: product.id,
      name: product.name,
      category: product.category,
      buyableVariantCount: activeVariants.filter((v) => v.priceMinor > 0).length,
      // No inventory ROW at all is the unknown case — distinct from a
      // recorded zero, which genuinely means out of stock.
      variantsWithUnknownStock: activeVariants.filter((v) => !v.inventory).length,
      variantsWithoutAttributes: activeVariants.filter(
        (v) => Object.keys((v.attributes as Record<string, unknown> | null) ?? {}).length === 0,
      ).length,
      outgoingRelationshipCount: product.relationshipsAsSource.length,
    };
  });
}

export async function runOpportunityScan(
  prisma: PrismaClient,
  merchantId: string,
  options: { workflowId?: string } = {},
): Promise<OpportunityScanResult> {
  const scanInput = await collectScanInput(prisma, merchantId);
  const found = scanCatalogueForOpportunities(scanInput);

  // Replace only what a PREVIOUS SCAN wrote. Seeded demo rows and any
  // opportunity a merchant has already acted on are untouched — a rescan
  // must never erase history it did not create.
  const recorded = await prisma.$transaction(async (tx) => {
    await tx.growthOpportunity.deleteMany({
      where: { merchantId, isSyntheticDemo: false, status: "IDENTIFIED" },
    });

    if (found.length > 0) {
      await tx.growthOpportunity.createMany({
        data: found.map((opportunity) => ({
          merchantId,
          category: opportunity.category,
          signal: opportunity.signal,
          recommendation: opportunity.recommendation,
          // Deliberately no estimatedValueMinor: there is no basis for one,
          // and an invented figure is what made the old feed misleading.
          estimatedValueMinor: null,
          currency: null,
          valueClassification: "OPPORTUNITY" as const,
          status: "IDENTIFIED" as const,
          isSyntheticDemo: false,
        })),
      });
    }

    await appendLedgerEvent(tx, {
      workflowId: options.workflowId ?? `catalog-scan-${Date.now()}`,
      merchantId,
      actorType: "MERCHANT_AGENT",
      actionType: "GROWTH_OPPORTUNITY_SCAN",
      status: "EXECUTED",
      conciseReason: `Scanned ${scanInput.length} products and identified ${found.length} opportunit${found.length === 1 ? "y" : "ies"}.`,
      relatedEntityType: "Merchant",
      relatedEntityId: merchantId,
      executedAt: new Date(),
    });

    return found.length;
  });

  logger.info(
    { event: "vaanigam.opportunity_scan", merchantId, productsScanned: scanInput.length, opportunitiesFound: found.length },
    "Catalogue opportunity scan completed",
  );

  return {
    productsScanned: scanInput.length,
    opportunitiesFound: found.length,
    opportunitiesRecorded: recorded,
  };
}
