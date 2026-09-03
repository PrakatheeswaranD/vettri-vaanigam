/**
 * The Revenue Opportunity Engine.
 *
 * WHAT THIS IS
 *
 * A pure, deterministic function from "facts this merchant's database
 * already contains" to "a ranked worklist of things that would earn or
 * save money, each one explainable end to end". No database, no clock
 * reading, no AI. The Merchant Agent may later narrate or act on what
 * this produces; it never decides what an opportunity is worth.
 *
 * WHY IT IS SHAPED THIS WAY
 *
 * The failure mode this module exists to prevent is the plausible number.
 * It is trivially easy to write `estimatedValue: basket * 0.3` and render
 * a confident "₹2.4L opportunity" on a dashboard. That figure would be
 * indistinguishable, to a merchant or a jury, from one that is real — and
 * it would be a fabrication. So this module separates three things that
 * generic dashboards blur together:
 *
 *   atRiskValue              OBSERVED     Money that demonstrably exists
 *                                         in this merchant's data and is
 *                                         not currently captured. A failed
 *                                         payment's amount is not a
 *                                         forecast; it is a row.
 *
 *   addressableValue         OPPORTUNITY  The ceiling if every targeted
 *                                         action succeeded. Honest as a
 *                                         ceiling, dishonest as a
 *                                         forecast, and labelled as the
 *                                         former.
 *
 *   expectedIncrementalValue ESTIMATED    atRisk/addressable multiplied by
 *                                         a rate OBSERVED IN THIS
 *                                         MERCHANT'S OWN HISTORY. Emitted
 *                                         only when the sample behind that
 *                                         rate reaches
 *                                         `MIN_SAMPLE_FOR_OBSERVED_RATE`.
 *                                         Otherwise it is `null` and the
 *                                         opportunity is marked
 *                                         `INSUFFICIENT_EVIDENCE`.
 *
 * A merchant with three failed payments and no recovery history gets an
 * honest "₹23,132 is sitting in failed payments; we cannot yet tell you
 * what fraction is recoverable, because you have never recovered one".
 * That is a worse-looking demo and a far better product, and it is the
 * only version that survives being asked "where did that number come
 * from?".
 *
 * EVERY OPPORTUNITY EXPLAINS ITSELF
 *
 * `whyDetected` -> `proposedAction` -> `expectedEffect` -> `evidence` ->
 * `risk` -> `policy`. The `evidence` array is the load-bearing part: each
 * entry is a fact with a number the merchant can go and check against
 * their own orders. Nothing here produces a figure that is not traceable
 * to one of those entries.
 */
import type { CurrencyCode } from "./money.js";

/* -------------------------------------------------------------------------
 * Vocabulary
 * ---------------------------------------------------------------------- */

export const REVENUE_OPPORTUNITY_TYPES = [
  "FAILED_PAYMENT_RECOVERY",
  /**
   * A payment whose outcome nobody has asked the provider about.
   *
   * Its own type rather than a flavour of FAILED_PAYMENT_RECOVERY,
   * because the action differs: an UNKNOWN payment must be RECONCILED,
   * never retried. Retrying an attempt that may already have succeeded is
   * how a double charge happens, and folding the two together would put
   * both under one card whose action is right for only half of it.
   */
  "UNVERIFIED_PAYMENT",
  "ABANDONED_CHECKOUT_RECOVERY",
  "REPEAT_PURCHASE",
  "CUSTOMER_REACTIVATION",
  "CROSS_SELL",
  "UPSELL",
  "UNDERPERFORMING_PRODUCT",
  "AI_BUYER_READINESS",
  "PRODUCT_DISCOVERY",
  "ELIGIBLE_OFFER",
] as const;
export type RevenueOpportunityType = (typeof REVENUE_OPPORTUNITY_TYPES)[number];

/**
 * How a monetary claim is supported. This is the field that stops the
 * engine from inventing revenue.
 *
 * DIRECT_OBSERVATION     No rate needed — the amount IS a recorded value
 *                        (a failed payment's own `amountMinor`).
 * OBSERVED_HISTORY       A rate computed from this merchant's own rows,
 *                        with a sample at or above the minimum.
 * INSUFFICIENT_EVIDENCE  The sample is too small to support a rate. The
 *                        estimate is withheld, not guessed.
 */
export const EVIDENCE_BASES = ["DIRECT_OBSERVATION", "OBSERVED_HISTORY", "INSUFFICIENT_EVIDENCE"] as const;
export type EvidenceBasis = (typeof EVIDENCE_BASES)[number];

/** Mirrors `value-classification.ts`; restated here so the shape of an
 * opportunity is readable without cross-referencing. */
export type OpportunityValueClassification = "OBSERVED" | "ESTIMATED" | "OPPORTUNITY";

/**
 * What acting on an opportunity actually costs the merchant. Drives the
 * effort component of the score, and is stated on the card so "high
 * priority" never quietly means "and you must do three hours of data
 * entry".
 */
export const OPPORTUNITY_EFFORTS = ["AGENT_AUTOMATIC", "ONE_APPROVAL", "MERCHANT_WORK"] as const;
export type OpportunityEffort = (typeof OPPORTUNITY_EFFORTS)[number];

/**
 * The closed set of actions an opportunity may propose. Closed on
 * purpose: the Merchant Agent picks FROM this list, it does not invent
 * entries, and each maps to a real execution path in the API.
 */
export const OPPORTUNITY_ACTIONS = [
  "RECOVER_FAILED_PAYMENT",
  /** Ask the provider what happened. Reads; never charges. */
  "RECONCILE_PAYMENT",
  "RECOVER_ABANDONED_CHECKOUT",
  "RECOMMEND_COMPLEMENTARY_PRODUCT",
  "OFFER_TARGETED_UPSELL",
  "IMPROVE_AI_DISCOVERABILITY",
  "REACTIVATE_CUSTOMER",
  "PROMPT_REPEAT_PURCHASE",
  "IMPROVE_PRODUCT_CONVERSION",
  "PUBLISH_PRODUCT_FOR_DISCOVERY",
  "PROPOSE_BOUNDED_OFFER",
] as const;

/**
 * How far an opportunity has got, computed deterministically from whether
 * its subjects already carry an agent proposal.
 *
 * WHY THIS IS PART OF THE OPPORTUNITY AND NOT A SEPARATE LOOKUP
 *
 * An opportunity is recomputed from live rows on every read, so without a
 * status the same card reappears identically after the agent has already
 * acted on it — and a merchant cannot tell "nothing has happened here"
 * from "this is done". Deriving it from proposals rather than storing it
 * keeps a single source of truth: the proposal rows.
 */
export const OPPORTUNITY_STATUSES = ["DETECTED", "PARTIALLY_ACTIONED", "ACTIONED"] as const;
export type OpportunityStatus = (typeof OPPORTUNITY_STATUSES)[number];
export type OpportunityAction = (typeof OPPORTUNITY_ACTIONS)[number];

/** Why an opportunity may or may not proceed. Deterministic — the Policy
 * Engine re-decides authoritatively before anything executes; this is the
 * cheap pre-filter that keeps ineligible work off the top of the list. */
export const OPPORTUNITY_POLICY_OUTCOMES = ["ELIGIBLE", "REQUIRES_APPROVAL", "BLOCKED"] as const;
export type OpportunityPolicyOutcome = (typeof OPPORTUNITY_POLICY_OUTCOMES)[number];

/* -------------------------------------------------------------------------
 * Deterministic constants
 *
 * Every threshold the engine uses is named and exported. A merchant or a
 * jury can read this block and know exactly what "high priority" meant,
 * and a test can assert against the constant rather than a magic number.
 * ---------------------------------------------------------------------- */

/** Below this many historical observations, a derived rate is not
 * reported and no estimate is produced from it. Five is small, and
 * deliberately so: it is the point at which a rate stops being one
 * anecdote, not the point at which it becomes statistically robust. The
 * `sampleSize` travels with the estimate, so nobody has to take the
 * threshold on faith. */
export const MIN_SAMPLE_FOR_OBSERVED_RATE = 5;

/** A payment that failed longer ago than this is unlikely to be
 * recoverable by retrying the same checkout — the buyer has moved on.
 * Used for urgency decay, not as a hard cutoff. */
export const FAILED_PAYMENT_RECOVERY_WINDOW_DAYS = 14;

/** A checkout that has sat unpaid this long is treated as abandoned
 * rather than in progress. */
export const CHECKOUT_STALE_AFTER_HOURS = 24;
export const ABANDONED_CHECKOUT_RECOVERY_WINDOW_DAYS = 7;

/** A repeat customer is "due" once this multiple of their own observed
 * median gap has elapsed. 1.5x rather than 1.0x, so a customer who is
 * merely a little late is not nagged. */
export const REPEAT_PURCHASE_DUE_MULTIPLIER_BPS = 15_000;

/** A buyer with exactly one purchase and no activity for this long is a
 * reactivation candidate rather than a repeat-purchase one — there is no
 * personal cadence for them to be late against. */
export const REACTIVATION_INACTIVE_DAYS = 30;

/** Score weights, in basis points, summing to exactly 10,000. Ranking is
 * a weighted sum of six 0-100 components — no hidden term, no learned
 * weight, no tie-break on `Math.random`. */
export const SCORE_WEIGHTS_BPS = {
  value: 3_500,
  confidence: 2_000,
  urgency: 1_500,
  customerImpact: 1_000,
  effort: 1_000,
  policy: 1_000,
} as const;

