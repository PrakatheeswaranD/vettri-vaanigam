-- PART 08 — Failure-First Recovery: payment-failure recovery proposal
-- linkage, one order/cart supporting multiple checkout/payment attempts
-- over its lifetime, and payment attempt lineage.

-- AlterTable: GrowthActionProposal gains soft-pointer fields for a
-- payment-failure recovery proposal (never set by the PART 04
-- buyer-budget RECOVERY variant).
ALTER TABLE "GrowthActionProposal"
  ADD COLUMN "recoveryAction" TEXT,
  ADD COLUMN "sourceOrderId" TEXT,
  ADD COLUMN "sourcePaymentId" TEXT,
  ADD COLUMN "sourceCheckoutId" TEXT;

-- CreateIndex
CREATE INDEX "GrowthActionProposal_sourceOrderId_idx" ON "GrowthActionProposal"("sourceOrderId");

-- DropIndex: CheckoutSession.orderId is no longer unique — a bounded
-- recovery retry creates a NEW CheckoutSession against the SAME
-- (immutable) Order rather than a new Order per attempt.
DROP INDEX "CheckoutSession_orderId_key";

-- CreateIndex
CREATE INDEX "CheckoutSession_orderId_idx" ON "CheckoutSession"("orderId");

-- AlterTable: Payment gains self-referential attempt lineage.
ALTER TABLE "Payment" ADD COLUMN "recoveredFromAttemptId" TEXT;

-- CreateIndex
CREATE INDEX "Payment_recoveredFromAttemptId_idx" ON "Payment"("recoveredFromAttemptId");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_recoveredFromAttemptId_fkey" FOREIGN KEY ("recoveredFromAttemptId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
