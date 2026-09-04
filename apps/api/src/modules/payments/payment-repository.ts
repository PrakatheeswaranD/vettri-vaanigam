import type { Payment, PaymentEventProcessingStatus, PaymentProvider, PaymentState, Prisma, PrismaClient } from "@prisma/client";

export interface CreatePaymentInput {
  id: string;
  merchantId: string;
  orderId: string;
  checkoutId: string;
  provider: PaymentProvider;
  amountMinor: number;
  currency: string;
}

/** PART 08 §9, §189 — `attemptNumber`/`recoveredFromAttemptId` are always
 * derived from prior `Payment` rows sharing this `orderId`, never
 * client-supplied: an order's first-ever payment attempt gets `1` and no
 * lineage; a bounded recovery retry (a NEW `CheckoutSession` against the
 * SAME order, PART 08 §29) gets the next number and points back at the
 * immediately-prior attempt. This is the ONE place either value is ever
 * computed — `initiatePayment` never special-cases "is this a recovery." */
async function nextAttempt(tx: Prisma.TransactionClient, orderId: string): Promise<{ attemptNumber: number; recoveredFromAttemptId: string | null }> {
  const prior = await tx.payment.findFirst({ where: { orderId }, orderBy: { attemptNumber: "desc" } });
  if (!prior) return { attemptNumber: 1, recoveredFromAttemptId: null };
  return { attemptNumber: prior.attemptNumber + 1, recoveredFromAttemptId: prior.id };
}

export async function createPayment(tx: Prisma.TransactionClient, data: CreatePaymentInput) {
  const { attemptNumber, recoveredFromAttemptId } = await nextAttempt(tx, data.orderId);
  return tx.payment.create({
    data: {
      id: data.id,
      merchantId: data.merchantId,
      orderId: data.orderId,
      checkoutId: data.checkoutId,
      provider: data.provider,
      amountMinor: data.amountMinor,
      currency: data.currency as never,
      state: "CREATED",
      attemptNumber,
      recoveredFromAttemptId,
    },
  });
}

export function findPaymentById(prisma: PrismaClient, merchantId: string, id: string) {
  return prisma.payment.findFirst({ where: { id, merchantId } });
}

export function findPaymentByCheckoutId(prisma: PrismaClient, merchantId: string, checkoutId: string) {
  return prisma.payment.findFirst({ where: { checkoutId, merchantId } });
}

export function findPaymentByProviderOrderId(prismaLike: PrismaClient | Prisma.TransactionClient, provider: PaymentProvider, providerOrderId: string) {
  return prismaLike.payment.findFirst({ where: { provider, providerOrderId } });
}

/*
 * `setPaymentProviderOrderId` used to live here: an unconditional
 * `update({ where: { id } })` that stamped a provider order id onto a
 * payment. Nothing called it, and it was worse than merely dead.
 *
 * The live path in `payment-service.ts` deliberately uses a CONDITIONAL
 * claim — `updateMany({ where: { id, providerOrderId: null } })` — so that
 * two concurrent initiations cannot both record a provider order against
 * one payment. This helper was the plausible-looking way to do the same
 * thing without that guard, sitting in the repository where the next
 * person would reach for it.
 *
 * Deleted rather than kept "just in case": a duplicate that reintroduces a
 * race the codebase fixed on purpose is not a spare, it is a trap.
 */

export interface ApplyPaymentTransitionInput {
  state: PaymentState;
  customerDebitStatus?: "UNKNOWN" | "NOT_DEBITED" | "DEBITED";
  merchantCreditStatus?: "UNKNOWN" | "NOT_CREDITED" | "CREDITED";
  automaticRetryBlocked?: boolean;
  providerPaymentId?: string;
  failureCode?: string | null;
  failureCategory?: string | null;
  providerMetadata?: Prisma.InputJsonValue;
  authorizedAt?: Date;
  capturedAt?: Date;
  failedAt?: Date;
}

export function applyPaymentTransition(tx: Prisma.TransactionClient, id: string, data: ApplyPaymentTransitionInput) {
  return tx.payment.update({
    where: { id },
    data: {
      state: data.state,
      customerDebitStatus: data.customerDebitStatus,
      merchantCreditStatus: data.merchantCreditStatus,
      automaticRetryBlocked: data.automaticRetryBlocked,
      providerPaymentId: data.providerPaymentId,
      failureCode: data.failureCode,
      failureCategory: data.failureCategory,
      providerMetadata: data.providerMetadata,
      authorizedAt: data.authorizedAt,
      capturedAt: data.capturedAt,
      failedAt: data.failedAt,
    },
  });
}

/**
 * Records the provider's payment reference WITHOUT changing state.
 *
 * Recovering a stranded payment can discover the provider's payment id
 * while the state itself is unchanged (the provider still reports
 * `created`). The state machine treats a same-state event as an idempotent
 * no-op and returns before persisting anything, which would throw the
 * recovered reference away — leaving us unable to match the webhook that
 * eventually arrives for it. Learning the reference is not a financial
 * transition, so it is written separately rather than by loosening the
 * state machine.
 */
export function attachProviderPaymentId(tx: Prisma.TransactionClient, id: string, providerPaymentId: string) {
  return tx.payment.update({ where: { id }, data: { providerPaymentId } });
}

export function touchReconciledAt(prisma: PrismaClient, id: string) {
  return prisma.payment.update({ where: { id }, data: { lastReconciledAt: new Date() } });
}

export interface CreateProviderEventInput {
  id: string;
  /** Nullable (PART 10 §1) — unknown until the event's providerOrderId
   * resolves to a real Payment row; a genuinely unresolvable event has
   * no merchant to attribute it to. */
  merchantId: string | null;
  provider: PaymentProvider;
  providerEventId: string | null;
  eventType: string;
  paymentId: string | null;
  providerPaymentId: string | null;
  providerOrderId: string | null;
  eventFingerprint: string;
  payloadHash: string;
  signatureVerified: boolean;
  processingStatus: PaymentEventProcessingStatus;
}

export function findProviderEventByFingerprint(prismaLike: PrismaClient | Prisma.TransactionClient, provider: PaymentProvider, eventFingerprint: string) {
  return prismaLike.paymentProviderEvent.findFirst({ where: { provider, eventFingerprint } });
}

export function createProviderEvent(tx: Prisma.TransactionClient | PrismaClient, data: CreateProviderEventInput) {
  return tx.paymentProviderEvent.create({ data });
}

export function updateProviderEventStatus(prismaLike: PrismaClient | Prisma.TransactionClient, id: string, processingStatus: PaymentEventProcessingStatus) {
  return prismaLike.paymentProviderEvent.update({ where: { id }, data: { processingStatus, processedAt: new Date() } });
}

const PROVIDER_EVENT_UNIQUE_CONFLICT_CODE = "P2002";

export function isProviderEventDuplicateConflict(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: string }).code === PROVIDER_EVENT_UNIQUE_CONFLICT_CODE &&
    JSON.stringify((err as { meta?: unknown }).meta ?? {}).includes("eventFingerprint")
  );
}

export type { Payment };
