-- Correction to 20260831060000.
--
-- That migration read categories from `Product WHERE merchantId =
-- BuyerSpendingPolicy.merchantId`, which looks right and is not: a buyer
-- policy is keyed to the BUYER'S OWN context, and a buyer context sells
-- nothing. The subquery matched zero rows every time, COALESCE fell back
-- to the original value, and the broken default survived the repair.
--
-- A buyer can shop at any active merchant, so the allow-list a buyer
-- starts with is "categories that exist to be bought" — the union across
-- active merchants — not the catalogue of whichever shop they happened to
-- open first.
--
-- Still scoped to the exact broken default, so a shopper who has narrowed
-- their own list keeps it.
UPDATE "BuyerSpendingPolicy" bsp
   SET "allowedCategories" = COALESCE(
         (
           SELECT jsonb_agg(DISTINCT p."category")
             FROM "Product" p
             JOIN "Merchant" m ON m."id" = p."merchantId"
            WHERE p."status" = 'ACTIVE'
              AND m."status" = 'ACTIVE'
         ),
         bsp."allowedCategories"
       )
 WHERE bsp."allowedCategories" @> '["Electronics/Laptop"]'::jsonb
   AND bsp."allowedCategories" @> '["Books"]'::jsonb
   AND bsp."allowedCategories" @> '["Accessories"]'::jsonb
   AND jsonb_array_length(bsp."allowedCategories") = 3;
