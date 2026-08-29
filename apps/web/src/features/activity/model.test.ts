import { describe, expect, it } from "vitest";
import type { AgentActionDTO } from "@razorgrowth/contracts";
import { buildActivityFeed } from "./model";

function action(
  overrides: Partial<AgentActionDTO> & Pick<AgentActionDTO, "actionType">,
): AgentActionDTO {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    workflowId: "11111111-1111-1111-1111-111111111111",
    agentRunId: null,
    merchantId: "22222222-2222-2222-2222-222222222222",
    actorType: "SYSTEM",
    status: "EXECUTED",
    conciseReason: `${overrides.actionType} happened`,
    policyDecision: null,
    relatedEntityType: null,
    relatedEntityId: null,
    metadata: null,
    sequence: 1,
    previousEventHash: null,
    eventHash: "hash",
    ledgerHashVersion: "1.0",
    isSyntheticDemo: false,
    createdAt: new Date(2026, 0, 1, 14, 30).toISOString(),
    executedAt: null,
    ...overrides,
  };
}

describe("buildActivityFeed", () => {
  it("maps known ledger action types to merchant-legible titles and actors", () => {
    const feed = buildActivityFeed([
      action({ actionType: "BUYER_INTENT_EXTRACTED" }),
      action({ actionType: "GROWTH_PROPOSAL_CREATED", id: "b" }),
      action({ actionType: "APPROVAL_APPROVED", id: "c" }),
      action({ actionType: "PAYMENT_CAPTURED", id: "d" }),
    ]);

    expect(feed.map((e) => e.title)).toEqual([
      "Buyer intent received",
      "Growth opportunity identified",
      "Merchant approved",
      "Payment captured",
    ]);
    expect(feed.map((e) => e.actor)).toEqual(["AI", "AI", "HUMAN", "PROVIDER"]);
    expect(feed.every((e) => e.unmapped === false)).toBe(true);
  });

  it("assigns tone by governance outcome, not by actor", () => {
    const feed = buildActivityFeed([
      action({ actionType: "POLICY_DENIED" }),
      action({ actionType: "APPROVAL_REQUESTED", id: "b" }),
      action({ actionType: "POLICY_ALLOWED", id: "c" }),
      action({ actionType: "CART_CREATED", id: "d" }),
    ]);

    expect(feed.map((e) => e.tone)).toEqual(["negative", "attention", "positive", "neutral"]);
  });

  it("surfaces an unrecognized action type instead of dropping it", () => {
    const feed = buildActivityFeed([action({ actionType: "PAYMENT_SOMETHING_ENTIRELY_NEW" })]);

    expect(feed).toHaveLength(1);
    expect(feed[0]!.unmapped).toBe(true);
    expect(feed[0]!.title).toBe("Payment something entirely new");
    expect(feed[0]!.actor).toBe("SYSTEM");
  });

  it("never rewrites the backend's own conciseReason", () => {
    const feed = buildActivityFeed([
      action({ actionType: "POLICY_DENIED", conciseReason: "Proposed discount 5000bps exceeds ceiling of 1000bps." }),
    ]);

    expect(feed[0]!.detail).toBe("Proposed discount 5000bps exceeds ceiling of 1000bps.");
  });

  it("preserves input order and row identity for every entry", () => {
    const feed = buildActivityFeed([
      action({ actionType: "PAYMENT_FAILED", id: "one" }),
      action({ actionType: "RECOVERY_PROPOSAL_CREATED", id: "two" }),
      action({ actionType: "PAYMENT_CAPTURED", id: "three" }),
    ]);

    expect(feed.map((e) => e.id)).toEqual(["one", "two", "three"]);
    expect(feed.map((e) => e.tone)).toEqual(["negative", "attention", "positive"]);
  });

  it("returns an empty feed for no ledger rows rather than inventing activity", () => {
    expect(buildActivityFeed([])).toEqual([]);
  });
});
