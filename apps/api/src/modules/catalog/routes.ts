import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { paginationQuerySchema, availabilityStateSchema } from "@razorgrowth/contracts";
import { prisma } from "../../db/client.js";
import { getAuthenticatedMerchantId } from "../authorization/demo-context.js";
import { AppError } from "../../http/errors.js";
import { createCatalogProduct, getCatalogProduct, getCatalogQualitySummary, listCatalogCategories, listCatalogProducts } from "./service.js";
import { getCatalogGapReport } from "./gap-service.js";
import { requireApprovalRole } from "../auth/middleware.js";
import { appendLedgerEvent } from "../audit/ledger.js";
import { randomUUID } from "node:crypto";

const listQuerySchema = paginationQuerySchema.extend({
  category: z.string().max(100).optional(),
  search: z.string().max(200).optional(),
  minPriceMinor: z.coerce.number().int().min(0).optional(),
  maxPriceMinor: z.coerce.number().int().min(0).optional(),
  availability: availabilityStateSchema.optional(),
});

const productParamsSchema = z.object({
  id: z.string().uuid(),
});

/**
 * What the console's "Add Product" dialog has always been sending.
 *
 * Prices are integer MINOR units here, as everywhere else on the wire —
 * the dialog does the rupee conversion before it posts, so this layer
 * never sees a float and never has to round money.
 */
const createProductSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).default(""),
  category: z.string().trim().min(1).max(100),
  brand: z.string().trim().max(120).optional(),
  returnPolicySummary: z.string().trim().max(1000).optional(),
  shippingSummary: z.string().trim().max(1000).optional(),
  variants: z.array(z.object({
    sku: z.string().trim().min(1).max(80),
    title: z.string().trim().min(1).max(200),
    priceMinor: z.number().int().min(0),
    // Optional, and NEVER defaulted to zero: unknown cost must stay
    // unknown so the negotiator fails closed instead of reading a
    // zero-cost item as pure margin.
    costMinor: z.number().int().min(0).optional(),
    currency: z.enum(["INR", "USD"]).default("INR"),
    attributes: z.record(z.string().max(80)).optional(),
    inventory: z.object({ availableQuantity: z.number().int().min(0) }).optional(),
  })).min(1).max(50),
});

export function registerCatalogRoutes(app: FastifyInstance, prefix: string): void {
  app.get(`${prefix}/catalog/products`, async (request) => {
    const merchantId = getAuthenticatedMerchantId(request);
    const query = listQuerySchema.parse(request.query);
    return listCatalogProducts(prisma, { merchantId, ...query });
  });

  app.get(`${prefix}/catalog/categories`, async (request) => {
    const merchantId = getAuthenticatedMerchantId(request);
    return { items: await listCatalogCategories(prisma, merchantId) };
  });

  app.get(`${prefix}/catalog/quality-summary`, async (request) => {
    const merchantId = getAuthenticatedMerchantId(request);
    return getCatalogQualitySummary(prisma, merchantId);
  });

  /**
   * Catalogue gaps, per product, with the merchant's own attribute
   * vocabulary as the suggested shape. See `gap-service.ts` for why the
   * suggestion is never generated.
   */
  app.get(`${prefix}/catalog/gaps`, async (request) => {
    const merchantId = getAuthenticatedMerchantId(request);
    return getCatalogGapReport(prisma, merchantId);
  });

  app.get(`${prefix}/catalog/products/:id`, async (request) => {
    const merchantId = getAuthenticatedMerchantId(request);
    const params = productParamsSchema.safeParse(request.params);
    if (!params.success) {
      throw AppError.validation("Invalid product id.");
    }
    return getCatalogProduct(prisma, merchantId, params.data.id);
  });

  /**
   * Create a product. The console dialog for this shipped without the
   * route behind it, so the button answered 404 for every merchant who
   * pressed it.
   *
   * Gated to OWNER/APPROVER: adding a sellable product is a commercial
   * change — it publishes a price that AI agents will transact against —
   * and a VIEWER session must not be able to make one. Written to the
   * ledger for the same reason.
   */
  app.post(`${prefix}/catalog/products`, async (request, reply) => {
    requireApprovalRole(request);
    const merchantId = getAuthenticatedMerchantId(request);
    const body = createProductSchema.parse(request.body);
    const product = await createCatalogProduct(prisma, merchantId, body);
    await appendLedgerEvent(prisma, {
      workflowId: randomUUID(),
      merchantId,
      actorType: "SYSTEM",
      actionType: "CATALOG_PRODUCT_CREATED",
      status: "EXECUTED",
      conciseReason: `Product "${product.name}" created with ${product.variants.length} variant(s).`,
      relatedEntityType: "Product",
      relatedEntityId: product.id,
      executedAt: new Date(),
    });
    reply.code(201);
    return product;
  });
}
