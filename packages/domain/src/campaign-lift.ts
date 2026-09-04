/**
 * Campaign lift — the only place this product can make a causal claim.
 *
 * WHY THIS IS DIFFERENT FROM EVERY OTHER NUMBER IN THE ENGINE
 *
 * The Revenue Opportunity Engine deliberately refuses to claim uplift. It
 * can say "this money is uncaptured" and "your own history recovers 34% of
 * failures", but it cannot say "the agent caused this", because nothing is
 * held back for comparison. Provenance is not attribution, and the console
 * says so out loud.
 *
 * Campaigns are the exception, and they were built that way on purpose:
 * `cohortFor()` hash-buckets every subject into CONTROL or TREATMENT before
 * any offer is made, deterministically and before the outcome is known.
 * That is a real holdout. With one, the difference between the two cohorts
 * IS attributable — it is the only number in this codebase that survives
 * the question "how do you know the agent did that?".
 *
 * And it was invisible. The cohorts were assigned, the conversions were
 * recorded, the endpoint returned both — and no screen rendered any of it.
 *
 * WHAT THIS REFUSES TO DO
 *
 * A holdout does not make a small sample meaningful. Two conversions out of
 * three control subjects is a 67% rate that means nothing, and subtracting
 * it from a treatment rate produces a confident-looking number built on
 * noise. So the same discipline the rest of the engine uses applies here:
 * below the minimum sample, no lift is reported at all and the reason is
 * stated. There is no "directionally positive" middle ground — that phrase
 * exists to let people quote numbers they should not.
 */

/**
 * Subjects per cohort before a comparison is offered.
 *
 * Not a statistical significance test — this build does not have the
 * traffic to run one honestly, and pretending otherwise with a p-value
 * would be worse than a stated floor. It is a floor below which the
 * arithmetic is obviously meaningless, chosen to match
 * `MIN_SAMPLE_FOR_OBSERVED_RATE` so a merchant meets one rule, not two.
 */
export const MIN_COHORT_FOR_LIFT = 5;

export interface CohortResult {
  subjects: number;
  impressions: number;
  conversions: number;
  observedRevenueMinor: number;
}

export type LiftBasis = "MEASURED_AGAINST_HOLDOUT" | "INSUFFICIENT_SAMPLE" | "NO_HOLDOUT";

export interface CampaignLift {
  basis: LiftBasis;
  /** Conversion rate in basis points, or null when not derivable. */
  treatmentRateBps: number | null;
  controlRateBps: number | null;
  /** Treatment minus control, in basis points. Signed: a campaign that
   * performed WORSE than doing nothing reports a negative lift rather
   * than being quietly floored at zero. */
  liftBps: number | null;
  /**
   * Revenue the holdout says would not have happened otherwise.
   *
   * Treatment revenue minus what the control rate predicts treatment
   * would have earned. Null whenever `liftBps` is null — an attributed
   * amount with no measured lift behind it is exactly the fabrication this
   * whole codebase refuses.
   */
  attributableRevenueMinor: number | null;
  /** Two-sided normal-approximation confidence that the observed rates
   * differ. This is evidence strength, not a guarantee of future lift. */
  statisticalConfidenceBps?: number | null;
  /** Stated verbatim to the merchant. Always explains the basis, including
   * — especially — when there is nothing to report. */
  explanation: string;
}

function normalCdf(value: number): number {
  // Abramowitz-Stegun approximation; sufficient for a displayed
  // confidence band and deterministic across runtimes.
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * x);
  const erf = sign * (1 - (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t) * Math.exp(-x * x));
  return (1 + erf) / 2;
}

function confidenceBps(treatment: CohortResult, control: CohortResult): number | null {
  if (treatment.impressions <= 0 || control.impressions <= 0) return null;
  const p1 = treatment.conversions / treatment.impressions;
  const p2 = control.conversions / control.impressions;
  const pooled = (treatment.conversions + control.conversions) / (treatment.impressions + control.impressions);
  const standardError = Math.sqrt(pooled * (1 - pooled) * (1 / treatment.impressions + 1 / control.impressions));
  if (standardError === 0) return p1 === p2 ? 0 : 10_000;
  const z = Math.abs(p1 - p2) / standardError;
  return Math.max(0, Math.min(10_000, Math.round((2 * normalCdf(z) - 1) * 10_000)));
}

function rateBps(conversions: number, impressions: number): number | null {
  if (impressions <= 0) return null;
  return Math.round((conversions * 10_000) / impressions);
}

