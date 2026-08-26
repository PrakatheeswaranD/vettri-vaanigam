-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('INR', 'USD');

-- CreateEnum
CREATE TYPE "MerchantStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('ACTIVE', 'DRAFT', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CartStatus" AS ENUM ('ACTIVE', 'CHECKED_OUT', 'ABANDONED');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentState" AS ENUM ('CREATED', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'CANCELLED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('DEMO', 'RAZORPAY');

-- CreateEnum
CREATE TYPE "AgentActorType" AS ENUM ('BUYER_AGENT', 'MERCHANT_AGENT', 'POLICY_ENGINE', 'CUSTOMER', 'SYSTEM');

-- CreateEnum
CREATE TYPE "AgentActionStatus" AS ENUM ('PROPOSED', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'EXPIRED', 'EXECUTED', 'FAILED', 'VERIFIED');

-- CreateEnum
CREATE TYPE "PolicyDecision" AS ENUM ('ALLOW', 'DENY', 'REQUIRE_APPROVAL');

-- CreateEnum
CREATE TYPE "OpportunityCategory" AS ENUM ('CROSS_SELL', 'UPSELL', 'CATALOG_GAP', 'READINESS_GAP', 'PAYMENT_RECOVERY');

-- CreateEnum
CREATE TYPE "OpportunityStatus" AS ENUM ('IDENTIFIED', 'PROPOSED', 'ACTED_ON');

-- CreateEnum
CREATE TYPE "ValueClassification" AS ENUM ('OBSERVED', 'ESTIMATED', 'OPPORTUNITY');

-- CreateTable
CREATE TABLE "Merchant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "defaultCurrency" "Currency" NOT NULL DEFAULT 'INR',
    "businessCategory" TEXT NOT NULL,
    "status" "MerchantStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Merchant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MerchantPolicy" (
    "merchantId" TEXT NOT NULL,
    "maxDiscountMinor" INTEGER NOT NULL,
    "maxDiscountPercent" INTEGER NOT NULL,
    "approvalThresholdMinor" INTEGER NOT NULL,
    "maxRecoveryAttempts" INTEGER NOT NULL,
    "maxOrderAmountMinor" INTEGER NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'INR',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MerchantPolicy_pkey" PRIMARY KEY ("merchantId")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "email" TEXT,
    "segment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "status" "ProductStatus" NOT NULL DEFAULT 'ACTIVE',
    "returnPolicySummary" TEXT,
    "shippingSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductVariant" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "priceMinor" INTEGER NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'INR',
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Inventory" (
    "variantId" TEXT NOT NULL,
    "availableQuantity" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Inventory_pkey" PRIMARY KEY ("variantId")
);

-- CreateTable
CREATE TABLE "Cart" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "customerId" TEXT,
    "status" "CartStatus" NOT NULL DEFAULT 'ACTIVE',
    "currency" "Currency" NOT NULL DEFAULT 'INR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CartItem" (
    "id" TEXT NOT NULL,
    "cartId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPriceMinor" INTEGER NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'INR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CartItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "customerId" TEXT,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "totalAmountMinor" INTEGER NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'INR',
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "productNameSnapshot" TEXT NOT NULL,
    "variantTitleSnapshot" TEXT NOT NULL,
    "unitPriceMinor" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "lineTotalMinor" INTEGER NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'INR',

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL DEFAULT 'DEMO',
    "providerRef" TEXT,
    "amountMinor" INTEGER NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'INR',
    "state" "PaymentState" NOT NULL DEFAULT 'CREATED',
    "failureCode" TEXT,
    "failureCategory" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "capturedAt" TIMESTAMP(3),

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentAction" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "agentRunId" TEXT,
    "merchantId" TEXT NOT NULL,
    "actorType" "AgentActorType" NOT NULL,
    "actionType" TEXT NOT NULL,
    "status" "AgentActionStatus" NOT NULL DEFAULT 'PROPOSED',
    "conciseReason" TEXT NOT NULL,
    "policyDecision" "PolicyDecision",
    "relatedEntityType" TEXT,
    "relatedEntityId" TEXT,
    "metadata" JSONB,
    "isSyntheticDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "executedAt" TIMESTAMP(3),

    CONSTRAINT "AgentAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReadinessSnapshot" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "overallScore" INTEGER NOT NULL,
    "catalogCompleteness" INTEGER NOT NULL,
    "aiDiscoverability" INTEGER NOT NULL,
    "priceFreshness" INTEGER NOT NULL,
    "inventoryReliability" INTEGER NOT NULL,
    "policyCompleteness" INTEGER NOT NULL,
    "checkoutReadiness" INTEGER NOT NULL,
    "paymentReliability" INTEGER NOT NULL,
    "weakestDimension" TEXT NOT NULL,
    "strongestDimension" TEXT NOT NULL,
    "recommendations" JSONB NOT NULL,
    "isSyntheticDemo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReadinessSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GrowthOpportunity" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "category" "OpportunityCategory" NOT NULL,
    "signal" TEXT NOT NULL,
    "recommendation" TEXT NOT NULL,
    "estimatedValueMinor" INTEGER,
    "currency" "Currency",
    "valueClassification" "ValueClassification" NOT NULL DEFAULT 'OPPORTUNITY',
    "status" "OpportunityStatus" NOT NULL DEFAULT 'IDENTIFIED',
    "isSyntheticDemo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GrowthOpportunity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Merchant_slug_key" ON "Merchant"("slug");

