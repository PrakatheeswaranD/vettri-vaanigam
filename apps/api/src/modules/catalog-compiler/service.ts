/**
 * Catalog Compiler — messy merchant export in, agent-readable catalogue
 * out.
 *
 * WHY A MODEL BELONGS HERE
 *
 * This is the one place in the gateway where a rules engine genuinely
 * cannot do the job. Real catalogue rows read like
 * `"500ml combo of 2 — festive offer!!"`: the structure is in the
 * language, not the schema. Everything downstream of this file is
 * deterministic, precisely so that the one probabilistic step is confined
 * to a place where being wrong costs a bad field, not a bad payment.
 *
 * WHAT IT REFUSES TO DO
 *
 * It never invents. A row the model could not read comes back as an ISSUE
 * against that row, so the merchant can fix their data — publishing a
 * confident guess to every AI buyer on the internet is worse than
 * publishing nothing, because the buyer cannot tell the difference.
 */
import type { PrismaClient } from "@prisma/client";
import {
  buildAgentCatalogDocument,
  buildMcpToolManifest,
  type CompiledProduct,
  type AgentCatalogDocument,
  type McpToolManifest,
} from "@razorgrowth/domain";
import { getAIProvider } from "../agents/provider-factory.js";
import { logger } from "../../observability/logger.js";

export interface CompileIssue {
  rowNumber: number;
  field: string;
  detail: string;
}

export interface CompileResult {
  compilationId: string;
  rowsRead: number;
  rowsCompiled: number;
  issues: CompileIssue[];
  products: CompiledProduct[];
  providerMode: string;
}

/**
 * Minimal RFC-4180-ish CSV reader.
 *
 * Written rather than pulled in: the compiler needs quoted fields and
 * embedded commas and nothing else, and a dependency for forty lines that
 * must be audited anyway is a poor trade in a codebase that already parses
 * its own webhook signatures.
 */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += char;
      continue;
    }
    if (char === '"') inQuotes = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") field += char;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const nonEmpty = rows.filter((r) => r.some((c) => c.trim().length > 0));
  if (nonEmpty.length === 0) return [];

  const headers = nonEmpty[0]!.map((h) => h.trim());
  return nonEmpty.slice(1).map((values) =>
    Object.fromEntries(headers.map((h, i) => [h, (values[i] ?? "").trim()])),
  );
}

export async function compileCatalogCsv(
  prisma: PrismaClient,
  merchantId: string,
  csv: string,
): Promise<CompileResult> {
  const rows = parseCsv(csv);
  const categories = await prisma.product.findMany({
    where: { merchantId },
    select: { category: true },
    distinct: ["category"],
  });
  const knownCategories = categories.map((c) => c.category);

  const provider = getAIProvider();
  const issues: CompileIssue[] = [];
  const products: CompiledProduct[] = [];

  for (const [index, row] of rows.entries()) {
    const rowNumber = index + 2; // +1 for zero-index, +1 for the header line
    try {
      const normalized = await provider.normalizeCatalogRow({ row, knownCategories });

      if (!normalized.name || normalized.name.trim().length === 0) {
        issues.push({ rowNumber, field: "name", detail: "No product name could be read from this row." });
        continue;
      }
      if (normalized.priceMajor === null) {
        issues.push({ rowNumber, field: "priceMajor", detail: "No price could be read. An agent cannot buy what has no price." });
      }
      if (normalized.category === null) {
        issues.push({
          rowNumber,
          field: "category",
          detail: `No known category matched this row. Known categories: ${knownCategories.join(", ") || "none configured"}.`,
        });
      }

      // A row with no price is published as a product with no offer rather
      // than dropped: an agent can still discover it and ask, and the
      // merchant sees exactly which rows are unbuyable.
      const attributes: Record<string, string> = {};
      if (normalized.size) attributes.size = normalized.size;
      if (normalized.color) attributes.color = normalized.color;
      if (normalized.packQuantity && normalized.packQuantity > 1) attributes.packQuantity = String(normalized.packQuantity);

      products.push({
        productId: `csv-row-${rowNumber}`,
        name: normalized.name.trim(),
        description: normalized.description,
        category: normalized.category,
        brand: null,
        offers:
          normalized.priceMajor === null
            ? []
            : [
                {
                  sku: `${(normalized.name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "-") || "ROW").slice(0, 24)}-${rowNumber}`,
                  priceMinor: Math.round(normalized.priceMajor * 100),
                  currency: normalized.currency ?? "INR",
                  // Nothing in a CSV price list states stock. Null, not a
                  // flattering default.
                  inStock: null,
                  attributes,
                },
              ],
      });
    } catch (err) {
      issues.push({
        rowNumber,
        field: "*",
        detail: `This row could not be normalised (${err instanceof Error ? err.message : String(err)}).`,
      });
    }
  }

  logger.info(
    { event: "anumati.catalog_compiled", merchantId, rowsRead: rows.length, rowsCompiled: products.length, issues: issues.length },
    "Catalogue compiled",
  );

  const compilation = await prisma.catalogCompilation.create({
    data: {
      merchantId,
      rowsRead: rows.length,
      rowsCompiled: products.length,
      issues: issues as never,
      products: products as never,
      providerMode: provider.mode,
    },
  });

  return {
    compilationId: compilation.id,
    rowsRead: rows.length,
    rowsCompiled: products.length,
    issues,
    products,
    providerMode: provider.mode,
  };
}

