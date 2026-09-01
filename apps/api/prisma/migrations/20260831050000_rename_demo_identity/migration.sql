-- The product is now Vaanigam. The demo customer's login address carried
-- the old name.
--
-- A display rename would not need a migration; a CREDENTIAL rename does.
-- The sign-in screen posts a fixed demo address, so leaving the stored one
-- behind would mean the button silently stops working on any database
-- seeded before this change — the kind of breakage that only shows up in
-- front of an audience.
--
-- Scoped to the exact seeded demo address and guarded against a collision,
-- so it is a no-op on a database that has already been re-seeded.
UPDATE "MerchantUser"
   SET "email" = 'customer@vaanigam.demo'
 WHERE "email" = 'customer@anumati.demo'
   AND NOT EXISTS (
     SELECT 1 FROM "MerchantUser" existing WHERE existing."email" = 'customer@vaanigam.demo'
   );
