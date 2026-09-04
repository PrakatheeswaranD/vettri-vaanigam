ALTER TABLE "Customer"
  ADD COLUMN "marketingConsent" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "lastContactedAt" TIMESTAMP(3);

ALTER TABLE "CampaignConversion"
  ADD COLUMN "observedProductCostMinor" INTEGER,
  ADD COLUMN "observedShippingCostMinor" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "observedPaymentFeeMinor" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "expectedReturnCostMinor" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "observedContributionMinor" INTEGER;

CREATE TABLE "GrowthPlan" (
  "id" TEXT NOT NULL,
  "merchantId" TEXT NOT NULL,
  "weekStart" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
  "summary" TEXT NOT NULL,
  "estimatedRevenueMinor" INTEGER NOT NULL DEFAULT 0,
  "estimatedProfitMinor" INTEGER,
  "approvedBudgetMinor" INTEGER NOT NULL DEFAULT 0,
  "approvedCustomerContacts" INTEGER NOT NULL DEFAULT 0,
  "approvedById" TEXT,
  "approvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GrowthPlan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GrowthPlanItem" (
  "id" TEXT NOT NULL,
  "planId" TEXT NOT NULL,
  "opportunityId" TEXT NOT NULL,
  "opportunityType" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "proposedAction" TEXT NOT NULL,
  "subjectIds" JSONB NOT NULL,
  "priority" INTEGER NOT NULL,
  "confidence" INTEGER NOT NULL,
  "customersAffected" INTEGER NOT NULL DEFAULT 0,
  "expectedRevenueMinor" INTEGER,
  "expectedProfitMinor" INTEGER,
  "status" TEXT NOT NULL DEFAULT 'PLANNED',
  "result" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GrowthPlanItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OutboundMessage" (
  "id" TEXT NOT NULL,
  "merchantId" TEXT NOT NULL,
  "customerId" TEXT,
  "planItemId" TEXT,
  "channel" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "consentEvidence" JSONB,
  "idempotencyKey" TEXT NOT NULL,
  "providerReference" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentAt" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "convertedAt" TIMESTAMP(3),
  "failureReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OutboundMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgentJob" (
  "id" TEXT NOT NULL,
  "merchantId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "payload" JSONB NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 5,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AgentJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GrowthPlan_merchantId_weekStart_key" ON "GrowthPlan"("merchantId", "weekStart");
CREATE INDEX "GrowthPlan_merchantId_status_idx" ON "GrowthPlan"("merchantId", "status");
CREATE UNIQUE INDEX "GrowthPlanItem_planId_opportunityId_key" ON "GrowthPlanItem"("planId", "opportunityId");
CREATE INDEX "GrowthPlanItem_planId_status_idx" ON "GrowthPlanItem"("planId", "status");
CREATE UNIQUE INDEX "OutboundMessage_idempotencyKey_key" ON "OutboundMessage"("idempotencyKey");
CREATE INDEX "OutboundMessage_merchantId_status_nextAttemptAt_idx" ON "OutboundMessage"("merchantId", "status", "nextAttemptAt");
CREATE INDEX "OutboundMessage_customerId_createdAt_idx" ON "OutboundMessage"("customerId", "createdAt");
CREATE UNIQUE INDEX "AgentJob_idempotencyKey_key" ON "AgentJob"("idempotencyKey");
CREATE INDEX "AgentJob_merchantId_status_nextAttemptAt_idx" ON "AgentJob"("merchantId", "status", "nextAttemptAt");

ALTER TABLE "GrowthPlan" ADD CONSTRAINT "GrowthPlan_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GrowthPlanItem" ADD CONSTRAINT "GrowthPlanItem_planId_fkey" FOREIGN KEY ("planId") REFERENCES "GrowthPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_planItemId_fkey" FOREIGN KEY ("planItemId") REFERENCES "GrowthPlanItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AgentJob" ADD CONSTRAINT "AgentJob_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
