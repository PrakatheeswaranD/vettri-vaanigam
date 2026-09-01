-- Automated customer negotiation.
--
-- A shopper asks for a better price; deterministic code reads their own
-- settled history and answers. Within what they have earned it applies
-- immediately; above that it goes to the merchant; past the merchant's
-- stated maximum it is refused with a counter-offer of what they have
-- actually earned.
--
-- WHY preNegotiationTotalMinor EXISTS
--
-- Applying a discount reduces `computedTotalMinor`. Without a record of
-- what it was reduced FROM, the amount given away is unrecoverable, and a
-- merchant auditing their own margin has no baseline to audit against.
ALTER TABLE "DecisionRecord" ADD COLUMN IF NOT EXISTS "negotiationRequestedBps" INTEGER;
ALTER TABLE "DecisionRecord" ADD COLUMN IF NOT EXISTS "negotiationStatus" TEXT;
ALTER TABLE "DecisionRecord" ADD COLUMN IF NOT EXISTS "negotiationExplanation" TEXT;
ALTER TABLE "DecisionRecord" ADD COLUMN IF NOT EXISTS "customerTierAtDecision" TEXT;
ALTER TABLE "DecisionRecord" ADD COLUMN IF NOT EXISTS "preNegotiationTotalMinor" INTEGER;

-- The percentage bands, and the absolute rupee stop that makes automating
-- this safe. A percentage alone is not a limit on a large basket.
ALTER TABLE "AgentGatewayPolicy" ADD COLUMN IF NOT EXISTS "negotiationAutoApplyCeilingBps" INTEGER NOT NULL DEFAULT 500;
ALTER TABLE "AgentGatewayPolicy" ADD COLUMN IF NOT EXISTS "negotiationMaxDiscountBps" INTEGER NOT NULL DEFAULT 1500;
ALTER TABLE "AgentGatewayPolicy" ADD COLUMN IF NOT EXISTS "negotiationMaxAutoApplyMinor" INTEGER NOT NULL DEFAULT 200000;
ALTER TABLE "AgentGatewayPolicy" ADD COLUMN IF NOT EXISTS "negotiationAutomationEnabled" BOOLEAN NOT NULL DEFAULT true;

-- Merchants reviewing pending negotiations, and the history query behind
-- every customer's tier.
CREATE INDEX IF NOT EXISTS "DecisionRecord_merchantId_negotiationStatus_idx"
  ON "DecisionRecord" ("merchantId", "negotiationStatus");
