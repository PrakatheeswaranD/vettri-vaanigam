import { describe, expect, it } from "vitest";
import { fallbackRank, type FallbackRankCandidate } from "./fallback-ranking.js";

function candidate(overrides: Partial<FallbackRankCandidate> = {}): FallbackRankCandidate {
  return {
    productId: "p1",
    priceMinor: 100000,
    readinessState: "AGENT_READY",
    preferenceMatchCount: 0,
    hasStrongMetadata: true,
    ...overrides,
  };
}

describe("fallbackRank", () => {
  it("ranks more preference matches first, ahead of everything else", () => {
    const ranked = fallbackRank([
      candidate({ productId: "low-pref", preferenceMatchCount: 0, priceMinor: 10 }),
      candidate({ productId: "high-pref", preferenceMatchCount: 2, priceMinor: 999999 }),
    ]);
    expect(ranked[0]).toBe("high-pref");
  });

  it("uses readiness as a tiebreaker, never overriding equal preference matches with worse readiness first", () => {
    const ranked = fallbackRank([
      candidate({ productId: "not-ready", readinessState: "NOT_READY" }),
      candidate({ productId: "ready", readinessState: "AGENT_READY" }),
    ]);
    expect(ranked[0]).toBe("ready");
  });

  it("prefers lower price when preference and readiness are tied", () => {
    const ranked = fallbackRank([
      candidate({ productId: "expensive", priceMinor: 500000 }),
      candidate({ productId: "cheap", priceMinor: 300000 }),
    ]);
    expect(ranked[0]).toBe("cheap");
  });

  it("is fully deterministic — same input always produces the same order", () => {
    const input = [
      candidate({ productId: "a", priceMinor: 200 }),
      candidate({ productId: "b", priceMinor: 100 }),
      candidate({ productId: "c", priceMinor: 300 }),
    ];
    expect(fallbackRank(input)).toEqual(fallbackRank(input));
  });
});
