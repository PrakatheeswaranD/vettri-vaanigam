/**
 * Catalog Compiler routes.
 *
 * The `.well-known` documents are PUBLIC by design — discovery is the
 * point. They expose only what a merchant already publishes to shoppers
 * (names, prices, availability), never policy, ceilings, decisions or
 * anything about other agents.
 *
 * Compilation itself is authenticated: uploading a catalogue is a merchant
 * action, and it spends model calls.
 */
import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../db/client.js";
import { AppError } from "../../http/errors.js";
import { getAuthenticatedMerchantId } from "../authorization/demo-context.js";
import { requireOwnerRole } from "../auth/middleware.js";
import { appendLedgerEvent } from "../audit/ledger.js";
import {
  buildPublishedAgentCatalog,
  compileCatalogCsv,
  publishCatalogCompilation,
  rollbackCatalogCompilation,
} from "./service.js";

const slugParams = z.object({ merchantSlug: z.string().min(1).max(120) });
const compileBody = z.object({ csv: z.string().min(1).max(200_000) });
const publishBody = z.object({
  offers: z
    .array(
      z.object({
        sku: z.string().min(1).max(120),
        costMinor: z.number().int().min(0).max(1_000_000_000),
        availableQuantity: z.number().int().min(0).max(1_000_000_000),
      }),
    )
    .min(1)
    .max(5_000),
});

export function registerCatalogCompilerRoutes(app: FastifyInstance, prefix: string): void {
  app.get(`${prefix}/agent-catalog/:merchantSlug/.well-known/agent-catalog.json`, async (request, reply) => {
    const params = slugParams.safeParse(request.params);
    if (!params.success) throw AppError.validation("A merchant must be named in the catalogue URL.");

    const published = await buildPublishedAgentCatalog(prisma, params.data.merchantSlug);
    if (!published) throw AppError.notFound(`No active merchant is published at "${params.data.merchantSlug}".`);

    return reply.header("content-type", "application/ld+json; charset=utf-8").send(published.catalog);
  });

  app.get(`${prefix}/agent-catalog/:merchantSlug/.well-known/mcp-manifest.json`, async (request) => {
    const params = slugParams.safeParse(request.params);
    if (!params.success) throw AppError.validation("A merchant must be named in the manifest URL.");

    const published = await buildPublishedAgentCatalog(prisma, params.data.merchantSlug);
    if (!published) throw AppError.notFound(`No active merchant is published at "${params.data.merchantSlug}".`);

    return published.manifest;
  });

  app.post(`${prefix}/agent-catalog/compile`, async (request) => {
    const merchantId = getAuthenticatedMerchantId(request);
    requireOwnerRole(request);
    const body = compileBody.parse(request.body);
    return compileCatalogCsv(prisma, merchantId, body.csv);
  });

  app.get(`${prefix}/agent-catalog/compilations`, async (request) => {
    const merchantId = getAuthenticatedMerchantId(request);
    return {
      items: await prisma.catalogCompilation.findMany({
        where: { merchantId },
        select: {
          id: true,
          status: true,
          rowsRead: true,
          rowsCompiled: true,
          issues: true,
          providerMode: true,
          publishedAt: true,
          rolledBackAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
    };
  });

  app.post(`${prefix}/agent-catalog/compilations/:compilationId/publish`, async (request) => {
    const merchantId = getAuthenticatedMerchantId(request);
    requireOwnerRole(request);
    const { compilationId } = request.params as { compilationId: string };
    const body = publishBody.parse(request.body);
    try {
      const published = await publishCatalogCompilation(prisma, merchantId, compilationId, body.offers);
      await appendLedgerEvent(prisma, {
        workflowId: `catalog-compilation-${compilationId}`,
        merchantId,
        actorType: "MERCHANT_USER",
        actionType: "AGENT_CATALOG_PUBLISHED",
        status: "EXECUTED",
        conciseReason: `An owner published ${published.rowsCompiled} compiled catalog row(s) with explicit cost and inventory controls.`,
        relatedEntityType: "CatalogCompilation",
        relatedEntityId: compilationId,
        executedAt: new Date(),
      });
      return published;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2034" || error.code === "P2002")) {
        throw AppError.conflict("Another catalog publication won the current-version claim. Refresh and retry this draft.");
      }
      const code = error instanceof Error ? error.message : "";
      if (code === "CATALOG_COMPILATION_NOT_FOUND") throw AppError.notFound(`No catalog compilation ${compilationId}.`);
      if (
        code === "CATALOG_NOT_PURCHASABLE" ||
        code === "CATALOG_DUPLICATE_SKU" ||
        code === "CATALOG_UNSUPPORTED_CURRENCY" ||
        code === "CATALOG_OFFER_CONTROLS_INCOMPLETE" ||
        code.startsWith("CATALOG_SKU_ALREADY_EXISTS:")
      ) {
        throw AppError.validation(
          code === "CATALOG_NOT_PURCHASABLE"
            ? "This compilation has no priced offers and cannot be published."
            : code === "CATALOG_DUPLICATE_SKU"
              ? "This compilation contains duplicate SKUs and cannot be published."
              : code === "CATALOG_UNSUPPORTED_CURRENCY"
                ? "This compilation contains a currency this merchant API does not support."
                : code === "CATALOG_OFFER_CONTROLS_INCOMPLETE"
                  ? "Publish requires exactly one explicit cost and inventory control for every compiled SKU."
                  : `SKU ${code.split(":")[1] ?? "unknown"} already exists and cannot be published as a duplicate.`,
        );
      }
      if (code === "CATALOG_COMPILATION_NOT_DRAFT") {
        throw AppError.conflict("Only a draft compilation can be published.");
      }
      throw error;
    }
  });

  app.post(`${prefix}/agent-catalog/compilations/:compilationId/rollback`, async (request) => {
    const merchantId = getAuthenticatedMerchantId(request);
    requireOwnerRole(request);
    const { compilationId } = request.params as { compilationId: string };
    try {
      const rolledBack = await rollbackCatalogCompilation(prisma, merchantId, compilationId);
      await appendLedgerEvent(prisma, {
        workflowId: `catalog-compilation-${compilationId}`,
        merchantId,
        actorType: "MERCHANT_USER",
        actionType: "AGENT_CATALOG_ROLLED_BACK",
        status: "EXECUTED",
        conciseReason: "An owner rolled back this published agent catalog compilation and restored the prior published version when available.",
        relatedEntityType: "CatalogCompilation",
        relatedEntityId: compilationId,
        executedAt: new Date(),
      });
      return rolledBack;
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      if (code === "CATALOG_COMPILATION_NOT_FOUND") throw AppError.notFound(`No catalog compilation ${compilationId}.`);
      if (code === "CATALOG_COMPILATION_NOT_PUBLISHED") {
        throw AppError.conflict("Only the currently published compilation can be rolled back.");
      }
      throw error;
    }
  });
}
