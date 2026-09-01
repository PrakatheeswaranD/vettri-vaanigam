-- An explicit "all categories are permitted" state for buyer spending policies.
--
-- The allow-list is matched literally against a product's category, so a
-- shopper who typed "all" into the free-text categories field ended up with
-- a single category literally named "all" — and every purchase afterwards
-- was declined CATEGORY_NOT_ALLOWED, with a message implying the shopper
-- had done something wrong.
--
-- The fix is a real column, not a reserved word inside user-supplied text.
-- A magic string is unauditable (a deliberate "allow everything" is
-- indistinguishable from a typo) and is precisely the value a prompt
-- injection would try to get written into the list.
--
-- DEFAULT false: this column appearing must not widen a single existing
-- policy. Shoppers already holding a literal "all" keep their current
-- behaviour until they choose the toggle, which the console now surfaces.
ALTER TABLE "BuyerSpendingPolicy"
  ADD COLUMN "allowAllCategories" BOOLEAN NOT NULL DEFAULT false;
