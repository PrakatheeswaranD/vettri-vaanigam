/**
 * Buyer Agent API (PART 03 §60-§64).
 *
 * Deliberately three endpoints only — a message endpoint, a read endpoint,
 * and a reset endpoint — matching what the demo actually needs (§60).
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { buyerMessageRequestSchema } from "@razorgrowth/contracts";
import { prisma } from "../../db/client.js";
import { getAuthenticatedMerchantId } from "../authorization/demo-context.js";
import { getConversation, handleBuyerMessage, resetBuyerConversation } from "./service.js";

const conversationParamsSchema = z.object({ id: z.string().uuid() });

export function registerBuyerAgentRoutes(app: FastifyInstance, prefix: string): void {
  app.post(`${prefix}/buyer-agent/messages`, async (request) => {
    const merchantId = getAuthenticatedMerchantId(request);
    const body = buyerMessageRequestSchema.parse(request.body);
    return handleBuyerMessage(prisma, { merchantId, conversationId: body.conversationId, message: body.message });
  });

  app.get(`${prefix}/buyer-agent/conversations/:id`, async (request) => {
    const merchantId = getAuthenticatedMerchantId(request);
    const params = conversationParamsSchema.parse(request.params);
    return getConversation(prisma, merchantId, params.id);
  });

  app.post(`${prefix}/buyer-agent/conversations/:id/reset`, async (request, reply) => {
    const merchantId = getAuthenticatedMerchantId(request);
    const params = conversationParamsSchema.parse(request.params);
    await resetBuyerConversation(prisma, merchantId, params.id);
    reply.status(204).send();
  });
}
