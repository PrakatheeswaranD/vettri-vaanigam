/**
 * Proposal fingerprint (PART 05 §16-§18, §139-§140).
 *
 * A deterministic SHA-256 hash over exactly the financially meaningful
 * content of a `GrowthActionProposal` — action type, merchant, primary and
 * related product IDs, offer terms, currency. `Approval` and
 * `ExecutionAuthorization` each store the fingerprint that was true at the
 * moment they were created; if the underlying proposal's meaningful
 * content ever differs from that stored value, the fingerprint no longer
 * matches and the approval/authorization can no longer be used (PART 05
 * §30, §48). Deliberately excludes anything unstable or non-semantic:
 * database timestamps, row insertion order, UI formatting.
 */
import { createHash } from "node:crypto";
import { canonicalStringify } from "@razorgrowth/domain";

export const PROPOSAL_FINGERPRINT_VERSION = "1";

export interface ProposalFingerprintFacts {
  proposalId: string;
  merchantId: string;
  actionType: string | null;
  primaryProductId: string;
  relatedProductIds: string[];
  offerKind: string | null;
  offerPercentageBps: number | null;
  offerAmountMinor: number | null;
  currency: string | null;
}

export function computeProposalFingerprint(facts: ProposalFingerprintFacts): string {
  const canonical = canonicalStringify({
    v: PROPOSAL_FINGERPRINT_VERSION,
    proposalId: facts.proposalId,
    merchantId: facts.merchantId,
    actionType: facts.actionType,
    primaryProductId: facts.primaryProductId,
    // Sorted: the SET of related products is what's financially meaningful,
    // not the order they happen to be stored in.
    relatedProductIds: [...facts.relatedProductIds].sort(),
    offerKind: facts.offerKind,
    offerPercentageBps: facts.offerPercentageBps,
    offerAmountMinor: facts.offerAmountMinor,
    currency: facts.currency,
  });
  return createHash("sha256").update(canonical).digest("hex");
}