/** The value component saturates at this multiple of the merchant's own
 * average order value. Scoring against the merchant's own scale is what
 * makes a ₹5,000 opportunity "large" for a small merchant and "routine"
 * for a large one, without any absolute rupee threshold baked in. */
export const VALUE_SATURATION_AOV_MULTIPLE = 4;

const EFFORT_SCORE: Record<OpportunityEffort, number> = {
  AGENT_AUTOMATIC: 100,
  ONE_APPROVAL: 70,
  MERCHANT_WORK: 35,
};

const POLICY_SCORE: Record<OpportunityPolicyOutcome, number> = {
  ELIGIBLE: 100,
  REQUIRES_APPROVAL: 60,
  BLOCKED: 0,
};

/* -------------------------------------------------------------------------
 * Public shapes
 * ---------------------------------------------------------------------- */

export interface OpportunityMoney {
  amountMinor: number;
  currency: CurrencyCode;
  classification: OpportunityValueClassification;
}

/** One checkable fact. */
export interface OpportunityEvidence {
  label: string;
  /** Rendered verbatim next to the label when `money` is absent. */
  value: string;
  /** Set when the fact IS an amount. The domain deliberately does not
   * format currency — locale and symbol are presentation concerns, and a
   * domain that renders "Rs17,812.00" cannot be reused by a caller with a
   * different locale. Emitting the minor units and letting the UI format
   * them keeps the single money representation intact all the way to the
   * screen. */
  money?: { amountMinor: number; currency: CurrencyCode };
  /** Where a merchant can go to verify it themselves. */
  source: string;
}

export interface OpportunityExpectedEffect {
  /** Real money currently uncaptured. Absent when the opportunity is not
   * about money that already exists. */
  atRiskValue: OpportunityMoney | null;
  /** The ceiling if every targeted action succeeded. */
  addressableValue: OpportunityMoney | null;
  /** atRisk/addressable x an observed rate. `null` whenever
   * `basis === "INSUFFICIENT_EVIDENCE"`. */
  expectedIncrementalValue: OpportunityMoney | null;
  basis: EvidenceBasis;
  /** Plain-language statement of exactly how the numbers above were
   * derived, including the sample. Shown to the merchant verbatim. */
  method: string;
  /** Observations behind the rate. Zero when no rate was used. */
  sampleSize: number;
}

export interface OpportunityScoreBreakdown {
  value: number;
  confidence: number;
  urgency: number;
  customerImpact: number;
  effort: number;
  policy: number;
  /** Weighted sum, 0-100. */
  priority: number;
}

export interface OpportunityPolicyResult {
  outcome: OpportunityPolicyOutcome;
  /** Closed reason codes, never free text from a model. */
  reasons: string[];
}

export interface RevenueOpportunity {
  /** Stable across scans for the same underlying facts, so a merchant
   * does not watch cards shuffle identity on every refresh. */
  id: string;
  type: RevenueOpportunityType;
  title: string;
  /** WHY DETECTED — the observed fact, with its numbers. */
  whyDetected: string;
  /** WHAT ACTION IS PROPOSED. */
  proposedAction: OpportunityAction;
  actionLabel: string;
  /** EXPECTED EFFECT. */
  expectedEffect: OpportunityExpectedEffect;
  /** EVIDENCE. */
  evidence: OpportunityEvidence[];
  /** RISK — what could go wrong, stated before the merchant acts. */
  risk: string;
  /** POLICY RESULT. */
  policy: OpportunityPolicyResult;
  effort: OpportunityEffort;
  score: OpportunityScoreBreakdown;
  /**
   * Whether a human must sign this off before anything executes.
   *
   * Surfaced as its own field rather than left to be inferred from
   * `policy.outcome` and `effort` together. A merchant scanning a list
   * needs to know which rows will interrupt them, and a caller that has
   * to combine two other fields to work that out will eventually combine
   * them differently from the console.
   */
  approvalRequired: boolean;
  /** Lifted out of `score` because they are the two components a merchant
   * actually argues with. The full breakdown stays in `score`. */
  confidence: number;
  urgency: number;
  /** DETERMINISTIC STATUS — see `OPPORTUNITY_STATUSES`. */
  status: OpportunityStatus;
  /** What came of it, in one sentence, or `null` while nothing has. Never
   * a monetary claim: verified money lives on the payment rows, and
   * restating it here would create a second place for it to be wrong. */
  result: string | null;
  /** Entities the action would touch, for deep-linking the console. */
  subjectIds: string[];
  customersAffected: number;
}

/* -------------------------------------------------------------------------
 * Engine input
 *
 * Deliberately plain data. The API assembles this from Prisma; the engine
 * never learns what an ORM is, which is what keeps it unit-testable
 * against hand-written facts.
 * ---------------------------------------------------------------------- */

export interface FailedPaymentFact {
  paymentId: string;
  orderId: string;
  customerId: string | null;
  amountMinor: number;
  currency: CurrencyCode;
  failureCategory: string | null;
  /** Whether `evaluateRecoveryEligibility` cleared this one. Computed by
   * the caller, so recovery rules live in exactly one place. */
  recoveryEligible: boolean;
  recoveryBlockedReason: string | null;
  ageDays: number;
}

/**
 * A payment sitting in UNKNOWN: an attempt was made and its outcome was
 * never established with the provider.
 *
 * These were invisible to this engine, which filters `state === "FAILED"`.
 * Nothing detected them and nothing acted on them, so the money was
 * neither recovered nor written off — it simply sat.
 */
export interface UnverifiedPaymentFact {
  paymentId: string;
  orderId: string;
  customerId: string | null;
  amountMinor: number;
  currency: CurrencyCode;
  ageDays: number;
  /** Whether a provider reference exists to reconcile AGAINST. Without
   * one there is nothing to ask the provider about, and the payment is
   * excluded rather than surfaced as actionable. */
  hasProviderReference: boolean;
}

export interface StalledCheckoutFact {
  orderId: string;
  customerId: string | null;
  amountMinor: number;
  currency: CurrencyCode;
  ageHours: number;
}

export interface CustomerPurchaseFact {
  customerId: string;
  displayName: string;
  paidOrderCount: number;
  /** Sum of PAID orders only. A cancelled order is not lifetime value. */
  lifetimeValueMinor: number;
  daysSinceLastPaidOrder: number | null;
  /** Median gap between this customer's own consecutive paid orders.
   * `null` with fewer than two paid orders — there is no gap to measure. */
  medianOrderGapDays: number | null;
}

export interface ProductPerformanceFact {
  productId: string;
  name: string;
  /** Units sold across PAID orders. */
  unitsSold: number;
  /** Cheapest active, priced variant — the realistic incremental ticket. */
  entryPriceMinor: number | null;
  /** Dearest active, priced variant. The gap between this and
   * `entryPriceMinor` is the only defensible basis for an upsell: it is
   * the merchant's own price ladder, not a guess at what a buyer would
   * pay. `null` when there is no priced variant. */
  topPriceMinor: number | null;
  currency: CurrencyCode;
  outgoingRelationshipCount: number;
  hasStructuredAttributes: boolean;
  hasRecordedInventory: boolean;
  agentVisible: boolean;
  /** The merchant's own `promotionEligibility` on the product. An offer
   * may only ever be proposed on a product they have marked eligible —
   * the engine never decides that for them. */
  promotionEligible: boolean;
}

export interface MerchantRevenueEvidence {
  currency: CurrencyCode;
  /** Average value of PAID orders. The yardstick every value score is
   * measured against. Zero when the merchant has no paid orders, which
   * the engine handles rather than dividing by. */
  averageOrderValueMinor: number;
  paidOrderCount: number;
  /** Every order that reached a payment attempt — the denominator of the
   * observed capture rate. */
  ordersWithPaymentAttempt: number;
  /** Failed payment attempts, ever. Denominator of the recovery rate. */
  failedPaymentCount: number;
  /** Payments captured on a second-or-later attempt. Numerator of the
   * recovery rate — the only honest source for "what fraction of failed
   * payments does THIS merchant actually recover". */
  recoveredPaymentCount: number;

  failedPayments: FailedPaymentFact[];
  unverifiedPayments: UnverifiedPaymentFact[];
  stalledCheckouts: StalledCheckoutFact[];
  customers: CustomerPurchaseFact[];
  products: ProductPerformanceFact[];

  /** From `MerchantGrowthConfig` — bounds what may even be proposed. */
  growthActionsEnabled: boolean;
  crossSellEnabled: boolean;
  upsellEnabled: boolean;
  /** Merchant-set ceiling above which an action needs explicit approval. */
  approvalThresholdMinor: number;
  /** Whether the merchant permits bounded offers at all. Gates the
   * ELIGIBLE_OFFER detector completely — a merchant who has switched
   * offers off should not be shown offer opportunities. */
  boundedOffersEnabled: boolean;
  /**
   * LEARN: the offer-conversion lift this merchant has actually measured
   * against a real campaign holdout, in basis points. `null` until a
   * campaign with a control group has produced one.
   *
   * This is the only input to the engine that comes from a controlled
   * comparison rather than an observation, and it exists so the
   * ELIGIBLE_OFFER detector can stop withholding its estimate once the
   * merchant has earned the right to one. Supplied by the caller from
   * `computeCampaignLift`; the engine never derives it.
   */
  observedOfferLiftBps: number | null;
  /**
   * Subjects (payment, order or product ids) that already carry an agent
   * proposal. Supplied by the caller from `GrowthActionProposal` rows, so
   * status is derived from the same table governance reads rather than
   * from a second record of what the agent has done.
   */
  actedOnSubjectIds: string[];

