/**
 * The two headline scores.
 *
 * WHY A SCORE AT ALL
 *
 * A merchant cannot act on eleven separate metrics. They can act on "your
 * revenue engine is at 61/100, and the reason it is not higher is that
 * you have never recovered a failed payment". A score is only worth
 * printing if every point in it is traceable, so both scores here are
 * built the same way: a fixed list of components, each with a stated
 * maximum, each earned from a fact rather than an opinion, and each
 * carrying its own evidence string.
 *
 * WHAT MAKES THESE DIFFERENT FROM A VANITY METRIC
 *
 *  1. No component is earned by having the feature built. `AI Buyer
 *     Capability` scores a capability only when the DATA shows it has
 *     actually run — a recommendation record exists, a policy evaluation
 *     denied something, a payment reached CAPTURED. Shipping code that
 *     could theoretically do a thing earns nothing.
 *
 *  2. Nothing is normalised against an invented industry benchmark. Every
 *     denominator is the merchant's own catalogue, orders or customers.
 *
 *  3. A component that cannot be assessed scores zero AND says so. It is
 *     never quietly dropped from the denominator to flatter the total,
 *     which is the standard way scores like this become dishonest.
 */

export interface ScoreComponent {
  key: string;
  label: string;
  /** Points earned, 0..max. */
  earned: number;
  max: number;
  /** The fact behind the number. Rendered next to it. */
  evidence: string;
  /** What the merchant would do to earn the remaining points. Null when
   * the component is already full. */
  toImprove: string | null;
}

export interface CompositeScore {
  /** 0..100. Always `sum(earned)` over `sum(max)` normalised, so a reader
   * can add the components up and get the same answer. */
  score: number;
  components: ScoreComponent[];
}

/**
 * A component that is not full MUST carry an improvement path. Deriving
 * that invariant here rather than trusting each call site is what stops a
 * zero-denominator component (no customers yet, no products yet) from
 * rendering as "0 / 15" with no way forward — which is exactly what a
 * merchant cannot act on.
 */
function component(spec: Omit<ScoreComponent, "toImprove"> & { toImprove: string }): ScoreComponent {
  return { ...spec, toImprove: spec.earned < spec.max ? spec.toImprove : null };
}

function compose(components: ScoreComponent[]): CompositeScore {
  const earned = components.reduce((sum, c) => sum + c.earned, 0);
  const max = components.reduce((sum, c) => sum + c.max, 0);
  return { score: max <= 0 ? 0 : Math.round((earned * 100) / max), components };
}

/** Proportional points, floored so a component never rounds above what
 * the ratio earned. */
function proportional(numerator: number, denominator: number, max: number): number {
  if (denominator <= 0) return 0;
  return Math.max(0, Math.min(max, Math.floor((numerator * max) / denominator)));
}

/* -------------------------------------------------------------------------
 * Revenue Growth Score
 * ---------------------------------------------------------------------- */

export interface RevenueGrowthScoreInput {
  /** Orders that reached a payment attempt, and how many were captured.
   * The single most important thing a payments-adjacent product can move. */
  ordersWithPaymentAttempt: number;
  paidOrderCount: number;

  /** Failed payments, and how many were recovered on a later attempt. */
  failedPaymentCount: number;
  recoveredPaymentCount: number;

  /** Money currently sitting uncaptured in failed or stalled payments,
   * against captured revenue. Leakage, measured rather than asserted. */
  capturedRevenueMinor: number;
  uncapturedAtRiskMinor: number;

  /** Customers, and how many bought more than once. */
  customerCount: number;
  repeatCustomerCount: number;

  /** Agent-visible products, and how many are fully transactable (priced,
   * attributed, stocked). */
  agentVisibleProductCount: number;
  transactableProductCount: number;

  /** Products that have sold at least once, and how many of those can
   * carry a cross-sell. */
  sellingProductCount: number;
  sellingProductsWithRelationshipCount: number;

  /** Growth actions that completed governance and executed. Proves the
   * loop closes, not just that it starts. */
  proposalsExecuted: number;
  proposalsCreated: number;
}

