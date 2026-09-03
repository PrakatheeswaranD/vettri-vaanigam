-- PART 10 — "yes" must mean the thing THIS conversation just quoted.
--
-- The pending proposal was looked up by BUYER, not by conversation, so an
-- affirmation in a fresh conversation could authorize a purchase that had
-- been priced in a different one. A buyer saying "yes" means the item the
-- agent just showed them; nothing else in the schema could express which
-- item that was.
--
-- Caught by a test asserting that "yes" on a fresh conversation authorizes
-- nothing — it returned CHECKOUT_READY, having found and authorized a
-- proposal from an entirely different conversation.
--
-- Nullable with no default: a conversation that has quoted nothing has
-- nothing pending, which is the correct and common state.
ALTER TABLE "BuyerConversation"
  ADD COLUMN IF NOT EXISTS "pendingProposalId" TEXT;
