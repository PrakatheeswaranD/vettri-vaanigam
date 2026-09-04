-- PART 18 — a merchant's price commitment gets a lifetime.
--
-- `findBuyerVisibleOffers` had no time bound in reach, so an offer
-- authorized months ago was quoted to a buyer as a live discount. Both
-- columns are additive and nullable/defaulted, so existing rows keep
-- exactly the meaning they had: a NULL `offerValidUntil` is an offer that
-- was committed under rules with no expiry, and it still stands.
ALTER TABLE "MerchantPolicy"
  ADD COLUMN IF NOT EXISTS "offerValidityHours" INTEGER NOT NULL DEFAULT 168;

ALTER TABLE "GrowthActionProposal"
  ADD COLUMN IF NOT EXISTS "offerValidUntil" TIMESTAMP(3);

-- Buyer-visible offer resolution filters on this alongside product and
-- status, and runs on every discovery request.
CREATE INDEX IF NOT EXISTS "GrowthActionProposal_offerValidUntil_idx"
  ON "GrowthActionProposal" ("offerValidUntil");
