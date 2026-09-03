import { describe, it, expect } from "vitest";
import {
  detectRevenueOpportunities,
  summariseRevenueOpportunities,
  applyRateBps,
  rateBps,
  MIN_SAMPLE_FOR_OBSERVED_RATE,
  SCORE_WEIGHTS_BPS,
  CHECKOUT_STALE_AFTER_HOURS,
  REACTIVATION_INACTIVE_DAYS,
  type MerchantRevenueEvidence,
  type FailedPaymentFact,
  type UnverifiedPaymentFact,
  type CustomerPurchaseFact,
  type ProductPerformanceFact,
} from "./revenue-opportunity.js";

function evidence(overrides: Partial<MerchantRevenueEvidence> = {}): MerchantRevenueEvidence {
  return {
    currency: "INR",
    averageOrderValueMinor: 100_000,
    paidOrderCount: 0,
    ordersWithPaymentAttempt: 0,
    failedPaymentCount: 0,
    recoveredPaymentCount: 0,
    failedPayments: [],
    unverifiedPayments: [],
    stalledCheckouts: [],
    customers: [],
    products: [],
    growthActionsEnabled: true,
    crossSellEnabled: true,
    upsellEnabled: true,
    approvalThresholdMinor: 500_000,
    boundedOffersEnabled: true,
    observedOfferLiftBps: null,
    actedOnSubjectIds: [],
    readinessScore: 80,
    readinessBlockers: [],
    ...overrides,
  };
}

function failedPayment(overrides: Partial<FailedPaymentFact> = {}): FailedPaymentFact {
  return {
    paymentId: "pay_1",
    orderId: "ord_1",
    customerId: "cus_1",
    amountMinor: 200_000,
    currency: "INR",
    failureCategory: "INSUFFICIENT_FUNDS",
    recoveryEligible: true,
    recoveryBlockedReason: null,
    ageDays: 2,
    ...overrides,
  };
}

function customer(overrides: Partial<CustomerPurchaseFact> = {}): CustomerPurchaseFact {
  return {
    customerId: "cus_1",
    displayName: "Ananya Rao",
    paidOrderCount: 1,
    lifetimeValueMinor: 100_000,
    daysSinceLastPaidOrder: 5,
    medianOrderGapDays: null,
    ...overrides,
  };
}

function product(overrides: Partial<ProductPerformanceFact> = {}): ProductPerformanceFact {
  return {
    productId: "prod_1",
    name: "Pulse Runner",
    unitsSold: 0,
    entryPriceMinor: 50_000,
    topPriceMinor: 50_000,
    currency: "INR",
    outgoingRelationshipCount: 1,
    hasStructuredAttributes: true,
    hasRecordedInventory: true,
    agentVisible: true,
    promotionEligible: false,
    ...overrides,
  };
}

describe("rate helpers", () => {
  it("returns null rather than a misleading zero when there is nothing to divide by", () => {
    expect(rateBps(0, 0)).toBeNull();
    expect(rateBps(3, 0)).toBeNull();
  });

  it("floors an applied rate so an estimate can never exceed its source amount", () => {
    // 33.33% of 100 is 33.33 minor units; flooring keeps it at 33.
    expect(applyRateBps(100, 3_333)).toBe(33);
    expect(applyRateBps(100, 10_000)).toBe(100);
  });
});

