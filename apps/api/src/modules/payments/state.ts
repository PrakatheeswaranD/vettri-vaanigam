/**
 * Re-export of the deterministic payment state machine (PART 00 §12).
 * The payments module is the application-layer home for this concept;
 * the actual transition logic lives in `@razorgrowth/domain` so it has no
 * dependency on Fastify, Prisma, or any provider SDK.
 */
export { PAYMENT_STATES, canTransitionPaymentState, transitionPaymentState, isTerminalPaymentState, PaymentStateError } from "@razorgrowth/domain";
export type { PaymentState } from "@razorgrowth/domain";
