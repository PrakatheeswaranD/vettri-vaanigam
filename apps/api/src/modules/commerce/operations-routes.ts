/**
 * 🛍 Commerce — four operational views, one per subsection.
 *
 * Each is a read model over rows that already exist. None of them detects
 * an opportunity or estimates a value; the `opportunities` on every row are
 * the Revenue Opportunity Engine's own output, attached by subject id. See
 * `operations-service.ts` for why that separation is load-bearing rather
 * than stylistic.
 *
 * These are merchant-side management routes, so they inherit the default
 * MERCHANT audience from the access model — a shopper session cannot reach
 * them, and `access-model.test.ts` asserts that for every registered route
 * rather than for a hand-written list.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../db/client.js";
import { getAuthenticatedMerchantId } from "../authorization/demo-context.js";
import {
  COMMERCE_PAGE_LIMIT,
  getCommerceCustomers,
  getCommerceOrders,
  getCommercePayments,
  getCommerceProducts,
} from "./operations-service.js";

/** A caller may narrow the window but never widen it past the server's own
 * bound — an unbounded page is how a console becomes a data export. */
const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(COMMERCE_PAGE_LIMIT).optional(),
});

export function registerCommerceOperationsRoutes(app: FastifyInstance, prefix: string): void {
  app.get(`${prefix}/commerce/products`, async (request) => {
    const merchantId = getAuthenticatedMerchantId(request);
    const { limit } = querySchema.parse(request.query);
    return getCommerceProducts(prisma, merchantId, limit);
  });

  app.get(`${prefix}/commerce/customers`, async (request) => {
    const merchantId = getAuthenticatedMerchantId(request);
    const { limit } = querySchema.parse(request.query);
    return getCommerceCustomers(prisma, merchantId, limit);
  });

  app.get(`${prefix}/commerce/orders`, async (request) => {
    const merchantId = getAuthenticatedMerchantId(request);
    const { limit } = querySchema.parse(request.query);
    return getCommerceOrders(prisma, merchantId, limit);
  });

  app.get(`${prefix}/commerce/payments`, async (request) => {
    const merchantId = getAuthenticatedMerchantId(request);
    const { limit } = querySchema.parse(request.query);
    return getCommercePayments(prisma, merchantId, limit);
  });
}
