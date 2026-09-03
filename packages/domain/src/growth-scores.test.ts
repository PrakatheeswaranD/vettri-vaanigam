import { describe, it, expect } from "vitest";
import {
  calculateRevenueGrowthScore,
  calculateAiBuyerCapabilityScore,
  type RevenueGrowthScoreInput,
  type AiBuyerCapabilityScoreInput,
} from "./growth-scores.js";

function growthInput(overrides: Partial<RevenueGrowthScoreInput> = {}): RevenueGrowthScoreInput {
  return {
    ordersWithPaymentAttempt: 0,
    paidOrderCount: 0,
    failedPaymentCount: 0,
    recoveredPaymentCount: 0,
    capturedRevenueMinor: 0,
    uncapturedAtRiskMinor: 0,
    customerCount: 0,
    repeatCustomerCount: 0,
    agentVisibleProductCount: 0,
    transactableProductCount: 0,
    sellingProductCount: 0,
    sellingProductsWithRelationshipCount: 0,
    proposalsExecuted: 0,
    proposalsCreated: 0,
    ...overrides,
  };
}

function buyerInput(overrides: Partial<AiBuyerCapabilityScoreInput> = {}): AiBuyerCapabilityScoreInput {
  return {
    conversationsWithExtractedIntent: 0,
    conversationCount: 0,
    groundedRecommendationCount: 0,
    transactableProductCount: 0,
    agentVisibleProductCount: 0,
    gatewayDecisionCount: 0,
    gatewayDenialCount: 0,
    agentAttributedCaptures: 0,
    agentAttributedPaymentAttempts: 0,
    verifiedMandateCount: 0,
    ...overrides,
  };
}

describe("revenue growth score", () => {
  it("scores zero for a merchant with no activity, rather than a flattering default", () => {
    expect(calculateRevenueGrowthScore(growthInput()).score).toBe(0);
  });

  it("adds up to exactly what its own components claim", () => {
    const result = calculateRevenueGrowthScore(
      growthInput({ ordersWithPaymentAttempt: 16, paidOrderCount: 9, customerCount: 8, repeatCustomerCount: 2 }),
    );
    const earned = result.components.reduce((sum, c) => sum + c.earned, 0);
    const max = result.components.reduce((sum, c) => sum + c.max, 0);
    expect(result.score).toBe(Math.round((earned * 100) / max));
    expect(max).toBe(100);
  });

  it("does NOT award recovery points to a merchant who has simply never had a failure", () => {
    // The absence of a problem is not evidence of a capability. This is
    // the difference between an honest score and a participation trophy.
    const result = calculateRevenueGrowthScore(growthInput({ failedPaymentCount: 0, recoveredPaymentCount: 0 }));
    const recovery = result.components.find((c) => c.key === "failure_recovery")!;
    expect(recovery.earned).toBe(0);
    expect(recovery.evidence).toContain("unproven");
  });

  it("awards recovery points in proportion to recoveries actually achieved", () => {
    const result = calculateRevenueGrowthScore(growthInput({ failedPaymentCount: 4, recoveredPaymentCount: 2 }));
    expect(result.components.find((c) => c.key === "failure_recovery")!.earned).toBe(10);
  });

  it("states an improvement path for every component that is not full", () => {
    const result = calculateRevenueGrowthScore(growthInput({ ordersWithPaymentAttempt: 16, paidOrderCount: 9 }));
    for (const component of result.components) {
      if (component.earned < component.max) expect(component.toImprove).not.toBeNull();
      else expect(component.toImprove).toBeNull();
    }
  });

  it("reaches 100 only when every component is genuinely full", () => {
    const result = calculateRevenueGrowthScore({
      ordersWithPaymentAttempt: 10,
      paidOrderCount: 10,
      failedPaymentCount: 3,
      recoveredPaymentCount: 3,
      capturedRevenueMinor: 1_000_000,
      uncapturedAtRiskMinor: 0,
      customerCount: 5,
      repeatCustomerCount: 5,
      agentVisibleProductCount: 20,
      transactableProductCount: 20,
      sellingProductCount: 8,
      sellingProductsWithRelationshipCount: 8,
      proposalsExecuted: 4,
      proposalsCreated: 4,
    });
    expect(result.score).toBe(100);
  });
});

describe("AI buyer capability score", () => {
  it("gives no credit for a policy gate that has never refused anything", () => {
    const halfProven = calculateAiBuyerCapabilityScore(buyerInput({ gatewayDecisionCount: 12, gatewayDenialCount: 0 }));
    const fullyProven = calculateAiBuyerCapabilityScore(buyerInput({ gatewayDecisionCount: 12, gatewayDenialCount: 1 }));

    const half = halfProven.components.find((c) => c.key === "policy_gate_proven")!;
    const full = fullyProven.components.find((c) => c.key === "policy_gate_proven")!;
    expect(half.earned).toBe(10);
    expect(full.earned).toBe(20);
    expect(half.toImprove).not.toBeNull();
  });

  it("scores capture on provider-verified captures, not on attempts", () => {
    const result = calculateAiBuyerCapabilityScore(buyerInput({ agentAttributedPaymentAttempts: 4, agentAttributedCaptures: 0 }));
    expect(result.components.find((c) => c.key === "verified_capture")!.earned).toBe(0);
  });

  it("caps the recommendation component so volume alone cannot inflate the score", () => {
    const ten = calculateAiBuyerCapabilityScore(buyerInput({ groundedRecommendationCount: 10 }));
    const thousand = calculateAiBuyerCapabilityScore(buyerInput({ groundedRecommendationCount: 1_000 }));
    expect(ten.score).toBe(thousand.score);
  });

  it("is zero for a system where nothing has actually run, however much is implemented", () => {
    expect(calculateAiBuyerCapabilityScore(buyerInput()).score).toBe(0);
  });
});
