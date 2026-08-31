ALTER TABLE "Campaign"
  ADD COLUMN "incentiveMinorPerConversion" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Campaign"
  ADD CONSTRAINT "Campaign_incentiveMinorPerConversion_check"
  CHECK ("incentiveMinorPerConversion" >= 0);

CREATE TABLE "CampaignConversion" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "assignmentId" TEXT NOT NULL,
  "paymentId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "incentiveCostMinor" INTEGER NOT NULL,
  "observedRevenueMinor" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CampaignConversion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CampaignConversion_paymentId_key" ON "CampaignConversion"("paymentId");
CREATE INDEX "CampaignConversion_campaignId_createdAt_idx" ON "CampaignConversion"("campaignId", "createdAt");
CREATE INDEX "CampaignConversion_assignmentId_idx" ON "CampaignConversion"("assignmentId");
CREATE INDEX "CampaignConversion_orderId_idx" ON "CampaignConversion"("orderId");

ALTER TABLE "CampaignConversion"
  ADD CONSTRAINT "CampaignConversion_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CampaignConversion"
  ADD CONSTRAINT "CampaignConversion_assignmentId_fkey"
  FOREIGN KEY ("assignmentId") REFERENCES "CampaignAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CampaignConversion"
  ADD CONSTRAINT "CampaignConversion_paymentId_fkey"
  FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CampaignConversion"
  ADD CONSTRAINT "CampaignConversion_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