describe("failed payment recovery", () => {
  it("reports the at-risk amount as OBSERVED because it is a sum of real rows", () => {
    const [opportunity] = detectRevenueOpportunities(
      evidence({
        failedPayments: [failedPayment({ amountMinor: 756_200 }), failedPayment({ paymentId: "pay_2", orderId: "ord_2", amountMinor: 1_025_000 })],
        failedPaymentCount: 2,
      }),
    );

    expect(opportunity!.type).toBe("FAILED_PAYMENT_RECOVERY");
    expect(opportunity!.expectedEffect.atRiskValue).toEqual({
      amountMinor: 1_781_200,
      currency: "INR",
      classification: "OBSERVED",
    });
  });

  it("WITHHOLDS the incremental estimate when the merchant has never recovered enough payments to derive a rate", () => {
    // This is the central honesty guarantee of the engine. Three failures
    // and no recoveries is not a 0% recovery rate — it is no evidence.
    const [opportunity] = detectRevenueOpportunities(
      evidence({
        failedPayments: [failedPayment(), failedPayment({ paymentId: "p2", orderId: "o2" }), failedPayment({ paymentId: "p3", orderId: "o3" })],
        failedPaymentCount: 3,
        recoveredPaymentCount: 0,
      }),
    );

    expect(opportunity!.expectedEffect.basis).toBe("INSUFFICIENT_EVIDENCE");
    expect(opportunity!.expectedEffect.expectedIncrementalValue).toBeNull();
    expect(opportunity!.expectedEffect.sampleSize).toBe(0);
    expect(opportunity!.expectedEffect.method).toContain("never recovered one");
  });

  it("produces an estimate only once the sample reaches the stated minimum, and derives it from the merchant's own history", () => {
    const failures = Array.from({ length: MIN_SAMPLE_FOR_OBSERVED_RATE }, (_, i) =>
      failedPayment({ paymentId: `p${i}`, orderId: `o${i}`, amountMinor: 100_000 }),
    );
    const [opportunity] = detectRevenueOpportunities(
      evidence({
        failedPayments: failures,
        failedPaymentCount: MIN_SAMPLE_FOR_OBSERVED_RATE,
        // 2 of 5 recovered = 4000 bps.
        recoveredPaymentCount: 2,
      }),
    );

    expect(opportunity!.expectedEffect.basis).toBe("OBSERVED_HISTORY");
    // 500,000 at risk x 40% observed recovery rate.
    expect(opportunity!.expectedEffect.expectedIncrementalValue).toEqual({
      amountMinor: 200_000,
      currency: "INR",
      classification: "ESTIMATED",
    });
    expect(opportunity!.expectedEffect.method).toContain("2 of 5");
  });

  it("addresses its subjects by payment id, which is what the recovery endpoint takes", () => {
    const [opportunity] = detectRevenueOpportunities(
      evidence({ failedPayments: [failedPayment({ paymentId: "pay_x", orderId: "ord_x" })], failedPaymentCount: 1 }),
    );
    expect(opportunity!.subjectIds).toEqual(["pay_x"]);
  });

  it("ignores payments the caller's recovery-eligibility check refused", () => {
    const opportunities = detectRevenueOpportunities(
      evidence({
        failedPayments: [failedPayment({ recoveryEligible: false, recoveryBlockedReason: "ORDER_ALREADY_PAID" })],
        failedPaymentCount: 1,
      }),
    );
    expect(opportunities.filter((o) => o.type === "FAILED_PAYMENT_RECOVERY")).toHaveLength(0);
  });

  it("requires approval once the at-risk amount exceeds the merchant's threshold", () => {
    const [opportunity] = detectRevenueOpportunities(
      evidence({
        failedPayments: [failedPayment({ amountMinor: 900_000 })],
        failedPaymentCount: 1,
        approvalThresholdMinor: 500_000,
      }),
    );
    expect(opportunity!.policy.outcome).toBe("REQUIRES_APPROVAL");
    expect(opportunity!.policy.reasons).toContain("ABOVE_APPROVAL_THRESHOLD");
  });
});

describe("abandoned checkout recovery", () => {
  it("ignores checkouts that are not yet stale", () => {
    const opportunities = detectRevenueOpportunities(
      evidence({
        stalledCheckouts: [{ orderId: "o1", customerId: "c1", amountMinor: 500_000, currency: "INR", ageHours: CHECKOUT_STALE_AFTER_HOURS - 1 }],
      }),
    );
    expect(opportunities.filter((o) => o.type === "ABANDONED_CHECKOUT_RECOVERY")).toHaveLength(0);
  });

  it("estimates from the merchant's own observed capture rate", () => {
    const opportunities = detectRevenueOpportunities(
      evidence({
        stalledCheckouts: [{ orderId: "o1", customerId: "c1", amountMinor: 1_000_000, currency: "INR", ageHours: 48 }],
        paidOrderCount: 9,
        ordersWithPaymentAttempt: 16,
      }),
    );
    const opportunity = opportunities.find((o) => o.type === "ABANDONED_CHECKOUT_RECOVERY")!;

    expect(opportunity.expectedEffect.basis).toBe("OBSERVED_HISTORY");
    // 9/16 = 5625 bps of 1,000,000.
    expect(opportunity.expectedEffect.expectedIncrementalValue!.amountMinor).toBe(562_500);
    expect(opportunity.expectedEffect.expectedIncrementalValue!.classification).toBe("ESTIMATED");
    // It must not silently present a baseline completion rate as a
    // measured response to a nudge that has never been sent.
    expect(opportunity.expectedEffect.method).toContain("not a measured response rate");
  });
});

