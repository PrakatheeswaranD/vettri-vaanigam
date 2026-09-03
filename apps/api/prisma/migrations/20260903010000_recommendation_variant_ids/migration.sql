-- PART 09 — persist the SPECIFIC variant a recommendation actually showed.
--
-- "recommendedProductIds" was already recorded; the exact variant (size,
-- colour, whichever attribute made it the one that satisfied the buyer's
-- constraints) was not. A later "buy it" therefore had nothing to resolve
-- against but the product's CHEAPEST active variant — which is frequently
-- not the one the buyer was actually looking at.
--
-- Parallel array, not folded into "recommendedProductIds": that column is
-- already read as a flat string[] of product ids by the revenue-opportunity
-- SQL and the Merchant Agent's eligibility check, and changing its shape
-- would break both silently. Defaulting to '[]' means historical rows keep
-- their prior (imperfect but working) fallback behaviour rather than
-- erroring.
ALTER TABLE "RecommendationRecord"
  ADD COLUMN IF NOT EXISTS "recommendedVariantIds" JSONB NOT NULL DEFAULT '[]';
