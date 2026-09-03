/**
 * Deterministic Policy Engine core (PART 05 §6, §9-§13, §19-§22, §90-§91).
 *
 * `evaluatePolicy` is the ONLY place a `PolicyOutcome` is decided. It is a
 * pure function: no database access, no AI provider, no network call — the
 * same input always produces the same output, which is what makes it
 * independently testable and auditable. Data loading (current merchant
 * policy, revalidated commerce facts) is the caller's job (PART 05 §20);
 * this module only judges what has already been assembled.
 *
 * Rule precedence is fixed and total (PART 05 §9): an invalid/unsafe
 * condition always DENIES regardless of amount, then a hard-limit breach
 * DENIES, then an approval-threshold breach REQUIRES_APPROVAL, and only
 * when none of those fire does the proposal ALLOW. A lower-severity rule
 * can never override a higher one, and this file is the single place that
 * ordering is encoded.
 */
import type {
  PolicyDecisionResult,
  PolicyEvaluationInput,
  PolicyReasonCode,
} from "./policy-types.js";

function minutesBetween(earlier: Date, later: Date): number {
  return (later.getTime() - earlier.getTime()) / (1000 * 60);
}

function formatBps(bps: number): string {
  return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;
}

function isPolicyConfigurationValid(policy: PolicyEvaluationInput["policy"]): boolean {
  if (policy.autoApprovalDiscountBps > policy.maxDiscountBps) return false;
  if (policy.autoApprovalOrderAmountMinor > policy.maxOrderAmountMinor) return false;
  if (policy.maxDiscountBps < 0 || policy.autoApprovalDiscountBps < 0) return false;
  if (policy.maxOrderAmountMinor < 0 || policy.autoApprovalOrderAmountMinor < 0) return false;
  if (policy.maxRecoveryAttempts < 0) return false;
  if (policy.proposalValidityMinutes <= 0) return false;
  if (policy.minMarginBps < 0 || policy.minMarginBps > 10_000) return false;
  if (policy.maxAutonomousActionsPerDay < 0) return false;
  if (policy.minCustomerPaidOrders < 0) return false;
  return true;
}

