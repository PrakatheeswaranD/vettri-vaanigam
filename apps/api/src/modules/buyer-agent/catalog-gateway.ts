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
 * accidental gap: category filtering already bounds the 200-product demo
 * catalogue to one focused category before any of that runs.
 */
import type { PrismaClient } from "@prisma/client";
import type { AgentReadableProductDTO } from "@razorgrowth/contracts";
import { listAgentCatalog } from "../agent-commerce/service.js";
import { listCategories } from "../catalog/repository.js";

/** Bounded server-side fetch before in-app price/attribute filtering.
 * Large enough for the controlled demo catalogue while remaining an
 * explicit hard cap for imported merchant data. */
export const CATALOG_SEARCH_LIMIT = 250;

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

/**
 * The category vocabulary for a MARKETPLACE conversation.
 *
 * A shopper signs in as their own identity context, and that context sells
 * nothing. Scoping the vocabulary to it — as the merchant-side path
 * correctly does — hands the extractor an EMPTY category list, so the
 * model has no legal value to return, no category survives normalization,
 * and `needsClarification` asks "what type of product are you looking
 * for?" forever no matter how plainly the shopper answers. The customer
 * journey never reaches a product.
 *
 * The same mistake, in the same shape, was fixed once already for buyer
 * spending policies (migration 20260831070000): a buyer context is not a
 * merchant, so anything scoped "to the buyer's merchantId" is scoped to
 * nothing. A marketplace shopper can buy from any active merchant, so the
 * vocabulary is what is purchasable across active merchants.
 */
export async function getMarketplaceCategories(prisma: PrismaClient): Promise<string[]> {
  const rows = await prisma.product.findMany({
    where: { status: "ACTIVE", merchant: { status: "ACTIVE" } },
    select: { category: true },
    distinct: ["category"],
    orderBy: { category: "asc" },
    take: CATALOG_SEARCH_LIMIT,
  });
  return rows.map((row) => row.category);
}

/** How many distinct values to show per attribute key. Enough to convey
 * the value FORMAT (that sizes read `UK9`, not `9`) without pasting the
 * whole catalog into every prompt. */
const VOCABULARY_SAMPLE_LIMIT = 20;

/**
 * Samples values EVENLY across the sorted list rather than taking the
 * first N.
 *
 * Taking the first N silently hid the values that mattered most: this
 * catalog's sizes sort as `250ml, 750ml, L, L/XL, M, One Size, S, S/M,
 * UK10, …`, so a first-8 sample stopped at `S/M` and showed the model no
 * `UK*` value at all. It then answered `size: "9"`, the deterministic
 * filter matched nothing, and a live query that should have succeeded
 * returned NO_MATCH. An even spread always reaches the end of the range,
 * so every format present is represented.
 */
export function sampleValues(values: string[], limit: number): string[] {
  if (values.length <= limit) return values;
  const step = (values.length - 1) / (limit - 1);
  const picked = new Set<string>();
  for (let i = 0; i < limit; i++) picked.add(values[Math.round(i * step)]!);
  return [...picked];
}

/**
 * The merchant's real attribute vocabulary — every variant attribute key,
 * with a sample of the values actually stored under it.
 *
 * A live evaluation showed why this is needed: attribute accuracy was
 * 40%, and the misses were naming the model could not possibly know —
 * most damagingly `size: "9"` where every variant is stored as `"UK9"`,
 * which filters to nothing. Key naming and value format are facts about a
 * merchant's data, so they are supplied, exactly as `knownCategories` is.
 *
 * Note this returns only what the catalog ACTUALLY stores. For the demo
 * merchant that is `color` and `size` alone, so a subjective preference
 * ("lightweight", "waterproof") has no key to land in and the model still
 * invents one. That is a catalog-richness gap, not a prompt gap: until a
 * merchant records such attributes, no preference on them can ever match
 * a product (`matchesAnyPreference` compares by key), and the two
 * evaluation cases asserting `weight`/`surface` keys stay red on purpose
 * rather than being papered over.
 */
export async function getKnownAttributes(
  prisma: PrismaClient,
  merchantId: string | null,
): Promise<Record<string, string[]>> {
  // `null` means a marketplace conversation: sample the attribute naming
  // across active merchants rather than from the shopper's own context,
  // which owns no variants. See getMarketplaceCategories.
  const variants = await prisma.productVariant.findMany({
    where: merchantId === null
      ? { product: { status: "ACTIVE", merchant: { status: "ACTIVE" } } }
      : { product: { merchantId } },
    select: { attributes: true },
  });

  const vocabulary = new Map<string, Set<string>>();
  for (const variant of variants) {
    const attributes = variant.attributes as Record<string, unknown> | null;
    if (!attributes || typeof attributes !== "object") continue;
    for (const [key, value] of Object.entries(attributes)) {
      if (typeof value !== "string" || value.length === 0) continue;
      const values = vocabulary.get(key) ?? new Set<string>();
      values.add(value);
      vocabulary.set(key, values);
    }
  }

  return Object.fromEntries(
    [...vocabulary.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, values]) => [key, sampleValues([...values].sort(), VOCABULARY_SAMPLE_LIMIT)]),
  );
}
