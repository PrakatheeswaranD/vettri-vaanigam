-- PART 08 — the automation boundaries that had no enforcement.
--
-- Six of the nine boundaries a merchant is entitled to set either did not
-- exist or lived in "MerchantGrowthConfig", a second table the Policy
-- Engine did not read as policy. Every column below is now evaluated by
-- `evaluatePolicy`, a pure function the API calls before anything
-- executes.
--
-- DEFAULTS ARE THE PERMISSIVE READING OF EXISTING BEHAVIOUR.
--
-- This migration must not silently change what any existing merchant's
-- agent is allowed to do. So `recoveryEnabled` defaults true (recovery
-- worked before), `prohibitedActions` and `eligibleCategories` default
-- empty (nothing was prohibited, every category was eligible), and
-- `minCustomerPaidOrders` defaults 0 (no customer was excluded).
--
-- The two that are NOT purely permissive are deliberate:
--   minMarginBps               10%  — a floor of zero would mean the
--                                     column exists and enforces nothing
--   maxAutonomousActionsPerDay 50   — applies only to UNATTENDED runs,
--                                     which no merchant is opted into by
--                                     default (see autonomousRunsEnabled)
-- Neither can change the outcome of a merchant-triggered cycle today.

ALTER TABLE "MerchantPolicy"
  ADD COLUMN IF NOT EXISTS "minMarginBps"               INTEGER NOT NULL DEFAULT 1000,
  ADD COLUMN IF NOT EXISTS "maxAutonomousActionsPerDay" INTEGER NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS "recoveryEnabled"            BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "prohibitedActions"          JSONB   NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS "eligibleCategories"         JSONB   NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS "minCustomerPaidOrders"      INTEGER NOT NULL DEFAULT 0;

-- The lifecycle the spec names, completed.
--
-- Governance ended at AUTHORIZED, so an authorization that was issued and
-- then failed was indistinguishable from one still waiting to run. "What
-- did the agent actually do" could not be answered from the governance
-- rows alone; it had to be reassembled by joining to whatever each action
-- type happened to write.
--
-- These record WHAT HAPPENED, never how much money moved. VERIFIED means
-- the row execution claimed to write was read back and exists.
ALTER TYPE "GrowthProposalStatus" ADD VALUE IF NOT EXISTS 'EXECUTED';
ALTER TYPE "GrowthProposalStatus" ADD VALUE IF NOT EXISTS 'VERIFIED';
ALTER TYPE "GrowthProposalStatus" ADD VALUE IF NOT EXISTS 'FAILED';
