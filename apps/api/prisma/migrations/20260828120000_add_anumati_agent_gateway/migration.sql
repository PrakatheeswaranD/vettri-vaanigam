-- CreateEnum
CREATE TYPE "AgentProtocol" AS ENUM ('ACP', 'AP2', 'X402');

-- CreateEnum
CREATE TYPE "AgentTrustLevel" AS ENUM ('KNOWN', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "GatewayDecisionOutcome" AS ENUM ('AUTO_APPROVE', 'STEP_UP', 'DECLINE');

-- CreateTable
CREATE TABLE "AgentIdentity" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "externalAgentId" TEXT NOT NULL,
    "displayName" TEXT,
    "firstSeenProtocol" "AgentProtocol" NOT NULL,
    "settledOrderCount" INTEGER NOT NULL DEFAULT 0,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpendMandateNonce" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "mandateId" TEXT NOT NULL,
    "buyerAgentId" TEXT NOT NULL,
    "spentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpendMandateNonce_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentGatewayPolicy" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "policyVersion" INTEGER NOT NULL DEFAULT 1,
    "currency" "Currency" NOT NULL DEFAULT 'INR',
    "unknownAgentCeilingMinor" INTEGER NOT NULL DEFAULT 1000000,
    "knownAgentCeilingMinor" INTEGER NOT NULL DEFAULT 5000000,
    "blockedCategories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "maxNegotiationDiscountBps" INTEGER NOT NULL DEFAULT 1000,
    "velocityMaxIntentsPerHour" INTEGER NOT NULL DEFAULT 20,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentGatewayPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DecisionRecord" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "agentIdentityId" TEXT,
    "protocol" "AgentProtocol",
    "protocolVersion" TEXT,
    "detectedVia" TEXT,
    "externalAgentId" TEXT,
    "agentTrust" "AgentTrustLevel",
    "outcome" "GatewayDecisionOutcome" NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "computedTotalMinor" INTEGER,
    "claimedTotalMinor" INTEGER,
    "appliedCeilingMinor" INTEGER,
    "currency" "Currency",
    "negotiatedDiscountBps" INTEGER,
    "stepUpPaymentLinkId" TEXT,
    "stepUpPaymentLinkUrl" TEXT,
    "growthProposalId" TEXT,
    "executionAuthorizationId" TEXT,
    "workflowId" TEXT,
    "decisionLatencyMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DecisionRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentIdentity_merchantId_lastSeenAt_idx" ON "AgentIdentity"("merchantId", "lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentIdentity_merchantId_externalAgentId_key" ON "AgentIdentity"("merchantId", "externalAgentId");

-- CreateIndex
CREATE INDEX "SpendMandateNonce_merchantId_spentAt_idx" ON "SpendMandateNonce"("merchantId", "spentAt");

-- CreateIndex
CREATE UNIQUE INDEX "SpendMandateNonce_merchantId_nonce_key" ON "SpendMandateNonce"("merchantId", "nonce");

-- CreateIndex
CREATE UNIQUE INDEX "AgentGatewayPolicy_merchantId_key" ON "AgentGatewayPolicy"("merchantId");

-- CreateIndex
CREATE INDEX "DecisionRecord_merchantId_createdAt_idx" ON "DecisionRecord"("merchantId", "createdAt");

-- CreateIndex
CREATE INDEX "DecisionRecord_merchantId_outcome_idx" ON "DecisionRecord"("merchantId", "outcome");

-- CreateIndex
CREATE INDEX "DecisionRecord_agentIdentityId_idx" ON "DecisionRecord"("agentIdentityId");

-- AddForeignKey
ALTER TABLE "AgentIdentity" ADD CONSTRAINT "AgentIdentity_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpendMandateNonce" ADD CONSTRAINT "SpendMandateNonce_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentGatewayPolicy" ADD CONSTRAINT "AgentGatewayPolicy_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisionRecord" ADD CONSTRAINT "DecisionRecord_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisionRecord" ADD CONSTRAINT "DecisionRecord_agentIdentityId_fkey" FOREIGN KEY ("agentIdentityId") REFERENCES "AgentIdentity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
-- Conditional on purpose. This resolves pre-existing drift: databases
-- built by the original migration carry the truncated index name, while
-- environments provisioned later already have the full one. An
-- unconditional RENAME succeeds on the former and fails on the latter, so
-- it is guarded rather than assumed. Nothing about the Anumati gateway
-- depends on this; it just stops every future `migrate diff` reporting the
-- same phantom change.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'ProductRelationship_sourceProductId_targetProductId_relat_key')
     AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'ProductRelationship_sourceProductId_targetProductId_relatio_key') THEN
    ALTER INDEX "ProductRelationship_sourceProductId_targetProductId_relat_key"
      RENAME TO "ProductRelationship_sourceProductId_targetProductId_relatio_key";
  END IF;
END $$;

