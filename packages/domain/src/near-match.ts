/**
 * Deterministic near-match rules (PART 03 §32-§34).
 *
 * Only a pure budget-ceiling violation may ever become a disclosed near
 * match. A required-attribute mismatch, an availability violation, or any
 * exclusion hit disqualifies a candidate from near-match entirely — the
 * contract is explicit that visibility, exclusions, and availability
 * claims must never be silently relaxed (§33).
 */
import type { ConstraintViolation } from "./buyer-eligibility.js";

export function isNearMatchEligible(violations: ConstraintViolation[]): boolean {
  return violations.length > 0 && violations.every((v) => v.type === "BUDGET_MAX");
}
