-- AlterTable
ALTER TABLE "DecisionRecord" ADD COLUMN     "stepUpStatus" TEXT,
ADD COLUMN     "stepUpDecidedById" TEXT,
ADD COLUMN     "stepUpDecidedAt" TIMESTAMP(3),
ADD COLUMN     "stepUpDecisionNote" TEXT;

-- CreateIndex
CREATE INDEX "DecisionRecord_merchantId_stepUpStatus_idx" ON "DecisionRecord"("merchantId", "stepUpStatus");