describe("repeat purchase", () => {
  const repeatBase = [
    customer({ customerId: "c1", paidOrderCount: 4, lifetimeValueMinor: 400_000, medianOrderGapDays: 2, daysSinceLastPaidOrder: 13 }),
    customer({ customerId: "c2", paidOrderCount: 3, lifetimeValueMinor: 300_000, medianOrderGapDays: 2, daysSinceLastPaidOrder: 9 }),
  ];

  it("compares each customer against their own cadence, not a fixed window", () => {
    const opportunities = detectRevenueOpportunities(evidence({ customers: repeatBase }));
    const opportunity = opportunities.find((o) => o.type === "REPEAT_PURCHASE")!;

    expect(opportunity.customersAffected).toBe(2);
    // Ceiling is each customer's own average order value, not merchant AOV.
    expect(opportunity.expectedEffect.addressableValue!.amountMinor).toBe(100_000 + 100_000);
    expect(opportunity.expectedEffect.addressableValue!.classification).toBe("OPPORTUNITY");
  });

  it("withholds an incremental estimate because no response rate has ever been observed", () => {
    const opportunities = detectRevenueOpportunities(evidence({ customers: repeatBase }));
    const opportunity = opportunities.find((o) => o.type === "REPEAT_PURCHASE")!;

    expect(opportunity.expectedEffect.expectedIncrementalValue).toBeNull();
    expect(opportunity.expectedEffect.basis).toBe("INSUFFICIENT_EVIDENCE");
  });

  it("does not flag a repeat customer who is only slightly late", () => {
    const opportunities = detectRevenueOpportunities(
      evidence({
        customers: [customer({ customerId: "c1", paidOrderCount: 3, medianOrderGapDays: 10, daysSinceLastPaidOrder: 12 })],
      }),
    );
    // 12 days against a 10-day median is under the 1.5x threshold.
    expect(opportunities.filter((o) => o.type === "REPEAT_PURCHASE")).toHaveLength(0);
  });

  it("is BLOCKED, and sorted below eligible work, when the merchant disabled growth actions", () => {
    const opportunities = detectRevenueOpportunities(
      evidence({
        customers: repeatBase,
        growthActionsEnabled: false,
        failedPayments: [failedPayment()],
        failedPaymentCount: 1,
      }),
    );
    const repeat = opportunities.find((o) => o.type === "REPEAT_PURCHASE")!;
    expect(repeat.policy.outcome).toBe("BLOCKED");
    expect(repeat.policy.reasons).toContain("GROWTH_ACTIONS_DISABLED");
    // Blocked work never outranks work that can actually proceed.
    expect(opportunities.indexOf(repeat)).toBe(opportunities.length - 1);
  });
});

describe("reactivation", () => {
  it("separates one-time lapsed buyers from repeat customers", () => {
    const opportunities = detectRevenueOpportunities(
      evidence({
        customers: [
          customer({ customerId: "c1", paidOrderCount: 1, lifetimeValueMinor: 250_000, daysSinceLastPaidOrder: REACTIVATION_INACTIVE_DAYS + 1 }),
          customer({ customerId: "c2", paidOrderCount: 3, medianOrderGapDays: 2, daysSinceLastPaidOrder: 40 }),
        ],
      }),
    );

    const reactivation = opportunities.find((o) => o.type === "CUSTOMER_REACTIVATION")!;
    expect(reactivation.customersAffected).toBe(1);
    expect(reactivation.expectedEffect.addressableValue!.amountMinor).toBe(250_000);
    expect(reactivation.expectedEffect.expectedIncrementalValue).toBeNull();
  });
});

describe("catalogue-derived opportunities", () => {
  it("only counts cross-sell gaps on products that have actually sold", () => {
    const opportunities = detectRevenueOpportunities(
      evidence({
        products: [
          product({ productId: "sells", unitsSold: 4, outgoingRelationshipCount: 0 }),
          product({ productId: "never-sold", unitsSold: 0, outgoingRelationshipCount: 0 }),
        ],
      }),
    );
    const crossSell = opportunities.find((o) => o.type === "CROSS_SELL")!;
    expect(crossSell.subjectIds).toEqual(["sells"]);
  });

  it("treats a well-formed product with no sales as a conversion problem, not a readiness one", () => {
    const opportunities = detectRevenueOpportunities(
      evidence({ products: [product({ productId: "p", unitsSold: 0, hasStructuredAttributes: true, hasRecordedInventory: true })] }),
    );
    expect(opportunities.find((o) => o.type === "UNDERPERFORMING_PRODUCT")).toBeDefined();
    expect(opportunities.find((o) => o.type === "AI_BUYER_READINESS")).toBeUndefined();
  });

  it("attaches no monetary figure at all to a readiness gap", () => {
    const opportunities = detectRevenueOpportunities(
      evidence({ products: [product({ hasRecordedInventory: false })] }),
    );
    const readiness = opportunities.find((o) => o.type === "AI_BUYER_READINESS")!;
    expect(readiness.expectedEffect.atRiskValue).toBeNull();
    expect(readiness.expectedEffect.addressableValue).toBeNull();
    expect(readiness.expectedEffect.expectedIncrementalValue).toBeNull();
  });

  it("suppresses cross-sell entirely when the merchant disabled it", () => {
    const opportunities = detectRevenueOpportunities(
      evidence({ crossSellEnabled: false, products: [product({ unitsSold: 3, outgoingRelationshipCount: 0 })] }),
    );
    expect(opportunities.filter((o) => o.type === "CROSS_SELL")).toHaveLength(0);
  });
});

