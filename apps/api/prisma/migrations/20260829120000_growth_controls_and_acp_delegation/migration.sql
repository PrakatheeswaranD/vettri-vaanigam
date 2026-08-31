-- Real unit economics for negotiated offers. Existing rows deliberately
-- remain NULL: unknown cost must disable discounting rather than invent COGS.
ALTER TABLE "ProductVariant" ADD COLUMN "costMinor" INTEGER;
ALTER TABLE "ProductVariant"
  ADD CONSTRAINT "ProductVariant_costMinor_check"
  CHECK ("costMinor" IS NULL OR ("costMinor" >= 0 AND "costMinor" <= "priceMinor"));

ALTER TABLE "DecisionRecord"
  ADD COLUMN "providerPaymentId" TEXT,
  ADD COLUMN "settlementStatus" TEXT,
  ADD COLUMN "settledAt" TIMESTAMP(3),
  ADD COLUMN "internalOrderId" TEXT,
  ADD COLUMN "internalPaymentId" TEXT,
  ADD COLUMN "normalizedBasket" JSONB;
CREATE INDEX "DecisionRecord_providerOrderId_idx" ON "DecisionRecord"("providerOrderId");

ALTER TABLE "CheckoutSession" ALTER COLUMN "authorizationId" DROP NOT NULL;
ALTER TABLE "CheckoutSession" ADD COLUMN "gatewayDecisionId" TEXT;
CREATE INDEX "CheckoutSession_gatewayDecisionId_idx" ON "CheckoutSession"("gatewayDecisionId");

CREATE TABLE "AcpDelegatedPayment" (
  "id" TEXT NOT NULL,
  "merchantId" TEXT NOT NULL,
  "agentIdentityId" TEXT NOT NULL,
  "checkoutSessionId" TEXT,
  "paymentMethodType" TEXT NOT NULL,
  "paymentInstrumentFingerprint" TEXT NOT NULL,
  "allowance" JSONB NOT NULL,
  "riskSignals" JSONB,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AcpDelegatedPayment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AcpDelegatedPayment_status_check" CHECK ("status" IN ('ACTIVE', 'IN_FLIGHT', 'CONSUMED', 'REVOKED'))
);

CREATE TABLE "CatalogCompilation" (
  "id" TEXT NOT NULL,
  "merchantId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "rowsRead" INTEGER NOT NULL,
  "rowsCompiled" INTEGER NOT NULL,
  "issues" JSONB NOT NULL,
  "products" JSONB NOT NULL,
  "providerMode" TEXT NOT NULL,
  "beforeSnapshot" JSONB,
  "appliedProductIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "publishedAt" TIMESTAMP(3),
  "rolledBackAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CatalogCompilation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CatalogCompilation_status_check" CHECK ("status" IN ('DRAFT', 'PUBLISHED', 'SUPERSEDED', 'ROLLED_BACK'))
);

CREATE TABLE "Campaign" (
  "id" TEXT NOT NULL,
  "merchantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "actionType" TEXT NOT NULL,
  "budgetMinor" INTEGER NOT NULL,
  "spentMinor" INTEGER NOT NULL DEFAULT 0,
  "maxUsesPerSubject" INTEGER NOT NULL DEFAULT 1,
  "controlPercentBps" INTEGER NOT NULL DEFAULT 1000,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Campaign_status_check" CHECK ("status" IN ('DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED')),
  CONSTRAINT "Campaign_bounds_check" CHECK (
    "budgetMinor" >= 0 AND "spentMinor" >= 0 AND "spentMinor" <= "budgetMinor"
    AND "maxUsesPerSubject" >= 1
    AND "controlPercentBps" >= 0 AND "controlPercentBps" <= 10000
    AND "endsAt" > "startsAt"
  )
);

CREATE TABLE "CampaignAssignment" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "subjectKeyHash" TEXT NOT NULL,
  "cohort" TEXT NOT NULL,
  "impressionCount" INTEGER NOT NULL DEFAULT 0,
  "conversionCount" INTEGER NOT NULL DEFAULT 0,
  "observedRevenueMinor" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CampaignAssignment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CampaignAssignment_cohort_check" CHECK ("cohort" IN ('CONTROL', 'TREATMENT')),
  CONSTRAINT "CampaignAssignment_counters_check" CHECK (
    "impressionCount" >= 0 AND "conversionCount" >= 0 AND "observedRevenueMinor" >= 0
  )
);

CREATE INDEX "AcpDelegatedPayment_merchantId_createdAt_idx" ON "AcpDelegatedPayment"("merchantId", "createdAt");
CREATE INDEX "AcpDelegatedPayment_agentIdentityId_status_idx" ON "AcpDelegatedPayment"("agentIdentityId", "status");
CREATE INDEX "AcpDelegatedPayment_status_expiresAt_idx" ON "AcpDelegatedPayment"("status", "expiresAt");
CREATE INDEX "CatalogCompilation_merchantId_createdAt_idx" ON "CatalogCompilation"("merchantId", "createdAt");
CREATE INDEX "CatalogCompilation_merchantId_status_idx" ON "CatalogCompilation"("merchantId", "status");
CREATE INDEX "Campaign_merchantId_status_idx" ON "Campaign"("merchantId", "status");
CREATE INDEX "Campaign_startsAt_endsAt_idx" ON "Campaign"("startsAt", "endsAt");
CREATE UNIQUE INDEX "CampaignAssignment_campaignId_subjectKeyHash_key" ON "CampaignAssignment"("campaignId", "subjectKeyHash");
CREATE INDEX "CampaignAssignment_campaignId_cohort_idx" ON "CampaignAssignment"("campaignId", "cohort");

ALTER TABLE "AcpDelegatedPayment" ADD CONSTRAINT "AcpDelegatedPayment_merchantId_fkey"
  FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AcpDelegatedPayment" ADD CONSTRAINT "AcpDelegatedPayment_agentIdentityId_fkey"
  FOREIGN KEY ("agentIdentityId") REFERENCES "AgentIdentity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CatalogCompilation" ADD CONSTRAINT "CatalogCompilation_merchantId_fkey"
  FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_merchantId_fkey"
  FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CampaignAssignment" ADD CONSTRAINT "CampaignAssignment_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
