-- CreateEnum
CREATE TYPE "GrowthActionType" AS ENUM ('CROSS_SELL', 'UPSELL', 'BUNDLE', 'BOUNDED_OFFER', 'RECOVERY');

-- CreateEnum
CREATE TYPE "GrowthProposalStatus" AS ENUM ('PROPOSED', 'REJECTED_VALIDATION');

-- CreateEnum
CREATE TYPE "GrowthProposalMode" AS ENUM ('AI_PROPOSED', 'DETERMINISTIC_RELATIONSHIP', 'DETERMINISTIC_FALLBACK', 'NO_OPPORTUNITY', 'BLOCKED_BY_DATA');

-- CreateEnum
CREATE TYPE "ProductRelationshipType" AS ENUM ('COMPLEMENTARY', 'UPSELL_ALTERNATIVE', 'SIMILAR', 'BUNDLE_COMPATIBLE');

-- CreateEnum
CREATE TYPE "RelationshipProvenance" AS ENUM ('MERCHANT_CONFIGURED', 'CATALOG_METADATA', 'SYSTEM_DERIVED', 'DEMO_SEED');

-- CreateEnum
CREATE TYPE "OfferKind" AS ENUM ('PERCENTAGE', 'FIXED_AMOUNT');

-- CreateTable
CREATE TABLE "MerchantGrowthConfig" (
    "merchantId" TEXT NOT NULL,
    "growthActionsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "crossSellEnabled" BOOLEAN NOT NULL DEFAULT true,
    "upsellEnabled" BOOLEAN NOT NULL DEFAULT true,
    "bundleEnabled" BOOLEAN NOT NULL DEFAULT true,
    "boundedOffersEnabled" BOOLEAN NOT NULL DEFAULT true,
    "maxUpsellIncreaseBps" INTEGER NOT NULL DEFAULT 1500,
    "maxProposedDiscountBps" INTEGER NOT NULL DEFAULT 1000,
    "maxCrossSellItems" INTEGER NOT NULL DEFAULT 3,
    "maxBundleItems" INTEGER NOT NULL DEFAULT 2,
    "currency" "Currency" NOT NULL DEFAULT 'INR',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MerchantGrowthConfig_pkey" PRIMARY KEY ("merchantId")
);

-- CreateTable
CREATE TABLE "ProductRelationship" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "sourceProductId" TEXT NOT NULL,
    "targetProductId" TEXT NOT NULL,
    "relationshipType" "ProductRelationshipType" NOT NULL,
    "provenance" "RelationshipProvenance" NOT NULL DEFAULT 'DEMO_SEED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductRelationship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GrowthActionProposal" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "conversationId" TEXT,
    "recommendationId" TEXT,
    "primaryProductId" TEXT NOT NULL,
    "actionType" "GrowthActionType",
    "relatedProductIds" JSONB NOT NULL,
    "offerKind" "OfferKind",
    "offerPercentageBps" INTEGER,
    "offerAmountMinor" INTEGER,
    "offerCurrency" "Currency",
    "offerCalculation" JSONB,
    "opportunity" JSONB,
    "evidence" JSONB NOT NULL,
    "reasonCodes" JSONB NOT NULL,
    "explanation" TEXT NOT NULL,
    "mode" "GrowthProposalMode" NOT NULL,
    "status" "GrowthProposalStatus" NOT NULL,
    "rejectionReason" TEXT,
    "blockedOpportunities" JSONB NOT NULL,
    "traceId" TEXT NOT NULL,
    "isSyntheticDemo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GrowthActionProposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductRelationship_sourceProductId_targetProductId_relat_key" ON "ProductRelationship"("sourceProductId", "targetProductId", "relationshipType");

-- CreateIndex
CREATE INDEX "ProductRelationship_merchantId_sourceProductId_idx" ON "ProductRelationship"("merchantId", "sourceProductId");

-- CreateIndex
CREATE INDEX "GrowthActionProposal_merchantId_createdAt_idx" ON "GrowthActionProposal"("merchantId", "createdAt");

-- CreateIndex
CREATE INDEX "GrowthActionProposal_conversationId_idx" ON "GrowthActionProposal"("conversationId");

-- AddForeignKey
ALTER TABLE "MerchantGrowthConfig" ADD CONSTRAINT "MerchantGrowthConfig_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductRelationship" ADD CONSTRAINT "ProductRelationship_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductRelationship" ADD CONSTRAINT "ProductRelationship_sourceProductId_fkey" FOREIGN KEY ("sourceProductId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductRelationship" ADD CONSTRAINT "ProductRelationship_targetProductId_fkey" FOREIGN KEY ("targetProductId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrowthActionProposal" ADD CONSTRAINT "GrowthActionProposal_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