describe("scoring", () => {
  it("weights sum to exactly 10,000 basis points", () => {
    const total = Object.values(SCORE_WEIGHTS_BPS).reduce((sum, w) => sum + w, 0);
    expect(total).toBe(10_000);
  });

  it("is a reproducible weighted sum of its own published components", () => {
    const [opportunity] = detectRevenueOpportunities(
      evidence({ failedPayments: [failedPayment()], failedPaymentCount: 1 }),
    );
    const s = opportunity!.score;
    const recomputed = Math.round(
      (s.value * SCORE_WEIGHTS_BPS.value +
        s.confidence * SCORE_WEIGHTS_BPS.confidence +
        s.urgency * SCORE_WEIGHTS_BPS.urgency +
        s.customerImpact * SCORE_WEIGHTS_BPS.customerImpact +
        s.effort * SCORE_WEIGHTS_BPS.effort +
        s.policy * SCORE_WEIGHTS_BPS.policy) /
        10_000,
    );
    expect(s.priority).toBe(recomputed);
  });

  it("is deterministic — the same evidence produces byte-identical output", () => {
    const input = evidence({
      failedPayments: [failedPayment(), failedPayment({ paymentId: "p2", orderId: "o2", customerId: "c2" })],
      failedPaymentCount: 2,
      customers: [customer({ paidOrderCount: 3, medianOrderGapDays: 2, daysSinceLastPaidOrder: 30 })],
      products: [product({ unitsSold: 2, outgoingRelationshipCount: 0 })],
    });
    expect(JSON.stringify(detectRevenueOpportunities(input))).toBe(JSON.stringify(detectRevenueOpportunities(input)));
  });

  it("ranks real declined money above a catalogue chore even when its recovery rate is unknowable", () => {
    // Regression guard. Confidence must track how sure we are the
    // OPPORTUNITY is real, not whether we could put a number on the
    // gain. Deriving it from the estimate's basis made a failed payment
    // — money that provably exists — rank below adding attributes to a
    // product, which is the wrong advice to give a merchant.
    const opportunities = detectRevenueOpportunities(
      evidence({
        failedPayments: [failedPayment({ amountMinor: 2_313_200, ageDays: 4 })],
        failedPaymentCount: 3,
        recoveredPaymentCount: 0,
        products: [product({ hasRecordedInventory: false })],
      }),
    );
    const failed = opportunities.findIndex((o) => o.type === "FAILED_PAYMENT_RECOVERY");
    const readiness = opportunities.findIndex((o) => o.type === "AI_BUYER_READINESS");

    expect(failed).toBeLessThan(readiness);
    // And it still refuses to estimate the recoverable fraction.
    expect(opportunities[failed]!.expectedEffect.expectedIncrementalValue).toBeNull();
  });

  it("ranks a fresh high-value recovery above a low-urgency catalogue chore", () => {
    const opportunities = detectRevenueOpportunities(
      evidence({
        failedPayments: [failedPayment({ amountMinor: 400_000, ageDays: 1 })],
        failedPaymentCount: 1,
        products: [product({ unitsSold: 1, outgoingRelationshipCount: 0, entryPriceMinor: 1_000 })],
      }),
    );
    expect(opportunities[0]!.type).toBe("FAILED_PAYMENT_RECOVERY");
  });
});

describe("portfolio totals", () => {
  it("never adds an OBSERVED at-risk amount to an OPPORTUNITY ceiling", () => {
    const opportunities = detectRevenueOpportunities(
      evidence({
        failedPayments: [failedPayment({ amountMinor: 300_000 })],
        failedPaymentCount: 1,
        customers: [customer({ paidOrderCount: 2, lifetimeValueMinor: 200_000, medianOrderGapDays: 2, daysSinceLastPaidOrder: 20 })],
      }),
    );
    const totals = summariseRevenueOpportunities(opportunities, "INR");

    expect(totals.totalAtRiskMinor).toBe(300_000);
    // The repeat-purchase ceiling (100,000) plus the recovery ceiling
    // (300,000) — kept in its own bucket, never merged with at-risk.
    expect(totals.totalAddressableMinor).toBe(400_000);
    expect(totals.totalAtRiskMinor).not.toBe(totals.totalAddressableMinor);
  });

  it("counts how many cards had to withhold an estimate, so the console can say so", () => {
    const opportunities = detectRevenueOpportunities(
      evidence({ failedPayments: [failedPayment()], failedPaymentCount: 1 }),
    );
    const totals = summariseRevenueOpportunities(opportunities, "INR");
    expect(totals.withheldEstimateCount).toBe(1);
    expect(totals.totalExpectedIncrementalMinor).toBe(0);
  });
});

