import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { paginationQuerySchema, availabilityStateSchema } from "@razorgrowth/contracts";
import { prisma } from "../../db/client.js";
import { getDemoMerchantId } from "../authorization/demo-context.js";
import { AppError } from "../../http/errors.js";
import { getCatalogProduct, getCatalogQualitySummary, listCatalogCategories, listCatalogProducts } from "./service.js";

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

export function registerCatalogRoutes(app: FastifyInstance, prefix: string): void {
  app.get(`${prefix}/catalog/products`, async (request) => {
    const merchantId = await getDemoMerchantId(prisma);
    const query = listQuerySchema.parse(request.query);
    return listCatalogProducts(prisma, { merchantId, ...query });
  });

  app.get(`${prefix}/catalog/categories`, async () => {
    const merchantId = await getDemoMerchantId(prisma);
    return { items: await listCatalogCategories(prisma, merchantId) };
  });

  app.get(`${prefix}/catalog/quality-summary`, async () => {
    const merchantId = await getDemoMerchantId(prisma);
    return getCatalogQualitySummary(prisma, merchantId);
  });

  app.get(`${prefix}/catalog/products/:id`, async (request) => {
    const merchantId = await getDemoMerchantId(prisma);
    const params = productParamsSchema.safeParse(request.params);
    if (!params.success) {
      throw AppError.validation("Invalid product id.");
    }
    return getCatalogProduct(prisma, merchantId, params.data.id);
  });
}