function compiledProductSlug(compilationId: string, index: number): string {
  return `compiled-${compilationId.replace(/-/g, "").slice(0, 12)}-${index + 1}`;
}

/** Publish is an explicit, transactional state change. Compilation alone
 * never leaks uncertain model output into the live agent catalogue. */
export interface PublishOfferControl {
  sku: string;
  costMinor: number;
  availableQuantity: number;
}

export async function publishCatalogCompilation(
  prisma: PrismaClient,
  merchantId: string,
  compilationId: string,
  offerControls: PublishOfferControl[],
) {
  return prisma.$transaction(async (tx) => {
    const compilation = await tx.catalogCompilation.findUnique({ where: { id: compilationId } });
    if (!compilation || compilation.merchantId !== merchantId) throw new Error("CATALOG_COMPILATION_NOT_FOUND");
    if (compilation.status !== "DRAFT") throw new Error("CATALOG_COMPILATION_NOT_DRAFT");

    const products = compilation.products as unknown as CompiledProduct[];
    const purchasable = products.filter((product) => product.offers.length > 0);
    if (purchasable.length === 0) throw new Error("CATALOG_NOT_PURCHASABLE");

    const skus = purchasable.flatMap((product) => product.offers.map((offer) => offer.sku));
    if (new Set(skus).size !== skus.length) throw new Error("CATALOG_DUPLICATE_SKU");
    if (purchasable.some((product) => product.offers.some((offer) => offer.currency !== "INR" && offer.currency !== "USD"))) {
      throw new Error("CATALOG_UNSUPPORTED_CURRENCY");
    }
    const controls = new Map(offerControls.map((control) => [control.sku, control]));
    if (controls.size !== offerControls.length || controls.size !== skus.length || skus.some((sku) => !controls.has(sku))) {
      throw new Error("CATALOG_OFFER_CONTROLS_INCOMPLETE");
    }
    const previous = await tx.catalogCompilation.findFirst({
      where: { merchantId, status: "PUBLISHED" },
      orderBy: { publishedAt: "desc" },
    });
    const conflictingSku = await tx.productVariant.findFirst({
      where: {
        sku: { in: skus },
        product: {
          merchantId,
          ...(previous?.appliedProductIds.length ? { id: { notIn: previous.appliedProductIds } } : {}),
        },
      },
      select: { sku: true },
    });
    if (conflictingSku) throw new Error(`CATALOG_SKU_ALREADY_EXISTS:${conflictingSku.sku}`);
    if (previous) {
      await tx.product.updateMany({
        where: { merchantId, id: { in: previous.appliedProductIds } },
        data: { status: "ARCHIVED" },
      });
      await tx.catalogCompilation.update({ where: { id: previous.id }, data: { status: "SUPERSEDED" } });
    }

    const appliedProductIds: string[] = [];
    for (const [index, product] of purchasable.entries()) {
      const created = await tx.product.create({
        data: {
          merchantId,
          name: product.name,
          slug: compiledProductSlug(compilation.id, index),
          description: product.description ?? "",
          category: product.category ?? "Uncategorized",
          brand: product.brand ?? "Imported",
          status: "ACTIVE",
          variants: {
            create: product.offers.map((offer) => {
              const control = controls.get(offer.sku)!;
              return {
                sku: offer.sku,
                title: `${product.name} — ${offer.sku}`,
                priceMinor: offer.priceMinor,
                currency: offer.currency as "INR" | "USD",
                attributes: offer.attributes,
                costMinor: control.costMinor,
                active: true,
                inventory: { create: { availableQuantity: control.availableQuantity } },
              };
            }),
          },
        },
      });
      appliedProductIds.push(created.id);
    }

    return tx.catalogCompilation.update({
      where: { id: compilation.id },
      data: {
        status: "PUBLISHED",
        publishedAt: new Date(),
        appliedProductIds,
        beforeSnapshot: { previousCompilationId: previous?.id ?? null },
      },
    });
  }, { isolationLevel: "Serializable" });
}