  /** Latest readiness snapshot, for the AI-buyer opportunity. */
  readinessScore: number | null;
  readinessBlockers: string[];
}

/* -------------------------------------------------------------------------
 * Small deterministic helpers
 * ---------------------------------------------------------------------- */

/** Integer basis-point rate. Returns `null` rather than a misleading 0
 * when there is nothing to divide by. */
export function rateBps(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator * 10_000) / denominator);
}

/** Applies a basis-point rate to a minor-unit amount, flooring so an
 * estimate can never round its way above the amount it derives from. */
export function applyRateBps(amountMinor: number, bps: number): number {
  return Math.floor((amountMinor * bps) / 10_000);
}

function formatBps(bps: number): string {
  return `${(bps / 100).toFixed(1)}%`;
}

/** 0-100, saturating at `VALUE_SATURATION_AOV_MULTIPLE` x AOV. With no
 * paid orders there is no scale to judge against, so every opportunity
 * scores the same middling value rather than a fabricated ranking. */
function valueComponent(amountMinor: number, averageOrderValueMinor: number): number {
  if (averageOrderValueMinor <= 0) return 50;
  const ceiling = averageOrderValueMinor * VALUE_SATURATION_AOV_MULTIPLE;
  return Math.max(0, Math.min(100, Math.round((amountMinor * 100) / ceiling)));
}

/**
 * How far along the purchase journey the evidence sits.
 *
 * This is the confidence axis, and it is deliberately NOT derived from
 * `EvidenceBasis`. Those two things answer different questions, and an
 * earlier version of this engine conflated them with a visibly wrong
 * result: a failed payment carrying real, recorded money ranked BELOW a
 * catalogue-tidying task, purely because no recovery rate could be
 * derived for it yet.
 *
 *   EvidenceBasis  — "can we put a number on the incremental gain?"
 *                    Withholding an estimate is the honest answer there.
 *   IntentStrength — "how sure are we this opportunity is real, and this
 *                    size?" A buyer who reached checkout and had their
 *                    card declined is the strongest signal in commerce,
 *                    whether or not we can yet say what fraction returns.
 *
 * Keeping them separate is what lets the engine say "we do not know how
 * much of this comes back, and you should still deal with it first".
 */
export const INTENT_STRENGTH = {
  /** Buyer chose, reached checkout, and a payment attempt was declined.
   * The money is a row, and the intent is proven. */
  ATTEMPTED_PAYMENT: 100,
  /** Buyer chose and reached checkout, then stopped before paying. */
  REACHED_CHECKOUT: 85,
  /** A blocker whose existence is certain, though its revenue effect is
   * not — a product an agent provably cannot transact on. */
  CONFIRMED_BLOCKER: 60,
  /** A demonstrated purchase cadence. Scales with how many order-to-order
   * gaps actually support it. */
  DEMONSTRATED_CADENCE: 45,
  /** A single past purchase, or a structural catalogue gap. Real, but it
   * carries no evidence that acting produces revenue. */
  WEAK_SIGNAL: 25,
} as const;

/** Cadence confidence grows with the number of observed gaps rather than
 * jumping to certain at the sample threshold. */
function cadenceConfidence(gapObservations: number): number {
  return Math.min(80, INTENT_STRENGTH.DEMONSTRATED_CADENCE + gapObservations * 4);
}

/** Fresh work scores high and decays linearly to zero across the window.
 * Something past its window still appears — it is simply no longer
 * urgent, which is different from no longer real. */
function urgencyComponent(ageDays: number, windowDays: number): number {
  if (windowDays <= 0) return 0;
  const remaining = 100 - Math.round((ageDays * 100) / windowDays);
  return Math.max(0, Math.min(100, remaining));
}

function customerImpactComponent(customersAffected: number, totalCustomers: number): number {
  if (customersAffected <= 0) return 0;
  if (totalCustomers <= 0) return Math.min(100, customersAffected * 20);
  return Math.max(0, Math.min(100, Math.round((customersAffected * 100) / totalCustomers)));
}

function computeScore(parts: {
  value: number;
  confidence: number;
  urgency: number;
  customerImpact: number;
  effort: OpportunityEffort;
  policy: OpportunityPolicyOutcome;
}): OpportunityScoreBreakdown {
  const effort = EFFORT_SCORE[parts.effort];
  const policy = POLICY_SCORE[parts.policy];
  const weighted =
    parts.value * SCORE_WEIGHTS_BPS.value +
    parts.confidence * SCORE_WEIGHTS_BPS.confidence +
    parts.urgency * SCORE_WEIGHTS_BPS.urgency +
    parts.customerImpact * SCORE_WEIGHTS_BPS.customerImpact +
    effort * SCORE_WEIGHTS_BPS.effort +
    policy * SCORE_WEIGHTS_BPS.policy;
  return {
    value: parts.value,
    confidence: parts.confidence,
    urgency: parts.urgency,
    customerImpact: parts.customerImpact,
    effort,
    policy,
    priority: Math.round(weighted / 10_000),
  };
}

function money(amountMinor: number, currency: CurrencyCode, classification: OpportunityValueClassification): OpportunityMoney {
  return { amountMinor, currency, classification };
}

/**
 * What a detector actually writes.
 *
 * The five fields below are omitted because every one of them is
 * DERIVABLE from what the detector already stated, and deriving them once
 * is what stops ten detectors from disagreeing about the same question.
 * A detector that had to remember to set `approvalRequired` itself would
 * eventually set it inconsistently with its own `policy.outcome`, and the
 * console would show a row marked "no approval needed" that the policy
 * engine then held for approval.
 */
type OpportunityDraft = Omit<
  RevenueOpportunity,
  "approvalRequired" | "confidence" | "urgency" | "status" | "result"
>;

/**
 * Fills the derived fields, deterministically, for every detector.
 *
 * `approvalRequired` is true when the policy pre-filter says a human is
 * needed, OR when acting is not something the agent can do alone. Both
 * halves matter: a catalogue edit needs no policy approval and still
 * cannot happen without the merchant.
 */
function finalise(draft: OpportunityDraft): RevenueOpportunity {
  return {
    ...draft,
    approvalRequired: draft.policy.outcome === "REQUIRES_APPROVAL" || draft.effort !== "AGENT_AUTOMATIC",
    confidence: draft.score.confidence,
    urgency: draft.score.urgency,
    status: "DETECTED",
    result: null,
  };
}

/* -------------------------------------------------------------------------
 * Detectors
 *
 * Each returns zero or more opportunities. Each is independently
 * testable and independently disableable, and none of them reads
 * anything the caller did not hand it.
 * ---------------------------------------------------------------------- */

/**
 * A payment in UNKNOWN is the only condition here where the merchant does
 * not know what happened to their own money.
 *
 * WHY THIS REPORTS NO ESTIMATE AT ALL
 *
 * Every other detector estimates what an action might be worth. This one
 * cannot, and the reason is the point: the amount is real and recorded,
 * but whether it is ALREADY the merchant's money is exactly what is
 * unknown. Reconciling might reveal a capture that was always theirs, or
 * a failure that never was. Calling either outcome "expected incremental
 * revenue" would be inventing a payment result — the specific thing this
 * engine exists to refuse.
 *
 * So the value is reported as at-risk and DIRECT_OBSERVATION, the
 * incremental estimate is withheld, and the action is the only honest one
 * available: ask the provider.
 *
 * ALWAYS ELIGIBLE, NEVER APPROVAL-GATED
 *
 * Reconciliation moves no money and authors no fact; it can only make the
 * merchant's record more true. Putting it behind an approval would leave
 * money in limbo waiting for a human to permit a read.
 */
