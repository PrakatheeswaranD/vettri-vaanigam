/**
 * Deterministic Policy Engine vocabulary (PART 05 §6-§13, §22-§26).
 *
 * `evaluatePolicy` (see `policy-engine.ts`) is a pure function over these
 * types — no AI provider, no prompt, no database client. Every reason code
 * here is a closed, deterministic vocabulary a human (or the Policy Engine
 * itself) chose; the LLM never invents one and never authors an outcome.
 */

export const POLICY_OUTCOMES = ["ALLOW", "DENY", "REQUIRE_APPROVAL"] as const;
export type PolicyOutcome = (typeof POLICY_OUTCOMES)[number];

/**
 * Closed reason-code taxonomy for a `PolicyDecisionResult` (PART 05 §8).
 * `POLICY_VERSION_STALE` and `APPROVAL_REQUIRED` are deliberately NOT here —
 * those describe conditions checked at execution-authorization time, after
 * a decision already exists (see `AUTHORIZATION_DENIAL_REASON_CODES`),
 * never a reason the initial policy evaluation itself produces.
 */
export const POLICY_REASON_CODES = [
  "WITHIN_AUTONOMOUS_LIMIT",
  "DISCOUNT_REQUIRES_APPROVAL",
  "DISCOUNT_LIMIT_EXCEEDED",
  "ORDER_AMOUNT_REQUIRES_APPROVAL",
  "ORDER_AMOUNT_LIMIT_EXCEEDED",
  "ACTION_TYPE_DISABLED",
  "CURRENCY_MISMATCH",
  "PROPOSAL_EXPIRED",
  "PROPOSAL_INVALID",
  "PRODUCT_NOT_ELIGIBLE",
  "PRODUCT_NOT_AVAILABLE",
  "POLICY_CONFIGURATION_INVALID",
  "RECOVERY_LIMIT_EXCEEDED",

  // ── PART 08 — the boundaries that had no reason code ──────────────
  /** The discount would sell below the merchant's margin floor. DENY, not
   * REQUIRE_APPROVAL: a floor is set precisely so nobody has to decide
   * case by case. */
  "MARGIN_FLOOR_BREACHED",
  /** The agent has already taken its permitted number of unattended
   * actions today. */
  "DAILY_ACTION_LIMIT_REACHED",
  /** The merchant has switched automated payment recovery off entirely. */
  "RECOVERY_NOT_PERMITTED",
  /** This action type is on the merchant's prohibited list. */
  "ACTION_TYPE_PROHIBITED",
  /** The product's category is outside the merchant's eligible set. */
  "CATEGORY_NOT_ELIGIBLE",
  /** The customer has fewer paid orders than the merchant requires before
   * the agent may target them. */
  "CUSTOMER_NOT_ELIGIBLE",
] as const;
export type PolicyReasonCode = (typeof POLICY_REASON_CODES)[number];

/**
 * Reasons execution authorization can be refused AFTER a policy decision
 * already exists (PART 05 §40-§48) — a materially different moment than
 * the original policy evaluation, so it gets its own closed vocabulary
 * rather than overloading `PolicyReasonCode`.
 */
export const AUTHORIZATION_DENIAL_REASON_CODES = [
  "POLICY_DENIED",
  "APPROVAL_REQUIRED",
  "APPROVAL_MISSING_OR_REJECTED",
  "APPROVAL_EXPIRED",
  "POLICY_VERSION_STALE",
  "PROPOSAL_CHANGED",
  "PRODUCT_NOT_ELIGIBLE",
  "PRODUCT_NOT_AVAILABLE",
  "CURRENCY_MISMATCH",
] as const;
export type AuthorizationDenialReasonCode = (typeof AUTHORIZATION_DENIAL_REASON_CODES)[number];