export async function rollbackCatalogCompilation(prisma: PrismaClient, merchantId: string, compilationId: string) {
  return prisma.$transaction(async (tx) => {
    const compilation = await tx.catalogCompilation.findUnique({ where: { id: compilationId } });
    if (!compilation || compilation.merchantId !== merchantId) throw new Error("CATALOG_COMPILATION_NOT_FOUND");
    if (compilation.status !== "PUBLISHED") throw new Error("CATALOG_COMPILATION_NOT_PUBLISHED");

    await tx.product.updateMany({
      where: { merchantId, id: { in: compilation.appliedProductIds } },
      data: { status: "ARCHIVED" },
    });

    const rolledBack = await tx.catalogCompilation.update({
      where: { id: compilation.id },
      data: { status: "ROLLED_BACK", rolledBackAt: new Date() },
    });

    const snapshot = compilation.beforeSnapshot as { previousCompilationId?: string | null } | null;
    if (snapshot?.previousCompilationId) {
      const previous = await tx.catalogCompilation.findUnique({ where: { id: snapshot.previousCompilationId } });
      if (previous && previous.merchantId === merchantId && previous.status === "SUPERSEDED") {
        await tx.product.updateMany({
          where: { merchantId, id: { in: previous.appliedProductIds } },
          data: { status: "ACTIVE" },
        });
        await tx.catalogCompilation.update({ where: { id: previous.id }, data: { status: "PUBLISHED" } });
      }
    }

    return rolledBack;
  });
}

/** The published `.well-known` document, built from the LIVE catalogue —
 * not from whatever CSV was last uploaded, so it can never drift from what
 * the gateway will actually sell. */
export async function buildPublishedAgentCatalog(
  prisma: PrismaClient,
  merchantSlug: string,
): Promise<{ catalog: AgentCatalogDocument; manifest: McpToolManifest } | null> {
  const merchant = await prisma.merchant.findUnique({
    where: { slug: merchantSlug },
    select: { id: true, name: true, slug: true, status: true },
  });
  if (!merchant || merchant.status !== "ACTIVE") return null;

  const rows = await prisma.product.findMany({
    where: { merchantId: merchant.id, status: "ACTIVE" },
    include: {
      variants: { where: { active: true }, include: { inventory: true } },
    },
    orderBy: { name: "asc" },
  });

  const products: CompiledProduct[] = rows.map((product) => ({
    productId: product.id,
    name: product.name,
    description: product.description,
    category: product.category,
    brand: product.brand,
    offers: product.variants.map((variant) => ({
      sku: variant.sku,
      priceMinor: variant.priceMinor,
      currency: variant.currency,
      // `inventory` absent entirely means nobody ever recorded stock for
      // this variant — a real unknown, published as one.
      inStock: variant.inventory ? variant.inventory.availableQuantity > 0 : null,
      attributes: (variant.attributes as Record<string, string> | null) ?? {},
    })),
  }));

  const baseUrl = process.env.PUBLIC_BASE_URL ?? "http://localhost:4000";
  return {
    catalog: buildAgentCatalogDocument(merchant.name, merchant.slug, products),
    manifest: buildMcpToolManifest(merchant.name, baseUrl, merchant.slug),
  };
}