function detectUnverifiedPayments(evidence: MerchantRevenueEvidence): OpportunityDraft[] {
  const actionable = evidence.unverifiedPayments.filter((p) => p.hasProviderReference);
  if (actionable.length === 0) return [];

  const atRiskMinor = actionable.reduce((sum, p) => sum + p.amountMinor, 0);
  const customers = new Set(actionable.map((p) => p.customerId).filter((c): c is string => c !== null));
  const freshestAgeDays = Math.min(...actionable.map((p) => p.ageDays));
  const policy: OpportunityPolicyResult = { outcome: "ELIGIBLE", reasons: ["NO_FINANCIAL_EFFECT"] };

  return [
    {
      id: "unverified-payment",
      type: "UNVERIFIED_PAYMENT",
      title: "Verify payments with an unknown outcome",
      whyDetected: `${actionable.length} payment${actionable.length === 1 ? "" : "s"} ${actionable.length === 1 ? "is" : "are"} in an UNKNOWN state: an attempt was made and its outcome was never confirmed with the provider. Until it is, this money is neither recovered nor written off.`,
      proposedAction: "RECONCILE_PAYMENT",
      actionLabel: "Ask the provider what actually happened to these payments",
      expectedEffect: {
        atRiskValue: money(atRiskMinor, evidence.currency, "OBSERVED"),
        addressableValue: money(atRiskMinor, evidence.currency, "OPPORTUNITY"),
        // Withheld deliberately, and the method says why in full.
        expectedIncrementalValue: null,
        basis: "INSUFFICIENT_EVIDENCE",
        method:
          "No incremental estimate is offered, and none is possible. Reconciliation reveals what already happened rather than causing anything to happen: the provider may report a capture that was always this merchant's money, or a failure that never was. Presenting either as expected incremental revenue would be inventing a payment result.",
        sampleSize: 0,
      },
      evidence: [
        { label: "Payments with an unknown outcome", value: String(actionable.length), source: "Payment rows in state UNKNOWN with a provider reference" },
        { label: "Amount in those payments", value: String(atRiskMinor), money: { amountMinor: atRiskMinor, currency: evidence.currency }, source: "Sum of Payment.amountMinor" },
        {
          label: "Oldest unresolved",
          value: `${Math.max(...actionable.map((p) => p.ageDays))} days`,
          source: "Payment.createdAt",
        },
        ...(evidence.unverifiedPayments.length > actionable.length
          ? [
              {
                label: "Excluded, no provider reference",
                value: String(evidence.unverifiedPayments.length - actionable.length),
                source: "Payment rows with neither providerPaymentId nor providerOrderId — there is nothing to ask the provider about",
              },
            ]
          : []),
      ],
      risk:
        "Reconciliation only reads from the provider and records what they report. It moves no money and cannot double-charge. Where the provider is ambiguous about which attempt is authoritative, it refuses rather than guessing.",
      policy,
      effort: "AGENT_AUTOMATIC",
      score: computeScore({
        value: valueComponent(atRiskMinor, evidence.averageOrderValueMinor),
        confidence: INTENT_STRENGTH.ATTEMPTED_PAYMENT,
        urgency: urgencyComponent(freshestAgeDays, FAILED_PAYMENT_RECOVERY_WINDOW_DAYS),
        customerImpact: customerImpactComponent(customers.size, evidence.customers.length),
        effort: "AGENT_AUTOMATIC",
        policy: policy.outcome,
      }),
      subjectIds: actionable.map((p) => p.paymentId),
      customersAffected: customers.size,
    },
  ];
}

/**
 * Failed payments are the least speculative revenue in commerce: the
 * buyer chose the product, reached checkout, and tried to pay. The money
 * is real and recorded. What is NOT known, for a merchant who has never
 * recovered one, is what fraction comes back — so that fraction is
 * withheld rather than assumed.
 */
function detectFailedPaymentRecovery(evidence: MerchantRevenueEvidence): OpportunityDraft[] {
  const eligible = evidence.failedPayments.filter((p) => p.recoveryEligible);
  if (eligible.length === 0) return [];

  const atRiskMinor = eligible.reduce((sum, p) => sum + p.amountMinor, 0);
  const observedRecoveryBps = rateBps(evidence.recoveredPaymentCount, evidence.failedPaymentCount);
  const hasRate = observedRecoveryBps !== null && evidence.failedPaymentCount >= MIN_SAMPLE_FOR_OBSERVED_RATE;

  const basis: EvidenceBasis = hasRate ? "OBSERVED_HISTORY" : "INSUFFICIENT_EVIDENCE";
  const expected = hasRate
    ? money(applyRateBps(atRiskMinor, observedRecoveryBps), evidence.currency, "ESTIMATED")
    : null;

  const method = hasRate
    ? `${formatBps(observedRecoveryBps)} of this merchant's failed payments were later captured on a retry (${evidence.recoveredPaymentCount} of ${evidence.failedPaymentCount}). That observed rate is applied to the amount currently sitting in retryable failed payments.`
    : `No incremental estimate is offered. A recovery rate needs at least ${MIN_SAMPLE_FOR_OBSERVED_RATE} historical failed payments to be derived from; this merchant has ${evidence.failedPaymentCount}${evidence.recoveredPaymentCount === 0 ? " and has never recovered one" : ""}. The at-risk amount below is not an estimate — it is the sum of the failed payment rows themselves.`;

  const customers = new Set(eligible.map((p) => p.customerId).filter((c): c is string => c !== null));
  const freshestAgeDays = Math.min(...eligible.map((p) => p.ageDays));

  const byCategory = new Map<string, number>();
  for (const p of eligible) {
    const key = p.failureCategory ?? "UNCATEGORISED";
    byCategory.set(key, (byCategory.get(key) ?? 0) + 1);
  }

  /**
   * THE THRESHOLD IS PER PAYMENT, NOT PER CARD.
   *
   * This compared the SUM of every eligible failed payment against the
   * merchant's auto-approval ceiling. That is the wrong test, because the
   * policy engine decides one proposal — one payment — at a time. Summing
   * eighty payments exceeds any sane per-order ceiling, so the card said
   * "needs your approval" for work the agent would in fact do entirely on
   * its own, and the two screens contradicted each other.
   *
   * The honest question is whether the DEAREST single recovery is inside
   * the ceiling: if it is, every one of them is, and the agent can work
   * the whole set alone.
   */
  const largestSingleMinor = Math.max(...eligible.map((p) => p.amountMinor));
  const withinBounds = largestSingleMinor <= evidence.approvalThresholdMinor;

  const policy: OpportunityPolicyResult = withinBounds
    ? { outcome: "ELIGIBLE", reasons: ["WITHIN_MERCHANT_BOUNDS"] }
    : { outcome: "REQUIRES_APPROVAL", reasons: ["ABOVE_APPROVAL_THRESHOLD"] };

  /**
   * Effort follows the policy pre-filter rather than being hardcoded.
   *
   * It was fixed at `ONE_APPROVAL`, which meant the one opportunity type
   * the agent can genuinely complete end to end was the one advertised as
   * needing a human. Recovery needs nothing from a buyer — the order,
   * basket and price already exist — so inside the merchant's own limits
   * it is exactly `AGENT_AUTOMATIC`.
   */
  const effort: OpportunityEffort = withinBounds ? "AGENT_AUTOMATIC" : "ONE_APPROVAL";

  return [
    {
      id: "failed-payment-recovery",
      type: "FAILED_PAYMENT_RECOVERY",
      title: "Recover failed payments",
      whyDetected: `${eligible.length} payment${eligible.length === 1 ? "" : "s"} failed for a retryable reason and the order${eligible.length === 1 ? " has" : "s have"} never been paid. The buyer had already chosen the product and reached checkout.`,
      proposedAction: "RECOVER_FAILED_PAYMENT",
      actionLabel: "Retry the failed payments through a bounded recovery attempt",
      expectedEffect: {
        atRiskValue: money(atRiskMinor, evidence.currency, "OBSERVED"),
        addressableValue: money(atRiskMinor, evidence.currency, "OPPORTUNITY"),
        expectedIncrementalValue: expected,
        basis,
        method,
        sampleSize: hasRate ? evidence.failedPaymentCount : 0,
      },
      evidence: [
        { label: "Retryable failed payments", value: String(eligible.length), source: "Payment rows in state FAILED whose order is still unpaid" },
        { label: "Amount in those payments", value: String(atRiskMinor), money: { amountMinor: atRiskMinor, currency: evidence.currency }, source: "Sum of Payment.amountMinor" },
        ...[...byCategory.entries()].map(([category, count]) => ({
          label: `Failure reason: ${category}`,
          value: `${count} payment${count === 1 ? "" : "s"}`,
          source: "Payment.failureCategory",
        })),
        { label: "Recoveries in history", value: `${evidence.recoveredPaymentCount} of ${evidence.failedPaymentCount} failures`, source: "Payments captured with attemptNumber > 1" },
        // A card covering many payments of mixed sizes is one the policy
        // engine will decide payment by payment. Stating the split here
        // stops "needs your approval" from reading as "none of this can
        // proceed without you" when most of it can.
        {
          label: "Inside your automatic limit",
          value: `${eligible.filter((p) => p.amountMinor <= evidence.approvalThresholdMinor).length} of ${eligible.length} payments`,
          source: "Payment.amountMinor vs MerchantPolicy.autoApprovalOrderAmountMinor",
        },
      ],
      risk:
        "A retry must never double-charge. Recovery re-checks the authoritative payment state before it runs, and a payment that is already captured, or whose state is unverified, is refused rather than retried.",
      policy,
      effort,
      score: computeScore({
        value: valueComponent(atRiskMinor, evidence.averageOrderValueMinor),
        confidence: INTENT_STRENGTH.ATTEMPTED_PAYMENT,
        urgency: urgencyComponent(freshestAgeDays, FAILED_PAYMENT_RECOVERY_WINDOW_DAYS),
        customerImpact: customerImpactComponent(customers.size, evidence.customers.length),
        effort,
        policy: policy.outcome,
      }),
      // Payment ids, not order ids: the recovery endpoint this card's
      // action calls is addressed by the failed PAYMENT, and a subject
      // list the action cannot consume is a card that cannot be acted on.
      subjectIds: eligible.map((p) => p.paymentId),
      customersAffected: customers.size,
    },
  ];
}

/**
 * A checkout that reached a created payment and then stopped. Unlike a
 * failed payment nothing was declined — the buyer simply did not finish.
 * The capture rate this merchant achieves on orders that reach a payment
 * attempt is a real, checkable denominator, so an estimate IS available
 * here where it is not for recovery.
 */