export interface MerchantPolicyConfig {
  policyVersion: number;
  currency: string;
  maxDiscountBps: number;
  autoApprovalDiscountBps: number;
  maxOrderAmountMinor: number;
  autoApprovalOrderAmountMinor: number;
  maxRecoveryAttempts: number;
  proposalValidityMinutes: number;

  // ── PART 08 boundaries ────────────────────────────────────────────
  /** Minimum gross margin, in bps, a discounted line must leave. */
  minMarginBps: number;
  /** Ceiling on unattended actions per UTC day. */
  maxAutonomousActionsPerDay: number;
  /** Whether automated payment recovery is permitted at all. */
  recoveryEnabled: boolean;
  /** Action types the agent may never take. */
  prohibitedActions: readonly string[];
  /** Categories the agent may act on. EMPTY MEANS ALL. */
  eligibleCategories: readonly string[];
  /** Paid orders a customer needs before the agent may target them. */
  minCustomerPaidOrders: number;
}

export interface PolicyEvaluationProposalFacts {
  createdAt: Date;
  currency: string;
  actionType: string;
  /** Resolved by the caller from `MerchantGrowthConfig` at evaluation time
   * — the Policy Engine never re-derives merchant configuration itself. */
  actionTypeEnabled: boolean;
  /** Discount expressed uniformly in basis points regardless of whether the
   * underlying offer was `PERCENTAGE` or `FIXED_AMOUNT` (the caller
   * converts a fixed amount to an implied bps-of-base figure first, the
   * same convention `validateGrowthProposal` already uses) — `null` when
   * the proposal carries no offer at all. */
  discountBps: number | null;
  discountMinor: number | null;
  /** The order/basket amount this action would affect, if known and
   * relevant to this action type; `null` when not applicable. */
  orderAmountMinor: number | null;
  /** Authoritative, revalidated-at-evaluation-time commerce facts — never
   * a value the AI proposal itself carried (PART 05 §14). */
  productEligible: boolean;
  productAvailable: boolean;
  /** Only meaningful for `RECOVERY` proposals. */
  recoveryAttemptCount: number;

  // ── PART 08 facts, all revalidated by the caller at evaluation time ──
  /**
   * Gross margin this action would leave, in basis points, or `null` when
   * cost is not known for the product.
   *
   * Null is not "fine" and not "zero" — it means the merchant has not
   * recorded a cost, so no margin claim is possible. The engine treats an
   * unknowable margin as a DENY when a floor is configured, because
   * "discount something whose cost I do not know" is exactly what a floor
   * exists to prevent.
   */
  marginBps: number | null;
  /** The product's category, for the eligible-category boundary. */
  productCategory: string | null;
  /**
   * Paid orders the target customer already has, or `null` when the action
   * targets no specific customer (a catalogue-wide cross-sell). A null
   * skips the customer boundary rather than failing it — the boundary is
   * about WHO is targeted, and nobody is.
   */
  customerPaidOrderCount: number | null;
  /**
   * Unattended actions already authorized for this merchant today (UTC).
   *
   * Counted from authorizations ISSUED, not proposals raised: a proposal
   * policy denied consumed none of the merchant's autonomy budget.
   */
  autonomousActionsToday: number;
  /**
   * Whether THIS evaluation is for an unattended run. A merchant sitting
   * in the console pressing "run a cycle" is present and supervising, so
   * the daily unattended ceiling does not apply to them.
   */
  unattended: boolean;
}

export interface PolicyEvaluationInput {
  now: Date;
  policy: MerchantPolicyConfig;
  proposal: PolicyEvaluationProposalFacts;
}

export interface PolicyEvaluatedValues {
  requestedDiscountBps: number | null;
  requestedDiscountMinor: number | null;
  orderAmountMinor: number | null;
  currency: string;
}

export interface PolicyDecisionResult {
  outcome: PolicyOutcome;
  reasonCodes: PolicyReasonCode[];
  explanation: string;
  evaluatedValues: PolicyEvaluatedValues;
}