export function computeCampaignLift(treatment: CohortResult, control: CohortResult): CampaignLift {
  // A campaign run at 0% control has no holdout by construction. That is a
  // legitimate merchant choice — they may not want to withhold an offer
  // from anyone — but it forfeits the ability to attribute.
  if (control.subjects === 0) {
    return {
      basis: "NO_HOLDOUT",
      treatmentRateBps: rateBps(treatment.conversions, treatment.impressions),
      controlRateBps: null,
      liftBps: null,
      attributableRevenueMinor: null,
      statisticalConfidenceBps: null,
      explanation:
        "This campaign was run without a control group, so its results cannot be attributed to the offer. The revenue is real; what it would have been without the offer is unknown.",
    };
  }

  if (treatment.subjects < MIN_COHORT_FOR_LIFT || control.subjects < MIN_COHORT_FOR_LIFT) {
    return {
      basis: "INSUFFICIENT_SAMPLE",
      treatmentRateBps: rateBps(treatment.conversions, treatment.impressions),
      controlRateBps: rateBps(control.conversions, control.impressions),
      liftBps: null,
      attributableRevenueMinor: null,
      statisticalConfidenceBps: null,
      explanation: `Too few subjects to compare yet — ${treatment.subjects} treated and ${control.subjects} held back, against a floor of ${MIN_COHORT_FOR_LIFT} each. A difference computed from this would be noise wearing a percentage sign.`,
    };
  }

  const treatmentRateBps = rateBps(treatment.conversions, treatment.impressions);
  const controlRateBps = rateBps(control.conversions, control.impressions);

  if (treatmentRateBps === null || controlRateBps === null) {
    return {
      basis: "INSUFFICIENT_SAMPLE",
      treatmentRateBps,
      controlRateBps,
      liftBps: null,
      attributableRevenueMinor: null,
      statisticalConfidenceBps: null,
      explanation:
        "One of the cohorts has had no impressions yet, so there is no conversion rate to compare. Nothing has been shown to anyone in that group.",
    };
  }

  const liftBps = treatmentRateBps - controlRateBps;

  /**
   * What the treatment group would have earned at the control group's
   * rate. The difference is the part the holdout attributes to the offer.
   *
   * Floored at zero only for the ATTRIBUTED amount, never for `liftBps`: a
   * campaign that underperformed its holdout should show a negative lift
   * plainly, while "negative attributed revenue" is not a coherent thing
   * to print next to a rupee sign.
   */
  const counterfactualRevenueMinor =
    treatmentRateBps === 0 ? 0 : Math.round((treatment.observedRevenueMinor * controlRateBps) / treatmentRateBps);
  const attributableRevenueMinor = Math.max(0, treatment.observedRevenueMinor - counterfactualRevenueMinor);

  return {
    basis: "MEASURED_AGAINST_HOLDOUT",
    treatmentRateBps,
    controlRateBps,
    liftBps,
    attributableRevenueMinor,
    statisticalConfidenceBps: confidenceBps(treatment, control),
    explanation:
      liftBps > 0
        ? `Treated subjects converted at ${(treatmentRateBps / 100).toFixed(1)}% against ${(controlRateBps / 100).toFixed(1)}% for the ${control.subjects} held back. The difference is measured against a real holdout, not assumed.`
        : liftBps < 0
          ? `Treated subjects converted at ${(treatmentRateBps / 100).toFixed(1)}%, BELOW the ${(controlRateBps / 100).toFixed(1)}% of the ${control.subjects} held back. On this evidence the offer is costing margin without earning conversions.`
          : `Treated and held-back subjects converted at the same ${(treatmentRateBps / 100).toFixed(1)}%. The offer made no measurable difference.`,
  };
}

/**
 * The observed offer-conversion rate this merchant has actually earned the
 * right to use in a forecast.
 *
 * Feeds the LEARN half of the loop: the opportunity engine withholds an
 * estimate on offer-shaped opportunities precisely because no such rate
 * exists. Once campaigns with a holdout have run, one does — and it is
 * this merchant's own, measured against their own control group, not an
 * industry figure.
 *
 * Returns null when no campaign has produced a measurable lift, which
 * keeps the engine withholding rather than guessing.
 */
export function observedOfferLiftBps(lifts: readonly CampaignLift[]): number | null {
  const measured = lifts.filter((l) => l.basis === "MEASURED_AGAINST_HOLDOUT" && l.liftBps !== null);
  if (measured.length === 0) return null;

  // Mean of the measured lifts, floored at zero for forecasting purposes:
  // a campaign that lost money is evidence the merchant should stop, not a
  // negative multiplier to apply to a future opportunity's ceiling.
  const mean = Math.round(measured.reduce((sum, l) => sum + (l.liftBps ?? 0), 0) / measured.length);
  return Math.max(0, mean);
}
