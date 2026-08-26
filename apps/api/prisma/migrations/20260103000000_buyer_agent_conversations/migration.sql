-- CreateEnum
CREATE TYPE "BuyerConversationStatus" AS ENUM ('ACTIVE', 'AWAITING_CLARIFICATION', 'RECOMMENDATION_READY', 'CLOSED');

-- CreateEnum
CREATE TYPE "BuyerMessageRole" AS ENUM ('BUYER', 'AGENT');

-- CreateTable
CREATE TABLE "BuyerConversation" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "status" "BuyerConversationStatus" NOT NULL DEFAULT 'ACTIVE',
    "currentIntent" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BuyerConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuyerMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" "BuyerMessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BuyerMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecommendationRecord" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "intentSnapshot" JSONB NOT NULL,
    "candidateProductIds" JSONB NOT NULL,
    "recommendedProductIds" JSONB NOT NULL,
    "mode" TEXT NOT NULL,
    "aiProviderMode" TEXT NOT NULL,
    "traceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecommendationRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BuyerConversation_merchantId_updatedAt_idx" ON "BuyerConversation"("merchantId", "updatedAt");

-- CreateIndex
CREATE INDEX "BuyerMessage_conversationId_createdAt_idx" ON "BuyerMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "RecommendationRecord_conversationId_createdAt_idx" ON "RecommendationRecord"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "RecommendationRecord_merchantId_createdAt_idx" ON "RecommendationRecord"("merchantId", "createdAt");

-- AddForeignKey
ALTER TABLE "BuyerConversation" ADD CONSTRAINT "BuyerConversation_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuyerMessage" ADD CONSTRAINT "BuyerMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "BuyerConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecommendationRecord" ADD CONSTRAINT "RecommendationRecord_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "BuyerConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecommendationRecord" ADD CONSTRAINT "RecommendationRecord_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
