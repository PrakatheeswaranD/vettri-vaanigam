-- PART 06 — Deterministic Commerce Execution: Cart/Order lifecycle
-- extensions, CheckoutSession, IdempotencyRecord.

-- AlterEnum
ALTER TYPE "AgentActorType" ADD VALUE 'COMMERCE';

-- AlterEnum: CartStatus. The Cart table has never had any rows written to
-- it (seed.ts only ever deletes defensively; no code creates one before
-- PART 06), so renaming an existing value is safe — there is no data to
-- migrate.
ALTER TYPE "CartStatus" RENAME VALUE 'CHECKED_OUT' TO 'CONVERTED';
ALTER TYPE "CartStatus" ADD VALUE 'CHECKOUT_PENDING';
ALTER TYPE "CartStatus" ADD VALUE 'EXPIRED';

-- AlterEnum: OrderStatus — PART 07 forward-compatibility only.
ALTER TYPE "OrderStatus" ADD VALUE 'PAYMENT_PENDING';

-- CreateEnum
CREATE TYPE "CheckoutSessionStatus" AS ENUM ('CREATED', 'READY_FOR_PAYMENT', 'PAYMENT_IN_PROGRESS', 'COMPLETED', 'FAILED', 'EXPIRED', 'CANCELLED');

-- AlterTable
ALTER TABLE "CartItem"
  ADD COLUMN "lineDiscountMinor" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "source" TEXT NOT NULL DEFAULT 'DIRECT_BUYER',
  ADD COLUMN "growthProposalId" TEXT;

-- AlterTable
ALTER TABLE "Order"
  ADD COLUMN "growthProposalId" TEXT,
  ADD COLUMN "authorizationId" TEXT,
  ADD COLUMN "orderFingerprint" TEXT,
  ADD COLUMN "fingerprintVersion" TEXT;

-- AlterTable
ALTER TABLE "OrderItem"
  ADD COLUMN "lineDiscountMinor" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "source" TEXT NOT NULL DEFAULT 'DIRECT_BUYER',
  ADD COLUMN "growthProposalId" TEXT;

-- CreateTable
CREATE TABLE "CheckoutSession" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "customerId" TEXT,
    "cartId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "authorizationId" TEXT NOT NULL,
    "status" "CheckoutSessionStatus" NOT NULL DEFAULT 'CREATED',
    "amountMinor" INTEGER NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'INR',
    "orderFingerprint" TEXT NOT NULL,
    "fingerprintVersion" TEXT NOT NULL DEFAULT '1',
    "workflowId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "checkoutVersion" TEXT NOT NULL DEFAULT '1',

    CONSTRAINT "CheckoutSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestFingerprint" TEXT NOT NULL,
    "responseSnapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CheckoutSession_orderId_key" ON "CheckoutSession"("orderId");

-- CreateIndex
CREATE INDEX "CheckoutSession_merchantId_createdAt_idx" ON "CheckoutSession"("merchantId", "createdAt");

-- CreateIndex
CREATE INDEX "CheckoutSession_authorizationId_idx" ON "CheckoutSession"("authorizationId");

-- CreateIndex
CREATE INDEX "CheckoutSession_status_expiresAt_idx" ON "CheckoutSession"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyRecord_merchantId_operation_idempotencyKey_key" ON "IdempotencyRecord"("merchantId", "operation", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "CheckoutSession" ADD CONSTRAINT "CheckoutSession_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckoutSession" ADD CONSTRAINT "CheckoutSession_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckoutSession" ADD CONSTRAINT "CheckoutSession_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "Cart"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckoutSession" ADD CONSTRAINT "CheckoutSession_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckoutSession" ADD CONSTRAINT "CheckoutSession_authorizationId_fkey" FOREIGN KEY ("authorizationId") REFERENCES "ExecutionAuthorization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdempotencyRecord" ADD CONSTRAINT "IdempotencyRecord_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
