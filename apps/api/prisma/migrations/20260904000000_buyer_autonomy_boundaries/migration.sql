-- PART 12 — the buyer boundaries that could not be expressed.
--
-- The policy had an approval threshold, a daily limit and an allow-list.
-- It had no way to say "never above this at all", "never this category",
-- "never this merchant", or "ask me every time".
--
-- DEFAULTS PRESERVE EXISTING BEHAVIOUR EXACTLY.
--
-- A column appearing must never silently start refusing purchases that
-- worked yesterday, so:
--   maxPurchaseAmountMinor  ₹10,00,000 — above any seeded basket
--   restrictedCategories    []         — nothing restricted
--   preferredCategories     []         — no preference stated
--   autoPurchaseEnabled     true       — under-limit purchases already
--                                        auto-approve; false would change
--                                        the product for people who never
--                                        asked
--   restrictedMerchantIds   []         — no merchant restricted
--
-- Every one is enforced in `createPurchaseProposal`, the single function
-- both the HTTP route and the Buyer Agent conversation call.
ALTER TABLE "BuyerSpendingPolicy"
  ADD COLUMN IF NOT EXISTS "maxPurchaseAmountMinor" INTEGER NOT NULL DEFAULT 100000000,
  ADD COLUMN IF NOT EXISTS "restrictedCategories"   JSONB   NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS "preferredCategories"    JSONB   NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS "autoPurchaseEnabled"    BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "restrictedMerchantIds"  JSONB   NOT NULL DEFAULT '[]';
