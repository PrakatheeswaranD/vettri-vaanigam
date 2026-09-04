-- PART 13 — one journey, one hash chain.
--
-- The ledger workflow id was the per-turn `traceId`, so a buyer who
-- searched in one turn and bought in another wrote several unrelated
-- chains. The pipeline this product promises spans turns by definition,
-- so a per-turn workflow could never hold it.
--
-- Nullable with no backfill: existing conversations keep behaving exactly
-- as they did (the turn's traceId is used when this is null), and nothing
-- rewrites history that was genuinely written under other workflow ids.
ALTER TABLE "BuyerConversation" ADD COLUMN "workflowId" TEXT;

CREATE INDEX "BuyerConversation_workflowId_idx" ON "BuyerConversation"("workflowId");