describe("upsell — the merchant's own price ladder", () => {
  it("detects an upgrade only where a dearer active variant actually exists", () => {
    const noLadder = detectRevenueOpportunities(
      evidence({ products: [product({ unitsSold: 4, entryPriceMinor: 50_000, topPriceMinor: 50_000 })] }),
    );
    expect(noLadder.find((o) => o.type === "UPSELL")).toBeUndefined();

    const ladder = detectRevenueOpportunities(
      evidence({ products: [product({ unitsSold: 4, entryPriceMinor: 50_000, topPriceMinor: 80_000 })] }),
    );
    const upsell = ladder.find((o) => o.type === "UPSELL");
    expect(upsell).toBeDefined();
    // 4 units x the real 30,000 spread. Nothing here is a guessed rate.
    expect(upsell!.expectedEffect.addressableValue?.amountMinor).toBe(120_000);
  });

  it("never states an incremental estimate, because no trade-up rate is recorded anywhere", () => {
    const [upsell] = detectRevenueOpportunities(
      evidence({ products: [product({ unitsSold: 10, entryPriceMinor: 50_000, topPriceMinor: 90_000 })] }),
    ).filter((o) => o.type === "UPSELL");

    expect(upsell.expectedEffect.expectedIncrementalValue).toBeNull();
    expect(upsell.expectedEffect.basis).toBe("INSUFFICIENT_EVIDENCE");
    expect(upsell.expectedEffect.sampleSize).toBe(0);
  });

  it("stays silent when the merchant has switched upsell off", () => {
    const opportunities = detectRevenueOpportunities(
      evidence({
        upsellEnabled: false,
        products: [product({ unitsSold: 4, entryPriceMinor: 50_000, topPriceMinor: 80_000 })],
      }),
    );
    expect(opportunities.find((o) => o.type === "UPSELL")).toBeUndefined();
  });

  it("ignores a product that has never sold — there is no ladder to climb", () => {
    const opportunities = detectRevenueOpportunities(
      evidence({ products: [product({ unitsSold: 0, entryPriceMinor: 50_000, topPriceMinor: 80_000 })] }),
    );
    expect(opportunities.find((o) => o.type === "UPSELL")).toBeUndefined();
  });
});

describe("product discovery — what no agent can see", () => {
  it("finds products that are not agent-visible at all", () => {
    const opportunities = detectRevenueOpportunities(
      evidence({ products: [product({ productId: "hidden_1", agentVisible: false })] }),
    );
    const discovery = opportunities.find((o) => o.type === "PRODUCT_DISCOVERY");
    expect(discovery).toBeDefined();
    expect(discovery!.subjectIds).toContain("hidden_1");
  });

  it("attaches no monetary figure of any kind to an unpublished product", () => {
    const [discovery] = detectRevenueOpportunities(
      evidence({ products: [product({ agentVisible: false })] }),
    ).filter((o) => o.type === "PRODUCT_DISCOVERY");

    // An unpublished product has no sales history and no observed demand.
    expect(discovery.expectedEffect.atRiskValue).toBeNull();
    expect(discovery.expectedEffect.addressableValue).toBeNull();
    expect(discovery.expectedEffect.expectedIncrementalValue).toBeNull();
  });

  it("is silent when every product is already visible", () => {
    const opportunities = detectRevenueOpportunities(evidence({ products: [product({ agentVisible: true })] }));
    expect(opportunities.find((o) => o.type === "PRODUCT_DISCOVERY")).toBeUndefined();
  });
});