function detectAbandonedCheckoutRecovery(evidence: MerchantRevenueEvidence): OpportunityDraft[] {
  const stale = evidence.stalledCheckouts.filter((c) => c.ageHours >= CHECKOUT_STALE_AFTER_HOURS);
  if (stale.length === 0) return [];

  const addressableMinor = stale.reduce((sum, c) => sum + c.amountMinor, 0);
  const captureBps = rateBps(evidence.paidOrderCount, evidence.ordersWithPaymentAttempt);
  const hasRate = captureBps !== null && evidence.ordersWithPaymentAttempt >= MIN_SAMPLE_FOR_OBSERVED_RATE;

  const basis: EvidenceBasis = hasRate ? "OBSERVED_HISTORY" : "INSUFFICIENT_EVIDENCE";
  const expected = hasRate ? money(applyRateBps(addressableMinor, captureBps), evidence.currency, "ESTIMATED") : null;

  const method = hasRate
    ? `${formatBps(captureBps)} of this merchant's orders that reached a payment attempt were eventually captured (${evidence.paidOrderCount} of ${evidence.ordersWithPaymentAttempt}). That observed rate is applied to the value sitting in stalled checkouts. It is a baseline completion rate for this merchant, not a measured response rate to a recovery nudge — no such nudge has run yet.`
    : `No incremental estimate is offered: fewer than ${MIN_SAMPLE_FOR_OBSERVED_RATE} orders have reached a payment attempt, so this merchant has no completion rate to apply.`;

  const customers = new Set(stale.map((c) => c.customerId).filter((c): c is string => c !== null));
  const freshestAgeDays = Math.min(...stale.map((c) => Math.floor(c.ageHours / 24)));

  const effort: OpportunityEffort = "ONE_APPROVAL";
  const policy: OpportunityPolicyResult =
    addressableMinor > evidence.approvalThresholdMinor
      ? { outcome: "REQUIRES_APPROVAL", reasons: ["ABOVE_APPROVAL_THRESHOLD"] }
      : { outcome: "ELIGIBLE", reasons: ["WITHIN_MERCHANT_BOUNDS"] };

  return [
    {
      id: "abandoned-checkout-recovery",
      type: "ABANDONED_CHECKOUT_RECOVERY",
      title: "Recover abandoned checkouts",
      whyDetected: `${stale.length} checkout${stale.length === 1 ? "" : "s"} created a payment and never completed it, each idle for more than ${CHECKOUT_STALE_AFTER_HOURS} hours. Nothing was declined — the buyer stopped.`,
      proposedAction: "RECOVER_ABANDONED_CHECKOUT",
      actionLabel: "Re-issue a checkout link for the abandoned baskets",
      expectedEffect: {
        atRiskValue: money(addressableMinor, evidence.currency, "OBSERVED"),
        addressableValue: money(addressableMinor, evidence.currency, "OPPORTUNITY"),
        expectedIncrementalValue: expected,
        basis,
        method,
        sampleSize: hasRate ? evidence.ordersWithPaymentAttempt : 0,
      },
      evidence: [
        { label: "Stalled checkouts", value: String(stale.length), source: "Payments in state CREATED older than the stale threshold" },
        { label: "Value in those checkouts", value: String(addressableMinor), money: { amountMinor: addressableMinor, currency: evidence.currency }, source: "Sum of Payment.amountMinor" },
        { label: "Merchant capture rate", value: captureBps === null ? "not derivable" : formatBps(captureBps), source: `${evidence.paidOrderCount} paid of ${evidence.ordersWithPaymentAttempt} orders with a payment attempt` },
      ],
      risk:
        "Re-issuing a link must not create a second chargeable order. Recovery reuses the existing order and its idempotency key, so a buyer who quietly completed the original payment cannot be charged twice.",
      policy,
      effort,
      score: computeScore({
        value: valueComponent(addressableMinor, evidence.averageOrderValueMinor),
        confidence: INTENT_STRENGTH.REACHED_CHECKOUT,
        urgency: urgencyComponent(freshestAgeDays, ABANDONED_CHECKOUT_RECOVERY_WINDOW_DAYS),
        customerImpact: customerImpactComponent(customers.size, evidence.customers.length),
        effort,
        policy: policy.outcome,
      }),
      subjectIds: stale.map((c) => c.orderId),
      customersAffected: customers.size,
    },
  ];
}

/**
 * Customers with two or more paid orders have a cadence of their own.
 * Being late against THEIR OWN median gap is a real signal; being late
 * against a made-up "30 day" industry figure is not, which is why the
 * comparison is per customer.
 */
function detectRepeatPurchase(evidence: MerchantRevenueEvidence): OpportunityDraft[] {
  const repeatCustomers = evidence.customers.filter(
    (c) => c.paidOrderCount >= 2 && c.medianOrderGapDays !== null && c.daysSinceLastPaidOrder !== null,
  );
  if (repeatCustomers.length === 0) return [];

  const due = repeatCustomers.filter(
    (c) => c.daysSinceLastPaidOrder! >= Math.ceil((c.medianOrderGapDays! * REPEAT_PURCHASE_DUE_MULTIPLIER_BPS) / 10_000),
  );
  if (due.length === 0) return [];

  // Their own average paid-order value, not the merchant-wide AOV: these
  // are known customers with known spend.
  const addressableMinor = due.reduce((sum, c) => sum + Math.floor(c.lifetimeValueMinor / c.paidOrderCount), 0);

  // The gap observations that support the cadence claim: each repeat
  // customer contributes (paidOrderCount - 1) gaps.
  const gapObservations = repeatCustomers.reduce((sum, c) => sum + (c.paidOrderCount - 1), 0);
  // A cadence is observable, but no reactivation-response rate has ever
  // been measured for this merchant, so the ceiling is reported and the
  // incremental figure is withheld. This is the honest asymmetry: we know
  // WHO is due, we do not know how many will buy because we asked.
  const basis: EvidenceBasis = "INSUFFICIENT_EVIDENCE";

  const effort: OpportunityEffort = "ONE_APPROVAL";
  const policy: OpportunityPolicyResult = evidence.growthActionsEnabled
    ? { outcome: "ELIGIBLE", reasons: ["WITHIN_MERCHANT_BOUNDS"] }
    : { outcome: "BLOCKED", reasons: ["GROWTH_ACTIONS_DISABLED"] };

  const medianOfMedians = [...repeatCustomers.map((c) => c.medianOrderGapDays!)].sort((a, b) => a - b)[
    Math.floor(repeatCustomers.length / 2)
  ]!;

  return [
    {
      id: "repeat-purchase-due",
      type: "REPEAT_PURCHASE",
      title: "Prompt repeat customers who are overdue",
      whyDetected: `${due.length} repeat customer${due.length === 1 ? " is" : "s are"} past ${(REPEAT_PURCHASE_DUE_MULTIPLIER_BPS / 10_000).toFixed(1)}x their own median gap between orders. This compares each customer against their own cadence, not an assumed one.`,
      proposedAction: "PROMPT_REPEAT_PURCHASE",
      actionLabel: "Send a bounded repeat-purchase prompt to overdue customers",
      expectedEffect: {
        atRiskValue: null,
        addressableValue: money(addressableMinor, evidence.currency, "OPPORTUNITY"),
        expectedIncrementalValue: null,
        basis,
        method: `The ceiling shown is the sum of each overdue customer's own average paid-order value — what this cohort would be worth if every one of them bought again at their usual size. No incremental estimate is offered, because this merchant has never run a repeat-purchase prompt and therefore has no observed response rate to apply. The cadence itself is observed: ${gapObservations} order-to-order gaps across ${repeatCustomers.length} repeat customers.`,
        sampleSize: gapObservations,
      },
      evidence: [
        { label: "Repeat customers", value: String(repeatCustomers.length), source: "Customers with 2 or more PAID orders" },
        { label: "Order-gap observations", value: String(gapObservations), source: "Consecutive paid-order intervals" },
        { label: "Median gap across them", value: `${medianOfMedians} days`, source: "Median of each customer's median interval" },
        { label: "Overdue now", value: String(due.length), source: `Days since last paid order exceeds ${(REPEAT_PURCHASE_DUE_MULTIPLIER_BPS / 10_000).toFixed(1)}x their own median` },
      ],
      risk:
        "Contact fatigue. A prompt is bounded by the merchant's daily action limit and never carries a discount unless the offer policy separately allows one, so this cannot quietly become margin erosion.",
      policy,
      effort,
      score: computeScore({
        value: valueComponent(addressableMinor, evidence.averageOrderValueMinor),
        confidence: cadenceConfidence(gapObservations),
        // Overdue-ness is the urgency, expressed against the cohort's own
        // cadence rather than a calendar window.
        urgency: Math.max(0, Math.min(100, Math.round((due.length * 100) / repeatCustomers.length))),
        customerImpact: customerImpactComponent(due.length, evidence.customers.length),
        effort,
        policy: policy.outcome,
      }),
      subjectIds: due.map((c) => c.customerId),
      customersAffected: due.length,
    },
  ];
}

/**
 * One purchase and then silence. There is no personal cadence to be late
 * against, so this is a separate, weaker signal than repeat purchase and
 * is scored as such.
 */
