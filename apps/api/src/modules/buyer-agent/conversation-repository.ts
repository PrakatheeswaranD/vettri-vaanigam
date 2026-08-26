import { Prisma, type BuyerConversationStatus, type BuyerMessageRole, type PrismaClient } from "@prisma/client";

export function createConversation(prisma: PrismaClient, merchantId: string) {
  return prisma.buyerConversation.create({ data: { merchantId } });
}

export function findConversation(prisma: PrismaClient, merchantId: string, conversationId: string) {
  return prisma.buyerConversation.findFirst({
    where: { id: conversationId, merchantId },
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

export async function resetConversation(prisma: PrismaClient, merchantId: string, conversationId: string) {
  const result = await prisma.buyerConversation.updateMany({
    where: { id: conversationId, merchantId },
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
      mode: input.mode,
      aiProviderMode: input.aiProviderMode,
      traceId: input.traceId,
    },
  });
}