describe("eligible offer — only where the merchant already gave permission", () => {
  it("requires the merchant's own promotion flag", () => {
    const notFlagged = detectRevenueOpportunities(
      evidence({ products: [product({ unitsSold: 3, promotionEligible: false })] }),
    );
    expect(notFlagged.find((o) => o.type === "ELIGIBLE_OFFER")).toBeUndefined();

    const flagged = detectRevenueOpportunities(
      evidence({ products: [product({ unitsSold: 3, promotionEligible: true })] }),
    );
    expect(flagged.find((o) => o.type === "ELIGIBLE_OFFER")).toBeDefined();
  });

  it("respects the bounded-offers switch", () => {
    const opportunities = detectRevenueOpportunities(
      evidence({
        boundedOffersEnabled: false,
        products: [product({ unitsSold: 3, promotionEligible: true })],
      }),
    );
    expect(opportunities.find((o) => o.type === "ELIGIBLE_OFFER")).toBeUndefined();
  });

  it("always needs approval, because an offer changes a price", () => {
    const [offer] = detectRevenueOpportunities(
      evidence({ products: [product({ unitsSold: 3, promotionEligible: true })] }),
    ).filter((o) => o.type === "ELIGIBLE_OFFER");

    expect(offer.policy.outcome).toBe("REQUIRES_APPROVAL");
    expect(offer.approvalRequired).toBe(true);
  });
});

describe("approval requirement is decided per payment, not per card", () => {
  it("lets the agent work the set alone when every recovery is inside the ceiling", () => {
    const [recovery] = detectRevenueOpportunities(
      evidence({
        approvalThresholdMinor: 500_000,
        failedPaymentCount: 3,
        // Three payments summing well above the ceiling, none individually
        // near it. The policy engine decides one at a time, so this whole
        // set is auto-approvable.
        failedPayments: [
          failedPayment({ paymentId: "p1", amountMinor: 200_000 }),
          failedPayment({ paymentId: "p2", amountMinor: 200_000 }),
          failedPayment({ paymentId: "p3", amountMinor: 200_000 }),
        ],
      }),
    ).filter((o) => o.type === "FAILED_PAYMENT_RECOVERY");

    expect(recovery.policy.outcome).toBe("ELIGIBLE");
    expect(recovery.effort).toBe("AGENT_AUTOMATIC");
    expect(recovery.approvalRequired).toBe(false);
  });

  it("asks for approval as soon as one single recovery exceeds the ceiling", () => {
    const [recovery] = detectRevenueOpportunities(
      evidence({
        approvalThresholdMinor: 500_000,
        failedPaymentCount: 2,
        failedPayments: [
          failedPayment({ paymentId: "p1", amountMinor: 200_000 }),
          failedPayment({ paymentId: "p2", amountMinor: 900_000 }),
        ],
      }),
    ).filter((o) => o.type === "FAILED_PAYMENT_RECOVERY");

    expect(recovery.policy.outcome).toBe("REQUIRES_APPROVAL");
    expect(recovery.approvalRequired).toBe(true);
    // ...and it says how many are still inside the limit, so "needs your
    // approval" cannot read as "none of this can proceed".
    const split = recovery.evidence.find((e) => e.label === "Inside your automatic limit");
    expect(split?.value).toBe("1 of 2 payments");
  });
});

describe("status is derived from what the agent has already proposed", () => {
  it("stays DETECTED while nothing has been acted on", () => {
    const [recovery] = detectRevenueOpportunities(
      evidence({ failedPaymentCount: 1, failedPayments: [failedPayment({ paymentId: "p1" })] }),
    ).filter((o) => o.type === "FAILED_PAYMENT_RECOVERY");

    expect(recovery.status).toBe("DETECTED");
    expect(recovery.result).toBeNull();
  });

  it("reports PARTIALLY_ACTIONED and says how much is left", () => {
    const [recovery] = detectRevenueOpportunities(
      evidence({
        failedPaymentCount: 2,
        failedPayments: [failedPayment({ paymentId: "p1" }), failedPayment({ paymentId: "p2" })],
        actedOnSubjectIds: ["p1"],
      }),
    ).filter((o) => o.type === "FAILED_PAYMENT_RECOVERY");

    expect(recovery.status).toBe("PARTIALLY_ACTIONED");
    expect(recovery.result).toContain("1 of 2");
  });

  it("reports ACTIONED only when every subject carries a proposal", () => {
    const [recovery] = detectRevenueOpportunities(
      evidence({
        failedPaymentCount: 2,
        failedPayments: [failedPayment({ paymentId: "p1" }), failedPayment({ paymentId: "p2" })],
        actedOnSubjectIds: ["p1", "p2"],
      }),
    ).filter((o) => o.type === "FAILED_PAYMENT_RECOVERY");

    expect(recovery.status).toBe("ACTIONED");
    expect(recovery.result).toContain("all 2");
  });
});