function detectReactivation(evidence: MerchantRevenueEvidence): OpportunityDraft[] {
  const lapsed = evidence.customers.filter(
    (c) => c.paidOrderCount === 1 && c.daysSinceLastPaidOrder !== null && c.daysSinceLastPaidOrder >= REACTIVATION_INACTIVE_DAYS,
  );
  if (lapsed.length === 0) return [];

  const addressableMinor = lapsed.reduce((sum, c) => sum + c.lifetimeValueMinor, 0);
  const effort: OpportunityEffort = "ONE_APPROVAL";
  const policy: OpportunityPolicyResult = evidence.growthActionsEnabled
    ? { outcome: "ELIGIBLE", reasons: ["WITHIN_MERCHANT_BOUNDS"] }
    : { outcome: "BLOCKED", reasons: ["GROWTH_ACTIONS_DISABLED"] };

  return [
    {
      id: "customer-reactivation",
      type: "CUSTOMER_REACTIVATION",
      title: "Reactivate one-time buyers",
      whyDetected: `${lapsed.length} customer${lapsed.length === 1 ? " has" : "s have"} exactly one paid order and no activity for at least ${REACTIVATION_INACTIVE_DAYS} days.`,
      proposedAction: "REACTIVATE_CUSTOMER",
      actionLabel: "Send a bounded reactivation offer to lapsed one-time buyers",
      expectedEffect: {
        atRiskValue: null,
        addressableValue: money(addressableMinor, evidence.currency, "OPPORTUNITY"),
        expectedIncrementalValue: null,
        basis: "INSUFFICIENT_EVIDENCE",
        method:
          "The ceiling is the sum of these customers' first-order values — what a second order of the same size would be worth. No incremental estimate is offered: a single purchase establishes no cadence, and this merchant has no observed reactivation response rate.",
        sampleSize: 0,
      },
      evidence: [
        { label: "Lapsed one-time buyers", value: String(lapsed.length), source: `Customers with exactly 1 PAID order and ${REACTIVATION_INACTIVE_DAYS}+ days of inactivity` },
        { label: "Their combined first-order value", value: String(addressableMinor), money: { amountMinor: addressableMinor, currency: evidence.currency }, source: "Sum of PAID order totals for those customers" },
      ],
      risk:
        "A reactivation offer is the easiest place to erode margin. Any discount attached is capped by the merchant's configured discount ceiling and refused outright below the floor margin, rather than being reduced to fit.",
      policy,
      effort,
      score: computeScore({
        value: valueComponent(addressableMinor, evidence.averageOrderValueMinor),
        confidence: INTENT_STRENGTH.WEAK_SIGNAL,
        urgency: 30,
        customerImpact: customerImpactComponent(lapsed.length, evidence.customers.length),
        effort,
        policy: policy.outcome,
      }),
      subjectIds: lapsed.map((c) => c.customerId),
      customersAffected: lapsed.length,
    },
  ];
}

/**
 * A product an agent can see but cannot be offered alongside anything.
 * This is the cross-sell opportunity stated as what it is: a structural
 * gap in the relationship graph, not a claim that linking two products
 * earns a specific number of rupees.
 */
function detectCrossSellGaps(evidence: MerchantRevenueEvidence): OpportunityDraft[] {
  if (!evidence.crossSellEnabled) return [];
  const selling = evidence.products.filter((p) => p.agentVisible && p.unitsSold > 0);
  const unlinked = selling.filter((p) => p.outgoingRelationshipCount === 0);
  if (unlinked.length === 0) return [];

  // Only products that ALREADY sell are counted. Linking a product nobody
  // buys creates no cross-sell opportunity, and including them would
  // inflate the number to look impressive.
  const addressableMinor = unlinked.reduce((sum, p) => sum + (p.entryPriceMinor ?? 0), 0);
  const effort: OpportunityEffort = "MERCHANT_WORK";
  const policy: OpportunityPolicyResult = { outcome: "ELIGIBLE", reasons: ["CATALOGUE_EDIT_NOT_MONEY_MOVEMENT"] };

  return [
    {
      id: "cross-sell-unlinked-products",
      type: "CROSS_SELL",
      title: "Link complementary products to items that already sell",
      whyDetected: `${unlinked.length} product${unlinked.length === 1 ? "" : "s"} that ${unlinked.length === 1 ? "has" : "have"} sold at least once ${unlinked.length === 1 ? "has" : "have"} no related product recorded, so the Merchant Agent has nothing it can propose alongside ${unlinked.length === 1 ? "it" : "them"}.`,
      proposedAction: "RECOMMEND_COMPLEMENTARY_PRODUCT",
      actionLabel: "Record a complementary product for each unlinked seller",
      expectedEffect: {
        atRiskValue: null,
        addressableValue: money(addressableMinor, evidence.currency, "OPPORTUNITY"),
        expectedIncrementalValue: null,
        basis: "INSUFFICIENT_EVIDENCE",
        method:
          "The ceiling is one entry-priced add-on per unlinked selling product — the value of a single successful cross-sell on each. No incremental estimate is offered: no cross-sell has been accepted yet, so there is no attach rate to apply.",
        sampleSize: 0,
      },
      evidence: [
        { label: "Products that have sold", value: String(selling.length), source: "Distinct products in PAID order items" },
        { label: "Of those, with no relationship", value: String(unlinked.length), source: "ProductRelationship rows where the product is the source" },
      ],
      risk:
        "A poor pairing wastes the one recommendation slot and irritates buyers. Relationships are merchant-authored; the agent proposes from them and never invents a pairing.",
      policy,
      effort,
      score: computeScore({
        value: valueComponent(addressableMinor, evidence.averageOrderValueMinor),
        confidence: INTENT_STRENGTH.WEAK_SIGNAL,
        urgency: 20,
        customerImpact: 0,
        effort,
        policy: policy.outcome,
      }),
      subjectIds: unlinked.map((p) => p.productId),
      customersAffected: 0,
    },
  ];
}

/**
 * Agent-visible, structurally sound, and yet nothing has ever sold. This
 * is deliberately narrow: only products with NO defensible excuse (they
 * are visible, priced, attributed and stocked) count, so the list is a
 * conversion problem rather than a restatement of the catalogue gaps.
 */
function detectUnderperformingProducts(evidence: MerchantRevenueEvidence): OpportunityDraft[] {
  const wellFormedNeverSold = evidence.products.filter(
    (p) => p.agentVisible && p.unitsSold === 0 && p.entryPriceMinor !== null && p.hasStructuredAttributes && p.hasRecordedInventory,
  );
  if (wellFormedNeverSold.length === 0) return [];

  const addressableMinor = wellFormedNeverSold.reduce((sum, p) => sum + (p.entryPriceMinor ?? 0), 0);
  const effort: OpportunityEffort = "MERCHANT_WORK";
  const policy: OpportunityPolicyResult = { outcome: "ELIGIBLE", reasons: ["CATALOGUE_EDIT_NOT_MONEY_MOVEMENT"] };

  return [
    {
      id: "underperforming-products",
      type: "UNDERPERFORMING_PRODUCT",
      title: "Products that are fully listed but have never sold",
      whyDetected: `${wellFormedNeverSold.length} product${wellFormedNeverSold.length === 1 ? " is" : "s are"} agent-visible, priced, attributed and stocked, and ${wellFormedNeverSold.length === 1 ? "has" : "have"} still never appeared in a paid order. The listing is not the problem, so positioning or price is.`,
      proposedAction: "IMPROVE_PRODUCT_CONVERSION",
      actionLabel: "Review positioning or price on products that are listed correctly but never sell",
      expectedEffect: {
        atRiskValue: null,
        addressableValue: money(addressableMinor, evidence.currency, "OPPORTUNITY"),
        expectedIncrementalValue: null,
        basis: "INSUFFICIENT_EVIDENCE",
        method:
          "The ceiling is one entry-priced unit of each — the value of breaking the duck once per product. No incremental estimate is offered: a product with zero sales provides no rate to extrapolate from, by definition.",
        sampleSize: 0,
      },
      evidence: [
        { label: "Well-formed products with no sales", value: String(wellFormedNeverSold.length), source: "Agent-visible, priced, attributed, stocked, and absent from every PAID order" },
        { label: "Agent-visible products in total", value: String(evidence.products.filter((p) => p.agentVisible).length), source: "Product rows with status ACTIVE" },
      ],
      risk:
        "Discounting is the tempting response and the wrong one — it converts a positioning problem into a margin problem. Any offer created from here is still bounded by the floor margin.",
      policy,
      effort,
      score: computeScore({
        value: valueComponent(addressableMinor, evidence.averageOrderValueMinor),
        confidence: INTENT_STRENGTH.WEAK_SIGNAL,
        urgency: 15,
        customerImpact: 0,
        effort,
        policy: policy.outcome,
      }),
      subjectIds: wellFormedNeverSold.slice(0, 50).map((p) => p.productId),
      customersAffected: 0,
    },
  ];
}

/**
 * Products an AI buyer cannot reliably transact on. Distinct from
 * "underperforming": these have a stated, fixable defect, and fixing it
 * is what makes the catalogue agent-usable at all.
 */
