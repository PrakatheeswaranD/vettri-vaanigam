-- The merchant's half of the unattended-cycle switch.
--
-- DEFAULT false is the whole point of this column. The agent cycle already
-- existed and already respected policy; what did not exist was any record
-- of a merchant AGREEING that it may run while they are not watching.
-- Every existing row therefore starts opted out, and stays opted out until
-- an OWNER changes it through PATCH /merchant-agent/growth/config.
--
-- The operator's own AGENT_SCHEDULER_ENABLED must also be set before any
-- scheduled cycle runs. Neither switch relaxes policy: a scheduled cycle is
-- the same run the merchant triggers by hand.
ALTER TABLE "MerchantGrowthConfig"
  ADD COLUMN IF NOT EXISTS "autonomousRunsEnabled" BOOLEAN NOT NULL DEFAULT false;
