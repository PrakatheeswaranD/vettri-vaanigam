-- PART 07 — Razorpay Test Mode, PaymentGateway, Deterministic Payment
-- State Machine & Secure Webhooks: extends the PART 01 placeholder
-- `Payment` model into a real payment record, adds `PaymentProviderEvent`
-- for verified webhook persistence/idempotency, and links a payment to
-- the `CheckoutSession` it belongs to.

-- AlterEnum
ALTER TYPE "AgentActorType" ADD VALUE 'PAYMENT_SYSTEM';
ALTER TYPE "AgentActorType" ADD VALUE 'RAZORPAY';

-- AlterEnum: MOCK is the deterministic test-double provider used by the
-- automated test suite — distinct from DEMO (seeded historical data) and
-- RAZORPAY (a real Test Mode transaction).
ALTER TYPE "PaymentProvider" ADD VALUE 'MOCK';

-- CreateEnum
CREATE TYPE "PaymentEventProcessingStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'DUPLICATE', 'FAILED_PROCESSING', 'UNRESOLVED', 'REJECTED_SIGNATURE');

-- DropIndex
DROP INDEX "Payment_state_idx";

-- AlterTable: add nullable first so existing rows (this merchant's
-- historical seed/test data) can be backfilled before the NOT NULL
-- constraint is applied — `providerRef` is dropped in favor of the more
-- precise `providerOrderId`/`providerPaymentId` pair (PART 07 §17).
ALTER TABLE "Payment"
  ADD COLUMN "merchantId" TEXT,
  ADD COLUMN "checkoutId" TEXT,
  ADD COLUMN "attemptNumber" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "providerOrderId" TEXT,
  ADD COLUMN "providerPaymentId" TEXT,
  ADD COLUMN "providerMetadata" JSONB,
  ADD COLUMN "authorizedAt" TIMESTAMP(3),
  ADD COLUMN "failedAt" TIMESTAMP(3),
  ADD COLUMN "lastReconciledAt" TIMESTAMP(3);

UPDATE "Payment" p
SET "merchantId" = o."merchantId"
FROM "Order" o
WHERE p."orderId" = o."id";

ALTER TABLE "Payment" ALTER COLUMN "merchantId" SET NOT NULL;
ALTER TABLE "Payment" DROP COLUMN "providerRef";

-- CreateTable
CREATE TABLE "PaymentProviderEvent" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL DEFAULT 'RAZORPAY',
    "providerEventId" TEXT,
    "eventType" TEXT NOT NULL,
    "paymentId" TEXT,
    "providerPaymentId" TEXT,
    "providerOrderId" TEXT,
    "eventFingerprint" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "signatureVerified" BOOLEAN NOT NULL,
    "processingStatus" "PaymentEventProcessingStatus" NOT NULL DEFAULT 'RECEIVED',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "PaymentProviderEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Payment_checkoutId_key" ON "Payment"("checkoutId");

-- CreateIndex
CREATE INDEX "Payment_merchantId_state_idx" ON "Payment"("merchantId", "state");

-- CreateIndex
CREATE INDEX "Payment_provider_providerOrderId_idx" ON "Payment"("provider", "providerOrderId");

-- CreateIndex
CREATE INDEX "Payment_provider_providerPaymentId_idx" ON "Payment"("provider", "providerPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentProviderEvent_provider_eventFingerprint_key" ON "PaymentProviderEvent"("provider", "eventFingerprint");

-- CreateIndex
CREATE INDEX "PaymentProviderEvent_merchantId_receivedAt_idx" ON "PaymentProviderEvent"("merchantId", "receivedAt");

-- CreateIndex
CREATE INDEX "PaymentProviderEvent_paymentId_idx" ON "PaymentProviderEvent"("paymentId");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_checkoutId_fkey" FOREIGN KEY ("checkoutId") REFERENCES "CheckoutSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentProviderEvent" ADD CONSTRAINT "PaymentProviderEvent_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentProviderEvent" ADD CONSTRAINT "PaymentProviderEvent_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
