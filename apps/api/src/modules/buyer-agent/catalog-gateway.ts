/**
 * CommerceCatalogGateway for the Buyer Agent (PART 03 §28-§29, §31).
 *
 * The ONLY way the Buyer Agent reaches commerce data — it depends on
 * PART 02's `agent-commerce` service (itself already backed by the
 * server-side-filtered, visibility-enforced catalog repository), never on
 * Prisma directly.
 *
 * Only CATEGORY is pushed down as a real SQL filter here — deliberately
 * NOT price. Pushing the buyer's budget ceiling into the SQL filter would
 * make near-match discovery (PART 03 §32-§34) impossible: a product whose
 * only violation is "slightly over budget" must still be visible to
 * `candidate-evaluation.ts`, or the system could never disclose an honest
 * near match. Price, required-attribute (size/color), and exclusion
 * filtering all happen deterministically in application code afterward —
 * a documented scope boundary (see docs/ARCHITECTURE.md), not an
 * accidental gap: category filtering already bounds this catalog's ~25
 * products down to a handful before any of that runs.
 */
import type { PrismaClient } from "@prisma/client";
import type { AgentReadableProductDTO } from "@razorgrowth/contracts";
import { listAgentCatalog } from "../agent-commerce/service.js";
import { listCategories } from "../catalog/repository.js";

/** Bounded server-side fetch before in-app price/attribute filtering
 * (PART 03 §31-§32) — generous enough to cover this catalog's full size
 * (~25 products) without ever sending an unbounded set downstream. */
export const CATALOG_SEARCH_LIMIT = 100;

export interface CatalogSearchCriteria {
  category: string | null;
}

export async function searchCandidateProducts(
  prisma: PrismaClient,
  merchantId: string,
  criteria: CatalogSearchCriteria,
): Promise<AgentReadableProductDTO[]> {
  const { items } = await listAgentCatalog(prisma, {
    merchantId,
    category: criteria.category ?? undefined,
    page: 1,
    limit: CATALOG_SEARCH_LIMIT,
  });
  return items;
}

export async function getKnownCategories(prisma: PrismaClient, merchantId: string): Promise<string[]> {
  const rows = await listCategories(prisma, merchantId);
  return rows.map((r) => r.category);
}
