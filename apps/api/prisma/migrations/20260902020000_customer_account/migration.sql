-- The shopper becomes a first-class row.
--
-- WHAT WAS WRONG
--
-- A shopper was a MerchantUser with role CUSTOMER inside a synthetic
-- merchant, and that merchant's id was reused as the partition key for
-- their spending policy and their buyer-agent conversations. So
-- "BuyerConversation"."merchantId" meant the SHOPPER on rows written by
-- /buyer/messages and the SELLER on rows written by anything merchant-side.
-- The AI Buyer Readiness score read it as the seller and therefore scored
-- merchants on the wrong rows entirely.
--
-- IDS ARE PRESERVED ON PURPOSE
--
-- Each CustomerAccount takes the id of the synthetic merchant it replaces.
-- "DecisionRecord"."protocolActorRef" is a free-form actor reference with
-- no foreign key, and it already holds those ids; preserving them means
-- every historical purchase still resolves to the right shopper with no
-- rewrite and no window in which the two disagree.

CREATE TABLE "CustomerAccount" (
    "id"          TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CustomerAccount_pkey" PRIMARY KEY ("id")
);

-- One account per synthetic merchant that actually hosts a CUSTOMER user.
-- Merchants with no CUSTOMER user are real sellers and are left alone.
INSERT INTO "CustomerAccount" ("id", "displayName", "createdAt", "updatedAt")
SELECT m."id", m."name", m."createdAt", CURRENT_TIMESTAMP
FROM "Merchant" m
WHERE EXISTS (
    SELECT 1 FROM "MerchantUser" u WHERE u."merchantId" = m."id" AND u."role" = 'CUSTOMER'
);

ALTER TABLE "MerchantUser" ADD COLUMN "customerAccountId" TEXT;
UPDATE "MerchantUser" SET "customerAccountId" = "merchantId" WHERE "role" = 'CUSTOMER';

CREATE UNIQUE INDEX "MerchantUser_customerAccountId_key" ON "MerchantUser"("customerAccountId");
ALTER TABLE "MerchantUser"
    ADD CONSTRAINT "MerchantUser_customerAccountId_fkey"
    FOREIGN KEY ("customerAccountId") REFERENCES "CustomerAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── BuyerSpendingPolicy ───────────────────────────────────────────────
-- Every row here was always the shopper's; the column just claimed to be
-- a merchant. A straight rename, then repoint the foreign key.
ALTER TABLE "BuyerSpendingPolicy" DROP CONSTRAINT IF EXISTS "BuyerSpendingPolicy_merchantId_fkey";
ALTER TABLE "BuyerSpendingPolicy" RENAME COLUMN "merchantId" TO "customerAccountId";
ALTER INDEX IF EXISTS "BuyerSpendingPolicy_merchantId_key" RENAME TO "BuyerSpendingPolicy_customerAccountId_key";

-- A policy whose owner is not a shopper is a policy for a row that could
-- never have signed in to use it. Removed rather than orphaned: leaving it
-- would fail the foreign key below and, worse, would keep a spending limit
-- alive that nothing can read or change.
DELETE FROM "BuyerSpendingPolicy"
WHERE "customerAccountId" NOT IN (SELECT "id" FROM "CustomerAccount");

ALTER TABLE "BuyerSpendingPolicy"
    ADD CONSTRAINT "BuyerSpendingPolicy_customerAccountId_fkey"
    FOREIGN KEY ("customerAccountId") REFERENCES "CustomerAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── BuyerConversation ─────────────────────────────────────────────────
ALTER TABLE "BuyerConversation" DROP CONSTRAINT IF EXISTS "BuyerConversation_merchantId_fkey";
ALTER TABLE "BuyerConversation" RENAME COLUMN "merchantId" TO "customerAccountId";
DROP INDEX IF EXISTS "BuyerConversation_merchantId_updatedAt_idx";

-- The seller-keyed rows. These are the ones that proved the column was
-- overloaded: written against a merchant id by code that thought this
-- table was merchant-scoped. There is no shopper to attribute them to —
-- inventing one would put fabricated conversations into a readiness score
-- — so they are removed along with their messages.
DELETE FROM "BuyerMessage"
WHERE "conversationId" IN (
    SELECT "id" FROM "BuyerConversation"
    WHERE "customerAccountId" NOT IN (SELECT "id" FROM "CustomerAccount")
);
DELETE FROM "RecommendationRecord"
WHERE "conversationId" IN (
    SELECT "id" FROM "BuyerConversation"
    WHERE "customerAccountId" NOT IN (SELECT "id" FROM "CustomerAccount")
);
DELETE FROM "BuyerConversation"
WHERE "customerAccountId" NOT IN (SELECT "id" FROM "CustomerAccount");

CREATE INDEX "BuyerConversation_customerAccountId_updatedAt_idx"
    ON "BuyerConversation"("customerAccountId", "updatedAt");
ALTER TABLE "BuyerConversation"
    ADD CONSTRAINT "BuyerConversation_customerAccountId_fkey"
    FOREIGN KEY ("customerAccountId") REFERENCES "CustomerAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
