-- PART 02 §50: the readiness formula/version changed (v1 implicit -> v2
-- explicit), so any pre-existing snapshot is semantically incompatible
-- with the new columns being added below. This table holds only
-- recomputable synthetic/demo data (never financial history), so
-- clearing it here is safe; the seed script recalculates a real snapshot
-- from actual catalog data immediately after migrating.
DELETE FROM "ReadinessSnapshot";

-- CreateEnum
CREATE TYPE "PromotionEligibility" AS ENUM ('ELIGIBLE', 'INELIGIBLE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "MerchantReadinessLevel" AS ENUM ('AGENT_READY', 'NEARLY_READY', 'PARTIALLY_READY', 'NOT_READY');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "promotionEligibility" "PromotionEligibility" NOT NULL DEFAULT 'UNKNOWN';

-- AlterTable
ALTER TABLE "ProductVariant" ADD COLUMN     "priceUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "ReadinessSnapshot" ADD COLUMN     "blockers" JSONB NOT NULL,
ADD COLUMN     "calculationVersion" TEXT NOT NULL,
ADD COLUMN     "evidence" JSONB NOT NULL,
ADD COLUMN     "level" "MerchantReadinessLevel" NOT NULL,
ADD COLUMN     "metadataQuality" INTEGER NOT NULL,
ADD COLUMN     "strengths" JSONB NOT NULL,
ADD COLUMN     "trustInformation" INTEGER NOT NULL;

-- CreateIndex
CREATE INDEX "ProductVariant_active_priceMinor_idx" ON "ProductVariant"("active", "priceMinor");

