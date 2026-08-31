import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../db/client.js";
import { discoverMarketplace } from "./service.js";

const querySchema = z.object({
  category: z.string().trim().min(1).max(100).optional(),
  limitPerMerchant: z.coerce.number().int().min(1).max(20).default(10),
});

export function registerMarketplaceRoutes(app: FastifyInstance, prefix: string): void {
  app.get(`${prefix}/marketplace/discovery`, async (request) => {
    const query = querySchema.parse(request.query);
    return discoverMarketplace(prisma, query);
  });
}