function detectAiBuyerReadinessGaps(evidence: MerchantRevenueEvidence): OpportunityDraft[] {
  const blocked = evidence.products.filter(
    (p) => p.agentVisible && (p.entryPriceMinor === null || !p.hasStructuredAttributes || !p.hasRecordedInventory),
  );
  if (blocked.length === 0) return [];

  const unpriced = blocked.filter((p) => p.entryPriceMinor === null).length;
  const unattributed = blocked.filter((p) => !p.hasStructuredAttributes).length;
  const unstocked = blocked.filter((p) => !p.hasRecordedInventory).length;

  const effort: OpportunityEffort = "MERCHANT_WORK";
  const policy: OpportunityPolicyResult = { outcome: "ELIGIBLE", reasons: ["CATALOGUE_EDIT_NOT_MONEY_MOVEMENT"] };

  return [
    {
      id: "ai-buyer-readiness-gaps",
      type: "AI_BUYER_READINESS",
      title: "Make products reliably buyable by AI agents",
      whyDetected: `${blocked.length} agent-visible product${blocked.length === 1 ? "" : "s"} ${blocked.length === 1 ? "is" : "are"} missing something an AI buyer needs in order to commit: a price, structured attributes to match a requirement against, or recorded stock. An agent will not commit to stock nobody has stated.`,
      proposedAction: "IMPROVE_AI_DISCOVERABILITY",
      actionLabel: "Fill the missing price, attribute and stock facts",
      expectedEffect: {
        atRiskValue: null,
        addressableValue: null,
        expectedIncrementalValue: null,
        basis: "INSUFFICIENT_EVIDENCE",
        // Deliberately no rupee figure at all. Attaching one to "add some
        // attributes" would be the purest form of the fabrication this
        // engine exists to avoid.
        method:
          "No monetary figure is attached. There is no defensible way to price a catalogue-completeness fix, and inventing one would misrepresent a readiness task as a revenue forecast. Its value is that it removes a hard blocker to agent purchase.",
        sampleSize: 0,
      },
      evidence: [
        { label: "Products with no priced variant", value: String(unpriced), source: "Active variants with priceMinor > 0" },
        { label: "Products with no structured attributes", value: String(unattributed), source: "ProductVariant.attributes" },
        { label: "Products with no recorded stock", value: String(unstocked), source: "Inventory rows per variant" },
        ...(evidence.readinessScore !== null
          ? [{ label: "Current readiness score", value: `${evidence.readinessScore}/100`, source: "Latest ReadinessSnapshot" }]
          : []),
      ],
      risk:
        "Low. These are catalogue facts, not money movement. The one real risk is stating stock that does not exist, which turns a discovery win into a fulfilment failure.",
      policy,
      effort,
      score: computeScore({
        // No monetary value, so the value component is driven by how much
        // of the agent-visible catalogue is affected instead — stated
        // rather than silently zeroed.
        value: Math.min(100, Math.round((blocked.length * 100) / Math.max(1, evidence.products.filter((p) => p.agentVisible).length))),
        confidence: INTENT_STRENGTH.CONFIRMED_BLOCKER,
        urgency: 40,
        customerImpact: 0,
        effort,
        policy: policy.outcome,
      }),
      subjectIds: blocked.slice(0, 50).map((p) => p.productId),
      customersAffected: 0,
    },
  ];
}

/* -------------------------------------------------------------------------
 * Entry point
 * ---------------------------------------------------------------------- */

/** Stable ordering for ties, so a refresh never reshuffles equal-priority
 * cards. Money recovery first: it is the least speculative work. */
const TYPE_TIE_BREAK: Record<RevenueOpportunityType, number> = {
  // Ahead of recovery: money whose outcome is unknown must be resolved
  // before money known to have failed is retried.
  UNVERIFIED_PAYMENT: 0,
  FAILED_PAYMENT_RECOVERY: 1,
  ABANDONED_CHECKOUT_RECOVERY: 2,
  REPEAT_PURCHASE: 3,
  CUSTOMER_REACTIVATION: 4,
  CROSS_SELL: 5,
  UPSELL: 6,
  ELIGIBLE_OFFER: 7,
  UNDERPERFORMING_PRODUCT: 8,
  PRODUCT_DISCOVERY: 9,
  AI_BUYER_READINESS: 10,
};

/**
 * Detect, score and rank. Blocked opportunities sort below every eligible
 * one regardless of score — a merchant should never see "act on this
 * first" above something policy will refuse — but they are still
 * returned, because knowing an opportunity exists and is blocked is
 * itself useful.
 */
/**
 * A price ladder the merchant already sells on.
 *
 * WHY THIS DETECTOR DID NOT EXIST BEFORE
 *
 * `UPSELL` was in the type vocabulary and `upsellEnabled` was in the
 * evidence, and nothing ever produced one — a declared category with no
 * detector behind it. The reason is that upsell is the easiest place in
 * this engine to fabricate: it is trivial to multiply a catalogue by an
 * imagined "20% of buyers trade up" and print a large number.
 *
 * So the only basis used here is the merchant's OWN price ladder. A
 * product that sells, and has a dearer active variant than the one it
 * sells at entry, has a real upgrade to propose. The ceiling is the units
 * already sold times that real spread. No incremental estimate is offered
 * at all, because nothing in the data records how often a buyer trades up
 * — and the basis says so out loud rather than picking a rate.
 */
function detectUpsell(evidence: MerchantRevenueEvidence): OpportunityDraft[] {
  if (!evidence.upsellEnabled) return [];

  const withLadder = evidence.products.filter(
    (p) =>
      p.agentVisible &&
      p.unitsSold > 0 &&
      p.entryPriceMinor !== null &&
      p.topPriceMinor !== null &&
      p.topPriceMinor > p.entryPriceMinor,
  );
  if (withLadder.length === 0) return [];

  const addressableMinor = withLadder.reduce(
    (sum, p) => sum + p.unitsSold * ((p.topPriceMinor ?? 0) - (p.entryPriceMinor ?? 0)),
    0,
  );
  const effort: OpportunityEffort = "ONE_APPROVAL";
  const policy: OpportunityPolicyResult = evidence.growthActionsEnabled
    ? { outcome: "REQUIRES_APPROVAL", reasons: ["OFFER_AFFECTS_PRICE"] }
    : { outcome: "BLOCKED", reasons: ["GROWTH_ACTIONS_DISABLED"] };

  return [
    {
      id: "upsell-price-ladder",
      type: "UPSELL",
      title: "Products selling at entry price with a dearer option available",
      whyDetected: `${withLadder.length} product${withLadder.length === 1 ? "" : "s"} you already sell ${withLadder.length === 1 ? "has" : "have"} a higher-priced active variant. The upgrade exists in your own catalogue; it is simply never proposed at the point of choice.`,
      proposedAction: "OFFER_TARGETED_UPSELL",
      actionLabel: "Let the agent propose the dearer variant when a buyer selects the entry one",
      expectedEffect: {
        atRiskValue: null,
        addressableValue: money(addressableMinor, evidence.currency, "OPPORTUNITY"),
        expectedIncrementalValue: null,
        basis: "INSUFFICIENT_EVIDENCE",
        method:
          "The ceiling is units already sold multiplied by the real gap between your cheapest and dearest active variant on each product. No incremental figure is offered: nothing in your data records how often a buyer trades up, and picking a rate would be inventing the entire number.",
        sampleSize: 0,
      },
      evidence: [
        { label: "Products with an upgrade available", value: String(withLadder.length), source: "Active priced variants where the dearest exceeds the cheapest" },
        {
          label: "Price-ladder headroom on units already sold",
          value: "",
          money: { amountMinor: addressableMinor, currency: evidence.currency },
          source: "Units sold in PAID orders x (dearest - cheapest) active variant price",
        },
      ],
      risk:
        "An upsell proposed on the wrong product reads as a sales tactic rather than help. It is bounded by your configured maximum uplift, and the buyer always sees the entry option too.",
      policy,
      effort,
      score: computeScore({
        value: valueComponent(addressableMinor, evidence.averageOrderValueMinor),
        confidence: INTENT_STRENGTH.WEAK_SIGNAL,
        urgency: 20,
        customerImpact: 0,
        effort,
        policy: policy.outcome,
      }),
      subjectIds: withLadder.slice(0, 50).map((p) => p.productId),
      customersAffected: 0,
    },
  ];
}

/**
 * Products an AI buyer cannot see at all.
 *
 * Distinct from AI_BUYER_READINESS, which is about visible products that
 * are missing a fact. This is the prior question: a product that is not
 * agent-visible is invisible to every other detector in this engine,
 * including the readiness one — so before this existed, an entire class of
 * product could sit in the catalogue producing nothing and being reported
 * by nothing.
 *
 * No monetary figure is attached, deliberately. An unpublished product has
 * no sales history and no observed demand; pricing its absence would be a
 * forecast dressed as a finding.
 */
function detectProductDiscovery(evidence: MerchantRevenueEvidence): OpportunityDraft[] {
  const invisible = evidence.products.filter((p) => !p.agentVisible);
  if (invisible.length === 0) return [];

  const priced = invisible.filter((p) => p.entryPriceMinor !== null).length;
  const effort: OpportunityEffort = "MERCHANT_WORK";
  const policy: OpportunityPolicyResult = { outcome: "ELIGIBLE", reasons: ["CATALOGUE_EDIT_NOT_MONEY_MOVEMENT"] };

  return [
    {
      id: "product-discovery-gap",
      type: "PRODUCT_DISCOVERY",
      title: "Products no AI buyer can find",
      whyDetected: `${invisible.length} product${invisible.length === 1 ? " is" : "s are"} not agent-visible, so no AI buyer can discover ${invisible.length === 1 ? "it" : "them"} however well ${invisible.length === 1 ? "it is" : "they are"} priced or stocked. ${priced} of them already ${priced === 1 ? "has" : "have"} a price.`,
      proposedAction: "PUBLISH_PRODUCT_FOR_DISCOVERY",
      actionLabel: "Publish these products so agents can find them",
      expectedEffect: {
        atRiskValue: null,
        addressableValue: null,
        expectedIncrementalValue: null,
        basis: "INSUFFICIENT_EVIDENCE",
        method:
          "No monetary figure is attached. An unpublished product has no sales history and no observed demand, so any number here would be a forecast presented as a finding.",
        sampleSize: 0,
      },
      evidence: [
        { label: "Products not visible to agents", value: String(invisible.length), source: "Product rows whose status is not ACTIVE" },
        { label: "Of those, already priced", value: String(priced), source: "At least one active variant with priceMinor > 0" },
      ],
      risk:
        "Publishing a product that is not actually ready is worse than leaving it hidden — an agent will quote it and then fail to fulfil. Check price, attributes and stock before publishing.",
      policy,
      effort,
      score: computeScore({
        value: Math.min(100, Math.round((invisible.length * 100) / Math.max(1, evidence.products.length))),
        confidence: INTENT_STRENGTH.CONFIRMED_BLOCKER,
        urgency: 25,
        customerImpact: 0,
        effort,
        policy: policy.outcome,
      }),
      subjectIds: invisible.slice(0, 50).map((p) => p.productId),
      customersAffected: 0,
    },
  ];
}

