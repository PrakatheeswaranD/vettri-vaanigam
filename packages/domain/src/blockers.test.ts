import { describe, expect, it } from "vitest";
import { prioritizeBlockers, type ReadinessBlocker } from "./blockers";

function blocker(overrides: Partial<ReadinessBlocker>): ReadinessBlocker {
  return {
    dimension: "policyCompleteness",
    severity: "MEDIUM",
    code: "TEST",
    title: "test",
    explanation: "test",
    affectedCount: 1,
    totalCount: 10,
    remediation: "test",
    ...overrides,
  };
}

describe("prioritizeBlockers", () => {
  it("sorts CRITICAL before HIGH before MEDIUM before LOW", () => {
    const input = [
      blocker({ code: "LOW", severity: "LOW" }),
      blocker({ code: "CRITICAL", severity: "CRITICAL" }),
      blocker({ code: "MEDIUM", severity: "MEDIUM" }),
      blocker({ code: "HIGH", severity: "HIGH" }),
    ];
    const sorted = prioritizeBlockers(input);
    expect(sorted.map((b) => b.severity)).toEqual(["CRITICAL", "HIGH", "MEDIUM", "LOW"]);
  });

  it("within the same severity, sorts by affected count descending (bigger impact first)", () => {
    const input = [
      blocker({ code: "A", severity: "HIGH", affectedCount: 2 }),
      blocker({ code: "B", severity: "HIGH", affectedCount: 8 }),
      blocker({ code: "C", severity: "HIGH", affectedCount: 5 }),
    ];
    const sorted = prioritizeBlockers(input);
    expect(sorted.map((b) => b.code)).toEqual(["B", "C", "A"]);
  });

  it("never sorts alphabetically by title/code when severity or impact differ (PART 02 §98)", () => {
    const input = [
      blocker({ code: "Z_MISSING_PRICE", severity: "CRITICAL", affectedCount: 1 }),
      blocker({ code: "A_WEAK_DESCRIPTION", severity: "LOW", affectedCount: 20 }),
    ];
    const sorted = prioritizeBlockers(input);
    expect(sorted[0]!.code).toBe("Z_MISSING_PRICE");
  });

  it("does not mutate the input array", () => {
    const input = [blocker({ code: "A", severity: "LOW" }), blocker({ code: "B", severity: "CRITICAL" })];
    const originalOrder = input.map((b) => b.code);
    prioritizeBlockers(input);
    expect(input.map((b) => b.code)).toEqual(originalOrder);
  });
});
