import { describe, it, expect } from "vitest";
import {
  computeCampaignLift,
  observedOfferLiftBps,
  MIN_COHORT_FOR_LIFT,
  type CohortResult,
  type CampaignLift,
} from "./campaign-lift.js";

function cohort(overrides: Partial<CohortResult> = {}): CohortResult {
  return { subjects: 20, impressions: 100, conversions: 10, observedRevenueMinor: 1_000_000, ...overrides };
}

describe("campaign lift — refusing to claim what the sample cannot support", () => {
  it("reports no lift at all when the merchant ran no holdout", () => {
    const lift = computeCampaignLift(cohort(), cohort({ subjects: 0, impressions: 0, conversions: 0, observedRevenueMinor: 0 }));

    expect(lift.basis).toBe("NO_HOLDOUT");
    expect(lift.liftBps).toBeNull();
    expect(lift.attributableRevenueMinor).toBeNull();
    // The revenue is still real — only the attribution is unavailable.
    expect(lift.explanation).toContain("cannot be attributed");
  });

  it("refuses to compare cohorts below the sample floor", () => {
    const lift = computeCampaignLift(
      cohort({ subjects: MIN_COHORT_FOR_LIFT - 1 }),
      cohort({ subjects: MIN_COHORT_FOR_LIFT - 1 }),
    );

    expect(lift.basis).toBe("INSUFFICIENT_SAMPLE");
    expect(lift.liftBps).toBeNull();
    expect(lift.attributableRevenueMinor).toBeNull();
    // Both rates are still shown — they are observations. Only the
    // DIFFERENCE between them is withheld.
    expect(lift.treatmentRateBps).not.toBeNull();
    expect(lift.controlRateBps).not.toBeNull();
  });

  it("refuses when a cohort has had no impressions", () => {
    const lift = computeCampaignLift(cohort(), cohort({ impressions: 0, conversions: 0 }));
    expect(lift.basis).toBe("INSUFFICIENT_SAMPLE");
    expect(lift.liftBps).toBeNull();
  });
});

describe("campaign lift — what a real holdout supports", () => {
  it("measures the difference between the two cohorts", () => {
    const lift = computeCampaignLift(
      cohort({ impressions: 100, conversions: 20 }), // 20%
      cohort({ impressions: 100, conversions: 10 }), // 10%
    );

    expect(lift.basis).toBe("MEASURED_AGAINST_HOLDOUT");
    expect(lift.treatmentRateBps).toBe(2_000);
    expect(lift.controlRateBps).toBe(1_000);
    expect(lift.liftBps).toBe(1_000);
  });

  it("attributes only the revenue above what the holdout predicts", () => {
    const lift = computeCampaignLift(
      cohort({ impressions: 100, conversions: 20, observedRevenueMinor: 1_000_000 }),
      cohort({ impressions: 100, conversions: 10 }),
    );

    // At the control's 10% rate, the treatment group's ₹10,000 would have
    // been ₹5,000. Half the revenue is attributable, not all of it.
    expect(lift.attributableRevenueMinor).toBe(500_000);
    expect(lift.attributableRevenueMinor).toBeLessThan(1_000_000);
  });

  it("reports a negative lift plainly rather than flooring it at zero", () => {
    const lift = computeCampaignLift(
      cohort({ impressions: 100, conversions: 5 }), // 5%
      cohort({ impressions: 100, conversions: 15 }), // 15%
    );

    expect(lift.liftBps).toBe(-1_000);
    // A campaign losing to its own holdout is the most useful thing this
    // can tell a merchant, and the easiest to hide.
    expect(lift.explanation).toContain("BELOW");
    // "Negative attributed revenue" is not a coherent thing to print.
    expect(lift.attributableRevenueMinor).toBe(0);
  });

  it("says plainly when an offer made no difference", () => {
    const lift = computeCampaignLift(
      cohort({ impressions: 100, conversions: 10 }),
      cohort({ impressions: 100, conversions: 10 }),
    );
    expect(lift.liftBps).toBe(0);
    expect(lift.explanation).toContain("no measurable difference");
  });
});

describe("learning — only from lifts that were actually measured", () => {
  function measured(liftBps: number): CampaignLift {
    return {
      basis: "MEASURED_AGAINST_HOLDOUT",
      treatmentRateBps: 2_000,
      controlRateBps: 2_000 - liftBps,
      liftBps,
      attributableRevenueMinor: 0,
      explanation: "",
    };
  }

  it("returns null when nothing has been measured, so the engine keeps withholding", () => {
    expect(observedOfferLiftBps([])).toBeNull();
    expect(
      observedOfferLiftBps([
        { basis: "NO_HOLDOUT", treatmentRateBps: 2_000, controlRateBps: null, liftBps: null, attributableRevenueMinor: null, explanation: "" },
        { basis: "INSUFFICIENT_SAMPLE", treatmentRateBps: 2_000, controlRateBps: 1_000, liftBps: null, attributableRevenueMinor: null, explanation: "" },
      ]),
    ).toBeNull();
  });

  it("averages the measured lifts", () => {
    expect(observedOfferLiftBps([measured(1_000), measured(2_000)])).toBe(1_500);
  });

  it("never returns a negative rate to forecast with", () => {
    // A campaign that lost money is evidence to stop, not a negative
    // multiplier to apply to a future opportunity.
    expect(observedOfferLiftBps([measured(-2_000)])).toBe(0);
  });

  it("ignores unmeasured campaigns when averaging", () => {
    const lifts = [
      measured(1_000),
      { basis: "NO_HOLDOUT" as const, treatmentRateBps: 9_000, controlRateBps: null, liftBps: null, attributableRevenueMinor: null, explanation: "" },
    ];
    expect(observedOfferLiftBps(lifts)).toBe(1_000);
  });
});
