/**
 * Policy module boundary (PART 00 §9-§11; PART 01 §5, §11).
 *
 * The full deterministic Policy Engine (`evaluate(proposal) -> ALLOW |
 * DENY | REQUIRE_APPROVAL`) is implemented in a later part, once there is
 * an actual AI-generated proposal to evaluate. PART 01 establishes only
 * the data this future engine will read — `MerchantPolicy` (see
 * `prisma/schema.prisma` and `modules/merchant/service.ts`
 * `getMerchantPolicyView`) — and the shared `PolicyDecision` vocabulary
 * used by the Agent Action Ledger (`modules/audit`) so both stay in sync
 * ahead of time.
 */
export type { PolicyDecision } from "@prisma/client";
