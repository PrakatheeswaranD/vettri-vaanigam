import { describe, expect, it } from "vitest";
import { computeProposalFingerprint, type ProposalFingerprintFacts } from "./fingerprint.js";

function baseFacts(overrides: Partial<ProposalFingerprintFacts> = {}): ProposalFingerprintFacts {
  return {
    proposalId: "11111111-1111-1111-1111-111111111111",
    merchantId: "22222222-2222-2222-2222-222222222222",
    actionType: "CROSS_SELL",
    primaryProductId: "33333333-3333-3333-3333-333333333333",
    relatedProductIds: ["44444444-4444-4444-4444-444444444444"],
    offerKind: "PERCENTAGE",
    offerPercentageBps: 500,
    offerAmountMinor: null,
    currency: "INR",
    ...overrides,
  };
}

describe("computeProposalFingerprint (PART 05 §16-§18, §94)", () => {
  it("produces the same fingerprint for identical semantic content", () => {
    expect(computeProposalFingerprint(baseFacts())).toBe(computeProposalFingerprint(baseFacts()));
  });

  it("changes when the discount changes", () => {
    const a = computeProposalFingerprint(baseFacts({ offerPercentageBps: 500 }));
    const b = computeProposalFingerprint(baseFacts({ offerPercentageBps: 800 }));
    expect(a).not.toBe(b);
  });

  it("changes when the related product set changes", () => {
    const a = computeProposalFingerprint(baseFacts({ relatedProductIds: ["44444444-4444-4444-4444-444444444444"] }));
    const b = computeProposalFingerprint(baseFacts({ relatedProductIds: ["55555555-5555-5555-5555-555555555555"] }));
    expect(a).not.toBe(b);
  });

  it("changes when the currency changes", () => {
    const a = computeProposalFingerprint(baseFacts({ currency: "INR" }));
    const b = computeProposalFingerprint(baseFacts({ currency: "USD" }));
    expect(a).not.toBe(b);
  });

  it("changes when the action type changes", () => {
    const a = computeProposalFingerprint(baseFacts({ actionType: "CROSS_SELL" }));
    const b = computeProposalFingerprint(baseFacts({ actionType: "UPSELL" }));
    expect(a).not.toBe(b);
  });

  it("is unaffected by related-product array order (canonical sort)", () => {
    const a = computeProposalFingerprint(baseFacts({ relatedProductIds: ["a-id", "b-id"] }));
    const b = computeProposalFingerprint(baseFacts({ relatedProductIds: ["b-id", "a-id"] }));
    expect(a).toBe(b);
  });

  it("changes when a different proposal id is used (fingerprint is proposal-scoped)", () => {
    const a = computeProposalFingerprint(baseFacts({ proposalId: "11111111-1111-1111-1111-111111111111" }));
    const b = computeProposalFingerprint(baseFacts({ proposalId: "66666666-6666-6666-6666-666666666666" }));
    expect(a).not.toBe(b);
  });
});