export function evaluatePolicy(input: PolicyEvaluationInput): PolicyDecisionResult {
  const { policy, proposal, now } = input;
  const evaluatedValues = {
    requestedDiscountBps: proposal.discountBps,
    requestedDiscountMinor: proposal.discountMinor,
    orderAmountMinor: proposal.orderAmountMinor,
    currency: proposal.currency,
  };

  // Tier 1 — invalid/unsafe: any of these DENY outright, independent of
  // amount, and independent of each other (all applicable reasons are
  // reported together so the explanation is complete, not just the first
  // one found).
  const invalidReasons: PolicyReasonCode[] = [];
  if (!isPolicyConfigurationValid(policy)) invalidReasons.push("POLICY_CONFIGURATION_INVALID");
  if (proposal.currency !== policy.currency) invalidReasons.push("CURRENCY_MISMATCH");
  if (minutesBetween(proposal.createdAt, now) > policy.proposalValidityMinutes) invalidReasons.push("PROPOSAL_EXPIRED");
  if (!proposal.actionTypeEnabled) invalidReasons.push("ACTION_TYPE_DISABLED");
  if (!proposal.productEligible) invalidReasons.push("PRODUCT_NOT_ELIGIBLE");
  if (!proposal.productAvailable) invalidReasons.push("PRODUCT_NOT_AVAILABLE");
  if (proposal.actionType === "RECOVERY" && proposal.recoveryAttemptCount >= policy.maxRecoveryAttempts) {
    invalidReasons.push("RECOVERY_LIMIT_EXCEEDED");
  }

  // ── PART 08 — prohibitions and eligibility ────────────────────────
  //
  // All Tier 1, all DENY. Every one of these is a merchant saying "not
  // this, ever" rather than "not this without asking me" — routing any of
  // them to REQUIRE_APPROVAL would turn a prohibition into a prompt.

  if (policy.prohibitedActions.includes(proposal.actionType)) {
    invalidReasons.push("ACTION_TYPE_PROHIBITED");
  }
  if (proposal.actionType === "RECOVERY" && !policy.recoveryEnabled) {
    invalidReasons.push("RECOVERY_NOT_PERMITTED");
  }
  // Empty means every category is permitted. A merchant who has named
  // categories has excluded the rest by saying so.
  if (
    policy.eligibleCategories.length > 0 &&
    (proposal.productCategory === null || !policy.eligibleCategories.includes(proposal.productCategory))
  ) {
    invalidReasons.push("CATEGORY_NOT_ELIGIBLE");
  }
  // Skipped, not failed, when the action targets nobody in particular.
  if (
    policy.minCustomerPaidOrders > 0 &&
    proposal.customerPaidOrderCount !== null &&
    proposal.customerPaidOrderCount < policy.minCustomerPaidOrders
  ) {
    invalidReasons.push("CUSTOMER_NOT_ELIGIBLE");
  }
  // Only for unattended runs. A merchant pressing the button is present
  // and supervising; the ceiling exists for the case where nobody is.
  if (proposal.unattended && proposal.autonomousActionsToday >= policy.maxAutonomousActionsPerDay) {
    invalidReasons.push("DAILY_ACTION_LIMIT_REACHED");
  }

  if (invalidReasons.length > 0) {
    return {
      outcome: "DENY",
      reasonCodes: invalidReasons,
      explanation: `Denied: ${invalidReasons.join(", ")}.`,
      evaluatedValues,
    };
  }

  // Tier 2 — hard limit exceeded. Exactly AT the hard limit is NOT a
  // breach (PART 05 §90 boundary case) — it is the highest value policy
  // still permits, gated by human approval rather than denied outright.
  const hardLimitReasons: PolicyReasonCode[] = [];
  if (proposal.discountBps !== null && proposal.discountBps > policy.maxDiscountBps) {
    hardLimitReasons.push("DISCOUNT_LIMIT_EXCEEDED");
  }
  if (proposal.orderAmountMinor !== null && proposal.orderAmountMinor > policy.maxOrderAmountMinor) {
    hardLimitReasons.push("ORDER_AMOUNT_LIMIT_EXCEEDED");
  }
  /**
   * The margin floor, checked only when a discount is actually requested.
   *
   * An action with no offer cannot breach a margin floor, so a proposal
   * carrying no discount is never tested — otherwise every cross-sell of
   * a thin-margin product would be denied for a discount it never asked
   * for.
   *
   * A NULL margin with a floor configured is a breach. The merchant has
   * asked not to sell below a margin they cannot compute here, and
   * proceeding would mean discounting a product whose cost is unknown.
   * Refusing is the conservative reading and the one a floor implies.
   */
  if (proposal.discountBps !== null && proposal.discountBps > 0 && policy.minMarginBps > 0) {
    if (proposal.marginBps === null || proposal.marginBps < policy.minMarginBps) {
      hardLimitReasons.push("MARGIN_FLOOR_BREACHED");
    }
  }

  if (hardLimitReasons.length > 0) {
    const parts: string[] = [];
    if (hardLimitReasons.includes("DISCOUNT_LIMIT_EXCEEDED")) {
      parts.push(
        `requested discount ${formatBps(proposal.discountBps!)} exceeds the maximum permitted discount of ${formatBps(policy.maxDiscountBps)}`,
      );
    }
    if (hardLimitReasons.includes("ORDER_AMOUNT_LIMIT_EXCEEDED")) {
      parts.push(
        `requested order amount ${proposal.orderAmountMinor} exceeds the maximum permitted order amount of ${policy.maxOrderAmountMinor} (minor units)`,
      );
    }
    if (hardLimitReasons.includes("MARGIN_FLOOR_BREACHED")) {
      parts.push(
        proposal.marginBps === null
          ? `this product has no recorded cost, so the resulting margin cannot be computed, and the margin floor of ${formatBps(policy.minMarginBps)} cannot be shown to hold`
          : `the resulting margin of ${formatBps(proposal.marginBps)} is below the floor of ${formatBps(policy.minMarginBps)}`,
      );
    }
    return {
      outcome: "DENY",
      reasonCodes: hardLimitReasons,
      explanation: `Denied: ${parts.join("; ")}.`,
      evaluatedValues,
    };
  }

  // Tier 3 — within the hard limit but above the auto-approval threshold:
  // a human gate is required. Exactly AT the auto-approval threshold is
  // NOT a breach (PART 05 §90 boundary case) — it auto-allows.
  const approvalReasons: PolicyReasonCode[] = [];
  if (proposal.discountBps !== null && proposal.discountBps > policy.autoApprovalDiscountBps) {
    approvalReasons.push("DISCOUNT_REQUIRES_APPROVAL");
  }
  if (proposal.orderAmountMinor !== null && proposal.orderAmountMinor > policy.autoApprovalOrderAmountMinor) {
    approvalReasons.push("ORDER_AMOUNT_REQUIRES_APPROVAL");
  }

  if (approvalReasons.length > 0) {
    const parts: string[] = [];
    if (approvalReasons.includes("DISCOUNT_REQUIRES_APPROVAL")) {
      parts.push(
        `requested discount ${formatBps(proposal.discountBps!)} exceeds the automatic threshold of ${formatBps(policy.autoApprovalDiscountBps)} (maximum permitted: ${formatBps(policy.maxDiscountBps)})`,
      );
    }
    if (approvalReasons.includes("ORDER_AMOUNT_REQUIRES_APPROVAL")) {
      parts.push(
        `requested order amount ${proposal.orderAmountMinor} exceeds the automatic threshold of ${policy.autoApprovalOrderAmountMinor} (minor units)`,
      );
    }
    return {
      outcome: "REQUIRE_APPROVAL",
      reasonCodes: approvalReasons,
      explanation: `Requires merchant approval: ${parts.join("; ")}.`,
      evaluatedValues,
    };
  }

  // Tier 4 — within every autonomous bound.
  return {
    outcome: "ALLOW",
    reasonCodes: ["WITHIN_AUTONOMOUS_LIMIT"],
    explanation: "Allowed automatically: within the merchant's configured autonomous limits.",
    evaluatedValues,
  };
}
