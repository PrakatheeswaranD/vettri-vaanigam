import { Prisma, type BuyerConversationStatus, type BuyerMessageRole, type PrismaClient } from "@prisma/client";

/**
 * The parameter is the SHOPPER, and now says so. It was called
 * `merchantId` while holding a buyer-context id, which is how the AI
 * Buyer Readiness score ended up counting conversations `where:
 * { merchantId }` against the seller and finding only the rows a test had
 * written. A conversation belongs to the person having it.
 */
export function createConversation(prisma: PrismaClient, customerAccountId: string) {
  return prisma.buyerConversation.create({ data: { customerAccountId } });
}

export function findConversation(prisma: PrismaClient, customerAccountId: string, conversationId: string) {
  return prisma.buyerConversation.findFirst({
    where: { id: conversationId, customerAccountId },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
}

export function appendMessage(prisma: PrismaClient, conversationId: string, role: BuyerMessageRole, content: string) {
  return prisma.buyerMessage.create({ data: { conversationId, role, content } });
}

export function updateConversationState(
  prisma: PrismaClient,
  conversationId: string,
  data: { status: BuyerConversationStatus; currentIntent: Prisma.InputJsonValue | null },
) {
  return prisma.buyerConversation.update({
    where: { id: conversationId },
    data: { status: data.status, currentIntent: data.currentIntent ?? Prisma.JsonNull },
  });
}

export async function resetConversation(prisma: PrismaClient, customerAccountId: string, conversationId: string) {
  const result = await prisma.buyerConversation.updateMany({
    where: { id: conversationId, customerAccountId },
    data: { status: "ACTIVE", currentIntent: Prisma.JsonNull },
  });
  return result.count > 0;
}

export interface CreateRecommendationRecordInput {
  conversationId: string;
  merchantId: string;
  intentSnapshot: Prisma.InputJsonValue;
  candidateProductIds: string[];
  recommendedProductIds: string[];
  /** The SPECIFIC variant recommended for each product above — same
   * order, same length. See the schema comment on
   * `recommendedVariantIds` for why this is a parallel array rather than
   * folded into `recommendedProductIds`. */
  recommendedVariantIds: string[];
  mode: string;
  aiProviderMode: string;
  traceId: string;
}

export function createRecommendationRecord(prisma: PrismaClient, input: CreateRecommendationRecordInput) {
  return prisma.recommendationRecord.create({
    data: {
      conversationId: input.conversationId,
      merchantId: input.merchantId,
      intentSnapshot: input.intentSnapshot,
      candidateProductIds: input.candidateProductIds,
      recommendedProductIds: input.recommendedProductIds,
      recommendedVariantIds: input.recommendedVariantIds,
      mode: input.mode,
      aiProviderMode: input.aiProviderMode,
      traceId: input.traceId,
    },
  });
}
