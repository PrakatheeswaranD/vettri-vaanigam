/**
 * Machine-oriented commerce API (PART 02 §18-§19, §91).
 *
 * Internal naming (`/agent-commerce/*`) deliberately avoids implying
 * compliance with any external agentic-commerce protocol (ACP/AP2/UCP/
 * x402) — this is RazorGrowth AI's own structured representation, which
 * a future Buyer Agent (PART 03) will consume through this exact
 * boundary rather than querying the database directly (PART 02 §136).
 */
import type { FastifyInstance } from "fastify";
import { agentCatalogQuerySchema } from "@razorgrowth/contracts";
import { z } from "zod";
import { prisma } from "../../db/client.js";
import { getDemoMerchantId } from "../authorization/demo-context.js";
import { AppError } from "../../http/errors.js";
import { getAgentCatalogProduct, listAgentCatalog } from "./service.js";

const productParamsSchema = z.object({ id: z.string().uuid() });

export function registerAgentCommerceRoutes(app: FastifyInstance, prefix: string): void {
  app.get(`${prefix}/agent-commerce/catalog`, async (request) => {
    const merchantId = await getDemoMerchantId(prisma);
    const query = agentCatalogQuerySchema.parse(request.query);
    return listAgentCatalog(prisma, { merchantId, ...query });
  });

  app.get(`${prefix}/agent-commerce/catalog/:id`, async (request) => {
    const merchantId = await getDemoMerchantId(prisma);
    const params = productParamsSchema.safeParse(request.params);
    if (!params.success) {
      throw AppError.validation("Invalid product id.");
    }
    return getAgentCatalogProduct(prisma, merchantId, params.data.id);
  });
}
