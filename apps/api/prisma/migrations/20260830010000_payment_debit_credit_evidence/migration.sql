CREATE TYPE "CustomerDebitStatus" AS ENUM ('UNKNOWN', 'NOT_DEBITED', 'DEBITED');
CREATE TYPE "MerchantCreditStatus" AS ENUM ('UNKNOWN', 'NOT_CREDITED', 'CREDITED');

ALTER TABLE "Payment"
  ADD COLUMN "customerDebitStatus" "CustomerDebitStatus" NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "merchantCreditStatus" "MerchantCreditStatus" NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "automaticRetryBlocked" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "Payment_automaticRetryBlocked_idx" ON "Payment"("automaticRetryBlocked");