export function calculateRevenueGrowthScore(input: RevenueGrowthScoreInput): CompositeScore {
  const components: ScoreComponent[] = [];

  // 25 — Checkout completion. The largest single component because it is
  // the largest single lever on merchant revenue.
  components.push(component({
    key: "checkout_completion",
    label: "Checkout completion",
    earned: proportional(input.paidOrderCount, input.ordersWithPaymentAttempt, 25),
    max: 25,
    evidence:
      input.ordersWithPaymentAttempt > 0
        ? `${input.paidOrderCount} of ${input.ordersWithPaymentAttempt} orders that reached a payment attempt were captured.`
        : "No order has reached a payment attempt yet, so completion cannot be measured.",
    toImprove: "Recover the stalled and failed checkouts listed in Growth Opportunities, so more orders that start a payment finish one.",
  }));

  // 20 — Failure recovery. Scored on recoveries actually achieved. A
  // merchant with zero failures cannot demonstrate recovery, so this is
  // stated as unproven rather than silently awarded.
  const recoveryEarned = input.failedPaymentCount > 0 ? proportional(input.recoveredPaymentCount, input.failedPaymentCount, 20) : 0;
  components.push(component({
    key: "failure_recovery",
    label: "Failed-payment recovery",
    earned: recoveryEarned,
    max: 20,
    evidence:
      input.failedPaymentCount > 0
        ? `${input.recoveredPaymentCount} of ${input.failedPaymentCount} failed payments were later captured on a retry.`
        : "No payment has failed yet, so recovery is unproven. These points are not awarded for the absence of a problem.",
    toImprove: "Run a bounded recovery on the retryable failed payments in Growth Opportunities.",
  }));

  // 15 — Revenue leakage. Captured money as a share of captured plus
  // still-at-risk.
  const revenueBase = input.capturedRevenueMinor + input.uncapturedAtRiskMinor;
  components.push(component({
    key: "revenue_retention",
    label: "Revenue retained vs at risk",
    earned: proportional(input.capturedRevenueMinor, revenueBase, 15),
    max: 15,
    evidence:
      revenueBase > 0
        ? `${input.capturedRevenueMinor} minor units captured against ${input.uncapturedAtRiskMinor} still uncaptured in failed or stalled payments.`
        : "No revenue and no at-risk amount recorded yet.",
    toImprove: "Close the at-risk amount by recovering failed and abandoned checkouts.",
  }));

  // 15 — Repeat purchase. The cheapest revenue a merchant can earn.
  components.push(component({
    key: "repeat_purchase",
    label: "Repeat customers",
    earned: proportional(input.repeatCustomerCount, input.customerCount, 15),
    max: 15,
    evidence:
      input.customerCount > 0
        ? `${input.repeatCustomerCount} of ${input.customerCount} customers have bought more than once.`
        : "No customers recorded yet.",
    toImprove: "Act on the overdue repeat-purchase cohort in Growth Opportunities.",
  }));

  // 15 — Transactable catalogue. A product an agent cannot commit to is
  // not revenue-capable, however good it looks in a listing.
  components.push(component({
    key: "transactable_catalogue",
    label: "Catalogue an agent can transact on",
    earned: proportional(input.transactableProductCount, input.agentVisibleProductCount, 15),
    max: 15,
    evidence:
      input.agentVisibleProductCount > 0
        ? `${input.transactableProductCount} of ${input.agentVisibleProductCount} agent-visible products are priced, attributed and stocked.`
        : "No agent-visible products.",
    toImprove: "Fill the missing price, attribute and stock facts on the products listed in AI Readiness.",
  }));

  // 5 — Cross-sell reach on products that actually sell.
  components.push(component({
    key: "cross_sell_reach",
    label: "Cross-sell reach on sellers",
    earned: proportional(input.sellingProductsWithRelationshipCount, input.sellingProductCount, 5),
    max: 5,
    evidence:
      input.sellingProductCount > 0
        ? `${input.sellingProductsWithRelationshipCount} of ${input.sellingProductCount} products that have sold carry at least one relationship.`
        : "No product has sold yet.",
    toImprove: "Link a complementary product to each item that already sells.",
  }));

  // 5 — Does the loop actually close? Proposals created but never
  // executed prove the pipeline, not the outcome.
  components.push(component({
    key: "action_completion",
    label: "Growth actions that completed",
    earned: proportional(input.proposalsExecuted, input.proposalsCreated, 5),
    max: 5,
    evidence:
      input.proposalsCreated > 0
        ? `${input.proposalsExecuted} of ${input.proposalsCreated} agent growth proposals reached execution.`
        : "No growth proposal has been created yet.",
    toImprove: "Take a growth proposal all the way through approval to execution.",
  }));

  return compose(components);
}

/* -------------------------------------------------------------------------
 * AI Buyer Capability Score
 * ---------------------------------------------------------------------- */

/**
 * Every field here is "has this actually happened in the data", never
 * "is this feature implemented". The distinction is the whole point: a
 * capability score that counts source files is marketing.
 */
export interface AiBuyerCapabilityScoreInput {
  /** A buyer agent held a conversation whose intent was extracted into
   * structured constraints. */
  conversationsWithExtractedIntent: number;
  conversationCount: number;

  /** Recommendations produced that were grounded in real catalogue rows. */
  groundedRecommendationCount: number;