-- CreateIndex
CREATE INDEX "Customer_merchantId_idx" ON "Customer"("merchantId");

-- CreateIndex
CREATE INDEX "Product_merchantId_category_idx" ON "Product"("merchantId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "Product_merchantId_slug_key" ON "Product"("merchantId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_productId_sku_key" ON "ProductVariant"("productId", "sku");

-- CreateIndex
CREATE INDEX "Cart_merchantId_status_idx" ON "Cart"("merchantId", "status");

-- CreateIndex
CREATE INDEX "CartItem_cartId_idx" ON "CartItem"("cartId");

-- CreateIndex
CREATE INDEX "Order_merchantId_createdAt_idx" ON "Order"("merchantId", "createdAt");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");

-- CreateIndex
CREATE INDEX "Payment_orderId_idx" ON "Payment"("orderId");

-- CreateIndex
CREATE INDEX "Payment_state_idx" ON "Payment"("state");

-- CreateIndex
CREATE INDEX "AgentAction_workflowId_idx" ON "AgentAction"("workflowId");

-- CreateIndex
CREATE INDEX "AgentAction_merchantId_createdAt_idx" ON "AgentAction"("merchantId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentAction_actorType_idx" ON "AgentAction"("actorType");

-- CreateIndex
CREATE INDEX "AgentAction_status_idx" ON "AgentAction"("status");

-- CreateIndex
CREATE INDEX "ReadinessSnapshot_merchantId_createdAt_idx" ON "ReadinessSnapshot"("merchantId", "createdAt");

-- CreateIndex
CREATE INDEX "GrowthOpportunity_merchantId_status_idx" ON "GrowthOpportunity"("merchantId", "status");

-- AddForeignKey
ALTER TABLE "MerchantPolicy" ADD CONSTRAINT "MerchantPolicy_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inventory" ADD CONSTRAINT "Inventory_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cart" ADD CONSTRAINT "Cart_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cart" ADD CONSTRAINT "Cart_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "Cart"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentAction" ADD CONSTRAINT "AgentAction_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReadinessSnapshot" ADD CONSTRAINT "ReadinessSnapshot_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrowthOpportunity" ADD CONSTRAINT "GrowthOpportunity_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- CheckConstraints (PART 01 §19 — protect invariants at the database
-- layer, not only in application code)
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_priceMinor_nonnegative" CHECK ("priceMinor" >= 0);
ALTER TABLE "Inventory" ADD CONSTRAINT "Inventory_availableQuantity_nonnegative" CHECK ("availableQuantity" >= 0);
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_unitPriceMinor_nonnegative" CHECK ("unitPriceMinor" >= 0);
ALTER TABLE "Order" ADD CONSTRAINT "Order_totalAmountMinor_nonnegative" CHECK ("totalAmountMinor" >= 0);
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_unitPriceMinor_nonnegative" CHECK ("unitPriceMinor" >= 0);
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_lineTotalMinor_nonnegative" CHECK ("lineTotalMinor" >= 0);
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_amountMinor_nonnegative" CHECK ("amountMinor" >= 0);
ALTER TABLE "MerchantPolicy" ADD CONSTRAINT "MerchantPolicy_maxDiscountPercent_range" CHECK ("maxDiscountPercent" >= 0 AND "maxDiscountPercent" <= 100);
ALTER TABLE "MerchantPolicy" ADD CONSTRAINT "MerchantPolicy_maxDiscountMinor_nonnegative" CHECK ("maxDiscountMinor" >= 0);
ALTER TABLE "MerchantPolicy" ADD CONSTRAINT "MerchantPolicy_approvalThresholdMinor_nonnegative" CHECK ("approvalThresholdMinor" >= 0);
ALTER TABLE "MerchantPolicy" ADD CONSTRAINT "MerchantPolicy_maxOrderAmountMinor_nonnegative" CHECK ("maxOrderAmountMinor" >= 0);
ALTER TABLE "MerchantPolicy" ADD CONSTRAINT "MerchantPolicy_maxRecoveryAttempts_nonnegative" CHECK ("maxRecoveryAttempts" >= 0);
ALTER TABLE "GrowthOpportunity" ADD CONSTRAINT "GrowthOpportunity_estimatedValueMinor_nonnegative" CHECK ("estimatedValueMinor" IS NULL OR "estimatedValueMinor" >= 0);
