import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { commerceExecutionRequestSchema, paginationQuerySchema } from "@razorgrowth/contracts";
import { AppError } from "../../http/errors.js";
import { prisma } from "../../db/client.js";
import { getDemoMerchantId } from "../authorization/demo-context.js";
import { listTransactions } from "./service.js";
import { executeAuthorizedSelection } from "./execution-service.js";
import { findCheckoutById } from "./checkout-repository.js";
import { findOrderById } from "./order-repository.js";
import { toCheckoutSessionDTO, toOrderDTO } from "./mapper.js";

const idParamsSchema = z.object({ id: z.string().uuid() });

export function registerTransactionRoutes(app: FastifyInstance, prefix: string): void {
  app.get(`${prefix}/transactions`, async (request) => {
    const merchantId = await getDemoMerchantId(prisma);
    const query = paginationQuerySchema.parse(request.query);
    return listTransactions(prisma, { merchantId, ...query });
  });
}

/**
 * PART 06 §67, §74-§75 — deliberately narrow: one write endpoint
 * (deterministic commerce execution, gated entirely by
 * `ExecutionAuthorization`) and two safe read endpoints. No generic cart
 * CRUD is exposed (PART 06 §68: "do not overbuild CRUD if checkout flow
 * can be simpler") — a cart is created and immediately converted inside
 * one authorized execution, never built up across multiple requests in
 * this build.
 */
export function registerCommerceRoutes(app: FastifyInstance, prefix: string): void {
  app.post(`${prefix}/commerce/checkout`, async (request) => {
    const merchantId = await getDemoMerchantId(prisma);
    const body = commerceExecutionRequestSchema.parse(request.body);
    return executeAuthorizedSelection(prisma, merchantId, null, body);
  });

  app.get(`${prefix}/commerce/checkouts/:id`, async (request) => {
    const merchantId = await getDemoMerchantId(prisma);
    const params = idParamsSchema.parse(request.params);
    const checkout = await findCheckoutById(prisma, merchantId, params.id);
    if (!checkout) throw AppError.notFound(`Checkout not found: ${params.id}`);
    return toCheckoutSessionDTO(checkout);
  });

  app.get(`${prefix}/commerce/orders/:id`, async (request) => {
    const merchantId = await getDemoMerchantId(prisma);
    const params = idParamsSchema.parse(request.params);
    const order = await findOrderById(prisma, merchantId, params.id);
    if (!order) throw AppError.notFound(`Order not found: ${params.id}`);
    return toOrderDTO(order);
  });
}
