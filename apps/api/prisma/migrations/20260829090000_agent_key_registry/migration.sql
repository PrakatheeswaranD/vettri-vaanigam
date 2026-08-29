-- AlterTable
ALTER TABLE "AgentIdentity" ADD COLUMN     "registeredPublicKey" TEXT,
ADD COLUMN     "keyTrustSource" TEXT,
ADD COLUMN     "keyRegisteredAt" TIMESTAMP(3),
ADD COLUMN     "apiKeyHash" TEXT,
ADD COLUMN     "apiKeyIssuedAt" TIMESTAMP(3),
ADD COLUMN     "apiKeyRevokedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "AgentIdentity_apiKeyHash_idx" ON "AgentIdentity"("apiKeyHash");
