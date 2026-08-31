ALTER TABLE "DecisionRecord"
  ADD COLUMN "authorizationExpiresAt" TIMESTAMP(3),
  ADD COLUMN "authorizationMaxAmountMinor" INTEGER,
  ADD COLUMN "authorizationCurrency" "Currency",
  ADD COLUMN "authorizationMerchantScope" TEXT,
  ADD COLUMN "inventoryReleasedAt" TIMESTAMP(3);

CREATE TABLE "CampaignOrderAttribution" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "assignmentId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "boundAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CampaignOrderAttribution_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "CampaignConversion" ADD COLUMN "attributionId" TEXT;
CREATE UNIQUE INDEX "CampaignOrderAttribution_orderId_key" ON "CampaignOrderAttribution"("orderId");
CREATE INDEX "CampaignOrderAttribution_campaignId_boundAt_idx" ON "CampaignOrderAttribution"("campaignId", "boundAt");
CREATE INDEX "CampaignOrderAttribution_assignmentId_boundAt_idx" ON "CampaignOrderAttribution"("assignmentId", "boundAt");
CREATE UNIQUE INDEX "CampaignConversion_attributionId_key" ON "CampaignConversion"("attributionId");
ALTER TABLE "CampaignOrderAttribution" ADD CONSTRAINT "CampaignOrderAttribution_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CampaignOrderAttribution" ADD CONSTRAINT "CampaignOrderAttribution_assignmentId_fkey"
  FOREIGN KEY ("assignmentId") REFERENCES "CampaignAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CampaignOrderAttribution" ADD CONSTRAINT "CampaignOrderAttribution_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CampaignConversion" ADD CONSTRAINT "CampaignConversion_attributionId_fkey"
  FOREIGN KEY ("attributionId") REFERENCES "CampaignOrderAttribution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Database authority for one live compiled catalog per merchant. Application
-- serialization gives a useful conflict response; this constraint is the
-- final protection against concurrent publishers.
CREATE UNIQUE INDEX "CatalogCompilation_one_published_per_merchant"
  ON "CatalogCompilation"("merchantId") WHERE "status" = 'PUBLISHED';
