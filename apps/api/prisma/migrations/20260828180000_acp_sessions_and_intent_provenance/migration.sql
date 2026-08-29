-- AlterTable
ALTER TABLE "AgentGatewayPolicy" ADD COLUMN     "negotiatorFloorMarginBps" INTEGER NOT NULL DEFAULT 2000,
ADD COLUMN     "negotiatorMinBundleItems" INTEGER NOT NULL DEFAULT 2;

-- AlterTable
ALTER TABLE "DecisionRecord" ADD COLUMN     "buyerEmail" TEXT,
ADD COLUMN     "buyerName" TEXT,
ADD COLUMN     "protocolActorRef" TEXT,
ADD COLUMN     "rawProtocolPayload" JSONB;

-- AlterTable

-- CreateTable
CREATE TABLE "AcpCheckoutSession" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "lineItems" JSONB NOT NULL,
    "totalAmountMinor" INTEGER NOT NULL,
    "buyerEmail" TEXT,
    "buyerName" TEXT,
    "allowance" JSONB,
    "externalAgentId" TEXT,
    "decisionRecordId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AcpCheckoutSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AcpCheckoutSession_merchantId_createdAt_idx" ON "AcpCheckoutSession"("merchantId", "createdAt");

-- AddForeignKey
ALTER TABLE "AcpCheckoutSession" ADD CONSTRAINT "AcpCheckoutSession_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

