import { describe, expect, it } from "vitest";
import {
  computeOverallScore,
  computeWeightedOverallScore,
  deriveReadinessRecommendations,
  findStrongestDimension,
  findWeakestDimension,
  READINESS_DIMENSIONS,
  type ReadinessDimensionScores,
} from "./readiness";
import { READINESS_WEIGHTS } from "./readiness-config";

const scores: ReadinessDimensionScores = {
  catalogCompleteness: 92,
  aiDiscoverability: 88,
  priceFreshness: 96,
  inventoryReliability: 81,
  policyCompleteness: 74,
  checkoutReadiness: 91,
  paymentReliability: 95,
  metadataQuality: 85,
  trustInformation: 90,
};

describe("readiness dimension rules", () => {
  it("has nine dimensions (PART 02 §30)", () => {
    expect(READINESS_DIMENSIONS).toHaveLength(9);
  });

  it("identifies the weakest dimension deterministically", () => {
    expect(findWeakestDimension(scores)).toEqual({ dimension: "policyCompleteness", score: 74 });
  });

  it("identifies the strongest dimension deterministically", () => {
    expect(findStrongestDimension(scores)).toEqual({ dimension: "priceFreshness", score: 96 });
  });

  it("breaks weakest-dimension ties by dimension declaration order", () => {
    const tied: ReadinessDimensionScores = {
      catalogCompleteness: 70,
      aiDiscoverability: 70,
      priceFreshness: 90,
      inventoryReliability: 90,
      policyCompleteness: 90,
      checkoutReadiness: 90,
      paymentReliability: 90,
      metadataQuality: 90,
      trustInformation: 90,
    };
    expect(findWeakestDimension(tied).dimension).toBe("catalogCompleteness");
  });

  it("computes the unweighted overall score as the mean of dimensions, rounded", () => {
    expect(computeOverallScore(scores)).toBe(88);
  });

  it("computes the weighted overall score using centralized weights", () => {
    const weighted = computeWeightedOverallScore(scores, READINESS_WEIGHTS);
    // Manually computed expected value from the documented weights.
    const expectedSum =
      92 * 15 + 88 * 10 + 96 * 12 + 81 * 13 + 74 * 12 + 91 * 15 + 95 * 10 + 85 * 8 + 90 * 5;
    expect(weighted).toBe(Math.round(expectedSum / 100));
  });

  it("weighted score is always between 0 and 100 for in-range inputs", () => {
    const allZero: ReadinessDimensionScores = {
      catalogCompleteness: 0,
      aiDiscoverability: 0,
      priceFreshness: 0,
      inventoryReliability: 0,
      policyCompleteness: 0,
      checkoutReadiness: 0,
      paymentReliability: 0,
      metadataQuality: 0,
      trustInformation: 0,
    };
    const allHundred: ReadinessDimensionScores = { ...allZero };
    for (const d of READINESS_DIMENSIONS) allHundred[d] = 100;

    expect(computeWeightedOverallScore(allZero)).toBe(0);
    expect(computeWeightedOverallScore(allHundred)).toBe(100);
  });

  it("derives a recommendation only for dimensions below threshold", () => {
    const recommendations = deriveReadinessRecommendations(scores);
    // Only policyCompleteness (74) is below 80.
    expect(recommendations).toHaveLength(1);
    expect(recommendations[0]).toMatch(/shipping and return-policy/i);
  });

  it("produces no recommendations when every dimension meets threshold", () => {
    const strong: ReadinessDimensionScores = {
      catalogCompleteness: 90,
      aiDiscoverability: 90,
      priceFreshness: 90,
      inventoryReliability: 90,
      policyCompleteness: 90,
      checkoutReadiness: 90,
      paymentReliability: 90,
      metadataQuality: 90,
      trustInformation: 90,
    };
    expect(deriveReadinessRecommendations(strong)).toHaveLength(0);
  });

  it("produces multiple recommendations in dimension order when several are weak", () => {
    const weak: ReadinessDimensionScores = {
      catalogCompleteness: 60,
      aiDiscoverability: 90,
      priceFreshness: 90,
      inventoryReliability: 90,
      policyCompleteness: 60,
      checkoutReadiness: 90,
      paymentReliability: 90,
      metadataQuality: 90,
      trustInformation: 90,
    };
    const recommendations = deriveReadinessRecommendations(weak);
    expect(recommendations).toHaveLength(2);
    expect(recommendations[0]).toMatch(/structured product attributes/i);
    expect(recommendations[1]).toMatch(/shipping and return-policy/i);
  });
});
