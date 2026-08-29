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
import { z } from "zod";
import { prisma } from "../../db/client.js";
import { AppError } from "../../http/errors.js";
import { getAuthenticatedMerchantId } from "../authorization/demo-context.js";
import { buildPublishedAgentCatalog, compileCatalogCsv } from "./service.js";

const slugParams = z.object({ merchantSlug: z.string().min(1).max(120) });
const compileBody = z.object({ csv: z.string().min(1).max(200_000) });

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
    const body = compileBody.parse(request.body);
    return compileCatalogCsv(prisma, merchantId, body.csv);
  });
}