/**
 * Products the merchant has already marked promotable, that sell, on
 * which no offer is being made.
 *
 * The gate is entirely the merchant's: `promotionEligibility` is their own
 * field and `boundedOffersEnabled` is their own switch. The engine never
 * decides a product is promotable — it only notices that one they marked
 * promotable is not being promoted.
 */
function detectEligibleOffers(evidence: MerchantRevenueEvidence): OpportunityDraft[] {
  if (!evidence.boundedOffersEnabled || !evidence.growthActionsEnabled) return [];

  const eligible = evidence.products.filter(
    (p) => p.agentVisible && p.promotionEligible && p.unitsSold > 0 && p.entryPriceMinor !== null,
  );
  if (eligible.length === 0) return [];

  const addressableMinor = eligible.reduce((sum, p) => sum + (p.entryPriceMinor ?? 0), 0);
  const hasMeasuredLift = evidence.observedOfferLiftBps !== null && evidence.observedOfferLiftBps > 0;
  const effort: OpportunityEffort = "ONE_APPROVAL";
  const policy: OpportunityPolicyResult = { outcome: "REQUIRES_APPROVAL", reasons: ["OFFER_AFFECTS_PRICE"] };

  return [
    {
      id: "eligible-offers",
      type: "ELIGIBLE_OFFER",
      title: "Promotable products with no offer running",
      whyDetected: `${eligible.length} selling product${eligible.length === 1 ? " is" : "s are"} marked promotion-eligible by you, and no bounded offer is currently attached to ${eligible.length === 1 ? "it" : "them"}. The permission exists; the offer does not.`,
      proposedAction: "PROPOSE_BOUNDED_OFFER",
      actionLabel: "Let the agent propose a bounded offer inside your discount ceiling",
      expectedEffect: {
        atRiskValue: null,
        addressableValue: money(addressableMinor, evidence.currency, "OPPORTUNITY"),
        // LEARN. Until a campaign with a real holdout has run, this stays
        // null and the basis says why. Once one has, the estimate is this
        // merchant's OWN measured lift applied to their own ceiling — not
        // an industry rate, and not a guess that quietly became a number.
        expectedIncrementalValue: hasMeasuredLift
          ? money(applyRateBps(addressableMinor, evidence.observedOfferLiftBps!), evidence.currency, "ESTIMATED")
          : null,
        basis: hasMeasuredLift ? "OBSERVED_HISTORY" : "INSUFFICIENT_EVIDENCE",
        method: hasMeasuredLift
          ? `Your own campaigns converted ${formatBps(evidence.observedOfferLiftBps!)} better with an offer than the group held back from it. That measured lift is applied to the ceiling below. It is the only figure in this engine derived from a controlled comparison rather than an observation.`
          : "The ceiling is one entry-priced unit of each eligible product. No incremental estimate is offered: no campaign with a control group has run yet, so there is no measured lift to apply and an assumed one would be an invention.",
        sampleSize: hasMeasuredLift ? 1 : 0,
      },
      evidence: [
        { label: "Promotion-eligible products that sell", value: String(eligible.length), source: "Product.promotionEligibility = ELIGIBLE, with units sold in PAID orders" },
        { label: "Bounded offers enabled", value: "yes", source: "MerchantGrowthConfig.boundedOffersEnabled" },
      ],
      risk:
        "A discount on something already selling gives away margin you did not need to. Every offer stays inside your configured ceiling and floor margin, and needs your approval first.",
      policy,
      effort,
      score: computeScore({
        value: valueComponent(addressableMinor, evidence.averageOrderValueMinor),
        // A measured holdout is stronger evidence than a structural
        // signal, so a merchant who has actually run a campaign sees
        // their offer opportunities rank higher than one who has not.
        confidence: hasMeasuredLift ? INTENT_STRENGTH.DEMONSTRATED_CADENCE : INTENT_STRENGTH.WEAK_SIGNAL,
        urgency: 15,
        customerImpact: 0,
        effort,
        policy: policy.outcome,
      }),
      subjectIds: eligible.slice(0, 50).map((p) => p.productId),
      customersAffected: 0,
    },
  ];
}

/**
 * Deterministic status, derived from proposals the agent has already made.
 *
 * Applied to every opportunity uniformly rather than inside each detector,
 * so a new detector cannot forget to do it and quietly report finished
 * work as new.
 */
function withStatus(opportunity: RevenueOpportunity, actedOn: ReadonlySet<string>): RevenueOpportunity {
  if (opportunity.subjectIds.length === 0 || actedOn.size === 0) return opportunity;

  const done = opportunity.subjectIds.filter((id) => actedOn.has(id)).length;
  if (done === 0) return opportunity;

  const all = done === opportunity.subjectIds.length;
  return {
    ...opportunity,
    status: all ? "ACTIONED" : "PARTIALLY_ACTIONED",
    result: all
      ? `The agent has proposed an action on all ${done} of these.`
      : `The agent has proposed an action on ${done} of ${opportunity.subjectIds.length}; the rest are still open.`,
  };
}

export function detectRevenueOpportunities(evidence: MerchantRevenueEvidence): RevenueOpportunity[] {
  const actedOn = new Set(evidence.actedOnSubjectIds);
  const detected = [
    // Before recovery on purpose: a payment whose outcome nobody has
    // established must be verified before anything is decided about the
    // same money.
    ...detectUnverifiedPayments(evidence),
    ...detectFailedPaymentRecovery(evidence),
    ...detectAbandonedCheckoutRecovery(evidence),
    ...detectRepeatPurchase(evidence),
    ...detectReactivation(evidence),
    ...detectCrossSellGaps(evidence),
    ...detectUpsell(evidence),
    ...detectEligibleOffers(evidence),
    ...detectUnderperformingProducts(evidence),
    ...detectProductDiscovery(evidence),
    ...detectAiBuyerReadinessGaps(evidence),
  ].map((draft) => withStatus(finalise(draft), actedOn));

  return detected.sort((a, b) => {
    const aBlocked = a.policy.outcome === "BLOCKED" ? 1 : 0;
    const bBlocked = b.policy.outcome === "BLOCKED" ? 1 : 0;
    if (aBlocked !== bBlocked) return aBlocked - bBlocked;
    if (b.score.priority !== a.score.priority) return b.score.priority - a.score.priority;
    return TYPE_TIE_BREAK[a.type] - TYPE_TIE_BREAK[b.type];
  });
}

/**
 * Portfolio totals. Kept separate from the cards so the three
 * classifications can never be accidentally added together — summing an
 * OBSERVED at-risk amount with an OPPORTUNITY ceiling would produce
 * exactly the meaningless headline number this engine refuses to print.
 */
export interface RevenueOpportunityTotals {
  currency: CurrencyCode;
  opportunityCount: number;
  blockedCount: number;
  /** OBSERVED: real money currently uncaptured. */
  totalAtRiskMinor: number;
  /** OPPORTUNITY: ceiling across every card that has one. */
  totalAddressableMinor: number;
  /** ESTIMATED: only from cards with an observed rate behind them. */
  totalExpectedIncrementalMinor: number;
  /** How many cards had to withhold an estimate. Surfaced so the console
   * can say so out loud, rather than showing a quietly-low total. */
  withheldEstimateCount: number;
}

export function summariseRevenueOpportunities(
  opportunities: RevenueOpportunity[],
  currency: CurrencyCode,
): RevenueOpportunityTotals {
  let totalAtRiskMinor = 0;
  let totalAddressableMinor = 0;
  let totalExpectedIncrementalMinor = 0;
  let withheldEstimateCount = 0;
  let blockedCount = 0;

  for (const o of opportunities) {
    if (o.policy.outcome === "BLOCKED") blockedCount += 1;
    if (o.expectedEffect.atRiskValue) totalAtRiskMinor += o.expectedEffect.atRiskValue.amountMinor;
    if (o.expectedEffect.addressableValue) totalAddressableMinor += o.expectedEffect.addressableValue.amountMinor;
    if (o.expectedEffect.expectedIncrementalValue) {
      totalExpectedIncrementalMinor += o.expectedEffect.expectedIncrementalValue.amountMinor;
    } else {
      withheldEstimateCount += 1;
    }
  }

  return {
    currency,
    opportunityCount: opportunities.length,
    blockedCount,
    totalAtRiskMinor,
    totalAddressableMinor,
    totalExpectedIncrementalMinor,
    withheldEstimateCount,
  };
}