  /** Distinct products an agent could actually be recommended and commit
   * to, against the agent-visible catalogue. */
  transactableProductCount: number;
  agentVisibleProductCount: number;

  /** A gateway decision was made on an inbound agent request — proof the
   * policy gate is on the path, not beside it. */
  gatewayDecisionCount: number;
  /** Of those, how many were refusals. A gate that has never refused
   * anything is unproven as a gate. */
  gatewayDenialCount: number;

  /** An agent-originated order reached a provider-verified capture. */
  agentAttributedCaptures: number;
  /** Agent-originated orders that reached a payment attempt. */
  agentAttributedPaymentAttempts: number;

  /** A spend mandate or delegated payment token was verified. */
  verifiedMandateCount: number;
}

export function calculateAiBuyerCapabilityScore(input: AiBuyerCapabilityScoreInput): CompositeScore {
  const components: ScoreComponent[] = [];

  // 15 — Intent understanding.
  components.push(component({
    key: "intent_extraction",
    label: "Buyer intent understood",
    earned: proportional(input.conversationsWithExtractedIntent, input.conversationCount, 15),
    max: 15,
    evidence:
      input.conversationCount > 0
        ? `${input.conversationsWithExtractedIntent} of ${input.conversationCount} buyer conversations produced structured intent.`
        : "No buyer conversation has run yet.",
    toImprove: "Run a buyer-agent conversation through to a structured intent.",
  }));

  // 20 — Discovery and grounded recommendation. Capped at ten grounded
  // recommendations: beyond that the capability is demonstrated and more
  // volume proves nothing further.
  const RECOMMENDATION_PROOF_TARGET = 10;
  components.push(component({
    key: "grounded_recommendation",
    label: "Grounded product recommendation",
    earned: proportional(Math.min(input.groundedRecommendationCount, RECOMMENDATION_PROOF_TARGET), RECOMMENDATION_PROOF_TARGET, 20),
    max: 20,
    evidence: `${input.groundedRecommendationCount} recommendation${input.groundedRecommendationCount === 1 ? "" : "s"} recorded, each tied to real catalogue rows (target for full marks: ${RECOMMENDATION_PROOF_TARGET}).`,
    toImprove: "Ask the buyer agent for recommendations against the live catalogue.",
  }));

  // 20 — Can an agent actually complete a purchase on what it finds?
  components.push(component({
    key: "transactable_catalogue",
    label: "Catalogue an agent can commit to",
    earned: proportional(input.transactableProductCount, input.agentVisibleProductCount, 20),
    max: 20,
    evidence:
      input.agentVisibleProductCount > 0
        ? `${input.transactableProductCount} of ${input.agentVisibleProductCount} agent-visible products carry a price, attributes and stock.`
        : "No agent-visible products.",
    toImprove: "Complete the missing price, attribute and stock facts in AI Readiness.",
  }));

  // 20 — The gate is real. Split deliberately: 10 for being on the path
  // at all, 10 for having actually refused something.
  const gateOnPath = input.gatewayDecisionCount > 0 ? 10 : 0;
  const gateRefuses = input.gatewayDenialCount > 0 ? 10 : 0;
  components.push(component({
    key: "policy_gate_proven",
    label: "Policy gate proven on the path",
    earned: gateOnPath + gateRefuses,
    max: 20,
    evidence: `${input.gatewayDecisionCount} gateway decision${input.gatewayDecisionCount === 1 ? "" : "s"} recorded, of which ${input.gatewayDenialCount} refused the request. A gate that has never refused anything is unproven.`,
    toImprove: "Run an out-of-policy agent request (the adversarial sandbox does this) so a refusal is on record.",
  }));

  // 15 — Money actually moved, verified by the provider.
  components.push(component({
    key: "verified_capture",
    label: "Agent purchase captured and verified",
    earned: proportional(input.agentAttributedCaptures, Math.max(1, input.agentAttributedPaymentAttempts), 15),
    max: 15,
    evidence:
      input.agentAttributedPaymentAttempts > 0
        ? `${input.agentAttributedCaptures} of ${input.agentAttributedPaymentAttempts} agent-originated payment attempts reached a provider-verified capture.`
        : "No agent-originated payment attempt yet.",
    toImprove: "Complete one buyer-agent checkout end to end, through to a provider-verified capture.",
  }));

  // 10 — Delegated authority was verified rather than trusted.
  components.push(component({
    key: "mandate_verification",
    label: "Spend mandate verified",
    earned: input.verifiedMandateCount > 0 ? 10 : 0,
    max: 10,
    evidence: `${input.verifiedMandateCount} spend mandate${input.verifiedMandateCount === 1 ? "" : "s"} cryptographically verified before authorising spend.`,
    toImprove: "Run an agent purchase that presents a signed spend mandate.",
  }));

  return compose(components);
}
