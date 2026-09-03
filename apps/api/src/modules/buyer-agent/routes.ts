/**
 * Buyer Agent API (PART 03 §60-§64).
 *
 * Three endpoints only — send a message, read a conversation, reset it.
 *
 * WHY EVERYTHING SITS UNDER `/buyer/`
 *
 * There used to be two message endpoints, `/buyer/marketplace/messages`
 * and `/buyer-agent/messages`, calling the same `handleBuyerMessage` with
 * one boolean between them, plus conversation routes under a third prefix
 * `/buyer-agent/conversations/`. The role model had to name all three
 * spellings to let a shopper through, and it only ever named two — so the
 * `/buyer-agent/messages` spelling was reachable by no role at all.
 *
 * The Buyer Agent is a shopper's tool and shoppers live under `/buyer/`.
 * One prefix means the access table has one entry to get right, and a
 * route added here inherits the right answer instead of needing a matching
 * edit in the middleware.
 *
 * WHY THE SEARCH IS ALWAYS MARKETPLACE-WIDE
 *
 * A shopper's own identity context sells nothing, so a merchant-scoped
 * search from a customer session would always return an empty catalogue.
 * The cross-merchant search IS the product. `handleBuyerMessage` keeps its
 * `marketplace` option because the service is also called directly by
 * evaluation scripts and tests against a single merchant's catalogue.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { buyerMessageRequestSchema } from "@razorgrowth/contracts";
import { prisma } from "../../db/client.js";
import { getBuyerContextId } from "../authorization/demo-context.js";
import { getConversation, handleBuyerMessage, resetBuyerConversation } from "./service.js";

const conversationParamsSchema = z.object({ id: z.string().uuid() });

export function registerBuyerAgentRoutes(app: FastifyInstance, prefix: string): void {
  app.post(`${prefix}/buyer/messages`, async (request) => {
    const buyerContextId = getBuyerContextId(request);
    const body = buyerMessageRequestSchema.parse(request.body);
    return handleBuyerMessage(prisma, {
      customerAccountId: buyerContextId,
      // A marketplace search has no single seller; the buyer's own context
      // is the tenant its ledger events are recorded under.
      merchantId: buyerContextId,
      conversationId: body.conversationId,
      message: body.message,
      marketplace: true,
    });
  });

  app.get(`${prefix}/buyer/conversations/:id`, async (request) => {
    const buyerContextId = getBuyerContextId(request);
    const params = conversationParamsSchema.parse(request.params);
    return getConversation(prisma, buyerContextId, params.id);
  });

  app.post(`${prefix}/buyer/conversations/:id/reset`, async (request, reply) => {
    const buyerContextId = getBuyerContextId(request);
    const params = conversationParamsSchema.parse(request.params);
    await resetBuyerConversation(prisma, buyerContextId, params.id);
    return reply.status(204).send();
  });
}