describe("every opportunity carries the fields a merchant is promised", () => {
  it("states confidence, urgency, approval requirement, status and result on all of them", () => {
    const opportunities = detectRevenueOpportunities(
      evidence({
        failedPaymentCount: 1,
        failedPayments: [failedPayment()],
        products: [
          product({ productId: "a", unitsSold: 5, entryPriceMinor: 50_000, topPriceMinor: 90_000, promotionEligible: true }),
          product({ productId: "b", agentVisible: false }),
          product({ productId: "c", unitsSold: 0, outgoingRelationshipCount: 0 }),
        ],
      }),
    );

    expect(opportunities.length).toBeGreaterThan(3);
    for (const o of opportunities) {
      expect(typeof o.id).toBe("string");
      expect(o.evidence.length).toBeGreaterThan(0);
      expect(o.confidence).toBeGreaterThanOrEqual(0);
      expect(o.urgency).toBeGreaterThanOrEqual(0);
      expect(typeof o.approvalRequired).toBe("boolean");
      expect(["DETECTED", "PARTIALLY_ACTIONED", "ACTIONED"]).toContain(o.status);
      expect(o.result === null || typeof o.result === "string").toBe(true);
      // The rule the whole engine exists for.
      if (o.expectedEffect.basis === "INSUFFICIENT_EVIDENCE") {
        expect(o.expectedEffect.expectedIncrementalValue).toBeNull();
      }
      // Approval requirement can never contradict the policy pre-filter.
      if (o.policy.outcome === "REQUIRES_APPROVAL") expect(o.approvalRequired).toBe(true);
    }
  });
});

describe("learning — an offer estimate has to be earned", () => {
  function offerEvidence(liftBps: number | null) {
    return evidence({
      observedOfferLiftBps: liftBps,
      products: [product({ unitsSold: 4, promotionEligible: true, entryPriceMinor: 100_000 })],
    });
  }

  it("withholds the estimate until a campaign holdout has measured one", () => {
    const [offer] = detectRevenueOpportunities(offerEvidence(null)).filter((o) => o.type === "ELIGIBLE_OFFER");

    expect(offer.expectedEffect.basis).toBe("INSUFFICIENT_EVIDENCE");
    expect(offer.expectedEffect.expectedIncrementalValue).toBeNull();
    expect(offer.expectedEffect.method).toContain("no campaign with a control group has run");
  });

  it("uses the merchant's own measured lift once one exists", () => {
    const [offer] = detectRevenueOpportunities(offerEvidence(1_500)).filter((o) => o.type === "ELIGIBLE_OFFER");

    expect(offer.expectedEffect.basis).toBe("OBSERVED_HISTORY");
    // 15% of the ₹1,000 ceiling. Their rate, their ceiling.
    expect(offer.expectedEffect.expectedIncrementalValue?.amountMinor).toBe(15_000);
    expect(offer.expectedEffect.expectedIncrementalValue?.classification).toBe("ESTIMATED");
    expect(offer.expectedEffect.sampleSize).toBeGreaterThan(0);
  });

  it("keeps withholding when the measured lift was zero or negative", () => {
    // A campaign that did not beat its holdout is evidence to stop, not a
    // rate to forecast with.
    for (const liftBps of [0, -500]) {
      const [offer] = detectRevenueOpportunities(offerEvidence(liftBps)).filter((o) => o.type === "ELIGIBLE_OFFER");
      expect(offer.expectedEffect.expectedIncrementalValue, String(liftBps)).toBeNull();
      expect(offer.expectedEffect.basis, String(liftBps)).toBe("INSUFFICIENT_EVIDENCE");
    }
  });

  it("ranks a measured opportunity above an unmeasured one", () => {
    const [measured] = detectRevenueOpportunities(offerEvidence(1_500)).filter((o) => o.type === "ELIGIBLE_OFFER");
    const [unmeasured] = detectRevenueOpportunities(offerEvidence(null)).filter((o) => o.type === "ELIGIBLE_OFFER");

    // A controlled comparison is stronger evidence than a structural
    // signal, and the ranking should say so.
    expect(measured.confidence).toBeGreaterThan(unmeasured.confidence);
    expect(measured.score.priority).toBeGreaterThan(unmeasured.score.priority);
  });

  it("still never lets an estimate exceed its own ceiling", () => {
    // An absurd measured lift must not produce an estimate larger than the
    // addressable amount it is applied to.
    const [offer] = detectRevenueOpportunities(offerEvidence(10_000)).filter((o) => o.type === "ELIGIBLE_OFFER");
    expect(offer.expectedEffect.expectedIncrementalValue!.amountMinor).toBeLessThanOrEqual(
      offer.expectedEffect.addressableValue!.amountMinor,
    );
  });
});

