/**
 * PART 04 §15 — connects a Buyer Agent NEAR_MATCH outcome to a real
 * Merchant Agent recovery proposal: a bounded discount sized to close
 * exactly the disclosed budget gap, never a guessed incentive. Purely
 * additive to the Buyer Agent turn — no proposal is generated until the
 * merchant/demo operator explicitly asks for one.
 */
import { useState } from "react";
import { Sparkles } from "lucide-react";
import { useProposeGrowthAction } from "../../hooks/use-merchant-agent";
import { GrowthProposalPanel } from "../merchant-agent/GrowthProposalPanel";
import { ApiError } from "../../lib/api-client";

export function RecoveryOfferPrompt({
  conversationId,
  recommendationId,
  primaryProductId,
}: {
  conversationId: string;
  recommendationId: string;
  primaryProductId: string;
}) {
  const [requested, setRequested] = useState(false);
  const proposeGrowthAction = useProposeGrowthAction();

  if (!requested) {
    return (
      <button
        type="button"
        onClick={() => {
          setRequested(true);
          proposeGrowthAction.mutate({ primaryProductId, conversationId, recommendationId });
        }}
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-ink hover:bg-surface-subtle"
      >
        <Sparkles size={14} />
        Ask the Merchant Agent for a recovery offer
      </button>
    );
  }

  if (proposeGrowthAction.isPending) {
    return <p className="text-sm text-ink-muted">Checking for a bounded recovery offer…</p>;
  }

  if (proposeGrowthAction.isError) {
    return (
      <p className="text-sm text-danger-text">
        {proposeGrowthAction.error instanceof ApiError ? proposeGrowthAction.error.message : "Could not generate a recovery proposal."}
      </p>
    );
  }

  return proposeGrowthAction.data ? <GrowthProposalPanel proposal={proposeGrowthAction.data} /> : null;
}
