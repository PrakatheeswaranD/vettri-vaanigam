-- Repair buyer policies seeded with categories nobody sells.
--
-- The first-contact default was a fixed list — Electronics/Laptop, Books,
-- Accessories — that no merchant in this system stocks. Every first
-- purchase therefore came back CATEGORY_NOT_ALLOWED on the merchant's own
-- headline product, phrased as though the shopper had done something
-- wrong. A default that only ever fires on legitimate purchases is not a
-- safe default; it is a broken one, and its real effect is that people
-- turn the check off.
--
-- New policies are now seeded from the merchant's real active categories.
-- This repairs the rows already written.
--
-- DELIBERATELY NARROW: it matches only the exact broken default. A shopper
-- who has since narrowed their own allow-list has made a real choice, and
-- silently widening it would be a worse bug than the one being fixed.
UPDATE "BuyerSpendingPolicy" bsp
   SET "allowedCategories" = COALESCE(
         (
           SELECT jsonb_agg(DISTINCT p."category")
             FROM "Product" p
            WHERE p."merchantId" = bsp."merchantId"
              AND p."status" = 'ACTIVE'
         ),
         bsp."allowedCategories"
       )
 WHERE bsp."allowedCategories" @> '["Electronics/Laptop"]'::jsonb
   AND bsp."allowedCategories" @> '["Books"]'::jsonb
   AND bsp."allowedCategories" @> '["Accessories"]'::jsonb
   AND jsonb_array_length(bsp."allowedCategories") = 3;