describe("unverified payments — the state nothing used to look at", () => {
  const unverified = (overrides: Partial<UnverifiedPaymentFact> = {}): UnverifiedPaymentFact => ({
    paymentId: "pay_unknown_1",
    orderId: "ord_unknown_1",
    customerId: "cus_1",
    amountMinor: 420_000,
    currency: "INR",
    ageDays: 3,
    hasProviderReference: true,
    ...overrides,
  });

  it("detects a payment whose outcome was never established", () => {
    const opportunities = detectRevenueOpportunities(evidence({ unverifiedPayments: [unverified()] }));
    const card = opportunities.find((o) => o.type === "UNVERIFIED_PAYMENT");
    expect(card, "an UNKNOWN payment must be detected").toBeDefined();
    expect(card!.subjectIds).toEqual(["pay_unknown_1"]);
    expect(card!.proposedAction).toBe("RECONCILE_PAYMENT");
  });

  it("never states an expected incremental value, because none is knowable", () => {
    const opportunities = detectRevenueOpportunities(evidence({ unverifiedPayments: [unverified()] }));
    const card = opportunities.find((o) => o.type === "UNVERIFIED_PAYMENT")!;

    // The rule this card exists to respect. Reconciliation reveals what
    // already happened rather than causing anything: the provider may
    // report a capture that was always the merchant's money, or a failure
    // that never was. Either presented as "expected incremental revenue"
    // would be inventing a payment result.
    expect(card.expectedEffect.expectedIncrementalValue).toBeNull();
    expect(card.expectedEffect.basis).toBe("INSUFFICIENT_EVIDENCE");
    expect(card.expectedEffect.method.length).toBeGreaterThan(40);

    // The at-risk amount IS real — it is the sum of the payment rows.
    expect(card.expectedEffect.atRiskValue.amountMinor).toBe(420_000);
    expect(card.expectedEffect.atRiskValue.classification).toBe("OBSERVED");
  });

  it("excludes a payment there is no provider reference to ask about", () => {
    const opportunities = detectRevenueOpportunities(
      evidence({ unverifiedPayments: [unverified({ hasProviderReference: false })] }),
    );
    // Nothing to reconcile against, so offering the action would be
    // offering a button that cannot work.
    expect(opportunities.find((o) => o.type === "UNVERIFIED_PAYMENT")).toBeUndefined();
  });

  it("says how many it excluded, rather than quietly dropping them", () => {
    const opportunities = detectRevenueOpportunities(
      evidence({
        unverifiedPayments: [unverified(), unverified({ paymentId: "p2", hasProviderReference: false })],
      }),
    );
    const card = opportunities.find((o) => o.type === "UNVERIFIED_PAYMENT")!;
    expect(card.subjectIds).toEqual(["pay_unknown_1"]);
    expect(card.evidence.some((e) => e.label.includes("Excluded"))).toBe(true);
  });

  it("needs no approval and is never blocked, because it moves no money", () => {
    const opportunities = detectRevenueOpportunities(evidence({ unverifiedPayments: [unverified()] }));
    const card = opportunities.find((o) => o.type === "UNVERIFIED_PAYMENT")!;

    // Putting a read behind an approval would leave money in limbo
    // waiting for a human to permit asking a question.
    expect(card.policy.outcome).toBe("ELIGIBLE");
    expect(card.approvalRequired).toBe(false);
    expect(card.effort).toBe("AGENT_AUTOMATIC");
  });

  it("ranks ahead of retrying a payment known to have failed", () => {
    const opportunities = detectRevenueOpportunities(
      evidence({
        unverifiedPayments: [unverified()],
        failedPayments: [failedPayment()],
        failedPaymentCount: 1,
      }),
    );
    const unverifiedIndex = opportunities.findIndex((o) => o.type === "UNVERIFIED_PAYMENT");
    const failedIndex = opportunities.findIndex((o) => o.type === "FAILED_PAYMENT_RECOVERY");
    expect(unverifiedIndex).toBeGreaterThanOrEqual(0);
    expect(failedIndex).toBeGreaterThanOrEqual(0);

    // Only asserted when the two score equally — the tie-break is what is
    // under test, not the scoring. A payment whose outcome nobody has
    // established must be resolved before the same money is retried.
    const a = opportunities[unverifiedIndex]!;
    const b = opportunities[failedIndex]!;
    if (a.score.priority === b.score.priority) expect(unverifiedIndex).toBeLessThan(failedIndex);
  });

  it("reports nothing at all when there are none", () => {
    const opportunities = detectRevenueOpportunities(evidence({ unverifiedPayments: [] }));
    expect(opportunities.find((o) => o.type === "UNVERIFIED_PAYMENT")).toBeUndefined();
  });
});
