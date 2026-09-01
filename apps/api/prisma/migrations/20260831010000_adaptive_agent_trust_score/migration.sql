-- Adaptive Agent Trust Score.
--
-- The score itself is a DERIVED view over DecisionRecords already being
-- written, so nothing here stores a running total that could drift from
-- the history it claims to summarise.
--
-- What IS stored is a per-decision SNAPSHOT: the score and band as they
-- stood at the moment a call was decided. A merchant reviewing why an
-- order went through six weeks ago must see the score that actually
-- applied then, not the score the agent has now. Recomputing on read
-- would let a later attack silently rewrite the stated reason for an
-- earlier approval.
--
-- Both columns are nullable: every historical row predates the feature,
-- and any decision the flat known/unknown binary made legitimately has no
-- score behind it.
ALTER TABLE "DecisionRecord" ADD COLUMN IF NOT EXISTS "trustScoreAtDecision" INTEGER;
ALTER TABLE "DecisionRecord" ADD COLUMN IF NOT EXISTS "trustBandAtDecision" TEXT;

-- The trust score counts an agent's attack-shaped and declined decisions.
-- Without this the aggregate is a sequential scan of the whole decision
-- history on every single gateway call.
CREATE INDEX IF NOT EXISTS "DecisionRecord_agentIdentityId_reasonCode_idx"
  ON "DecisionRecord" ("agentIdentityId", "reasonCode");
