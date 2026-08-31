CREATE TABLE "BuyerSpendingPolicy" (
  "id" TEXT NOT NULL,
  "merchantId" TEXT NOT NULL,
  "currency" "Currency" NOT NULL DEFAULT 'INR',
  "autonomousPurchaseLimitMinor" INTEGER NOT NULL DEFAULT 200000,
  "dailyLimitMinor" INTEGER NOT NULL DEFAULT 1000000,
  "allowedCategories" JSONB NOT NULL DEFAULT '[]',
  "approvalRequiredAboveLimit" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BuyerSpendingPolicy_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BuyerSpendingPolicy_merchantId_key" ON "BuyerSpendingPolicy"("merchantId");
ALTER TABLE "BuyerSpendingPolicy" ADD CONSTRAINT "BuyerSpendingPolicy_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
