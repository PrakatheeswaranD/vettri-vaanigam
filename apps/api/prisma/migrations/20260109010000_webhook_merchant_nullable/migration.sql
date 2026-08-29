-- PART 10 §1 — a Razorpay webhook is authenticated by HMAC signature,
-- never a merchant session, so the owning merchant is only knowable
-- AFTER the event's providerOrderId resolves to a real Payment row.
-- Drop the old (single-tenant-era) NOT NULL requirement.

-- DropForeignKey
ALTER TABLE "PaymentProviderEvent" DROP CONSTRAINT "PaymentProviderEvent_merchantId_fkey";

-- AlterTable
ALTER TABLE "PaymentProviderEvent" ALTER COLUMN "merchantId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "PaymentProviderEvent" ADD CONSTRAINT "PaymentProviderEvent_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
