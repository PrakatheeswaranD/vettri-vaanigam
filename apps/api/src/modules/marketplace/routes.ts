import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../db/client.js";
import { discoverMarketplace, getMarketplaceProduct } from "./service.js";

const querySchema = z.object({
  category: z.string().trim().min(1).max(100).optional(),
  // A shopper sees at most `limitPerMerchant` products from each merchant,
  // so a large catalogue is only ever partly on screen. Search is how they
  // reach the rest: it filters SERVER-side, across every published product,
  // rather than over the handful already fetched.
  search: z.string().trim().min(1).max(100).optional(),
  limitPerMerchant: z.coerce.number().int().min(1).max(20).default(10),
});

export function registerMarketplaceRoutes(app: FastifyInstance, prefix: string): void {
  app.get(`${prefix}/marketplace/discovery`, async (request) => {
    const query = querySchema.parse(request.query);
    return discoverMarketplace(prisma, query);
  });

  app.get(`${prefix}/marketplace/products/:productId`, async (request) => {
    const { productId } = z.object({ productId: z.string().uuid() }).parse(request.params);
    return getMarketplaceProduct(prisma, productId);
  });
}
