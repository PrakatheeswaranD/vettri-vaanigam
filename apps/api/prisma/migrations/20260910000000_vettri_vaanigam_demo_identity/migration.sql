-- Rebrand only seeded demo identities, preserving IDs, passwords and sessions.
-- Never edit previously applied migrations: their checksums are historical.
UPDATE "MerchantUser" AS account
SET "email" = 'customer@vettrivaanigam.demo'
FROM "Merchant" AS context
WHERE account."merchantId" = context."id"
  AND context."slug" = 'demo-customer-context'
  AND account."email" = 'customer@vaanigam.demo'
  AND NOT EXISTS (SELECT 1 FROM "MerchantUser" WHERE "email" = 'customer@vettrivaanigam.demo');

UPDATE "MerchantUser" AS account
SET "email" = 'admin@vettrivaanigam.demo'
FROM "Merchant" AS context
WHERE account."merchantId" = context."id"
  AND context."slug" = 'demo-platform-context'
  AND account."email" = 'admin@vaanigam.demo'
  AND NOT EXISTS (SELECT 1 FROM "MerchantUser" WHERE "email" = 'admin@vettrivaanigam.demo');
