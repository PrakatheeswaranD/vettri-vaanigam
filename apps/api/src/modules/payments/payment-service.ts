/**
 * Payment initiation, client-completion verification, and reconciliation
 * orchestration (PART 07 §13, §36-§41, §111). `PaymentGateway` is the only
 * thing here that knows Razorpay exists; everything else is deterministic
 * application code with zero AI dependency (`grep -i anthropic` on this
 * file returns nothing).
 */
import { randomUUID } from "node:crypto";
import type { CheckoutSession, Order, OrderItem, Payment, PrismaClient } from "@prisma/client";
import type { PaymentClientVerificationRequestDTO, PaymentDTO, PaymentInitiationResponseDTO } from "@razorgrowth/contracts";
import { systemClock } from "@razorgrowth/domain";
import { AppError } from "../../http/errors.js";
import { logger } from "../../observability/logger.js";
import { appendLedgerEvent, withLedgerConcurrencyRetry } from "../audit/ledger.js";
import { findCheckoutById, updateCheckoutStatus } from "../commerce/checkout-repository.js";
import { setOrderStatus } from "../commerce/order-repository.js";
import { computeOrderFingerprint } from "../commerce/order-fingerprint.js";
import { getPaymentGateway } from "./gateway-factory.js";
import { ProviderGatewayError, type PaymentGateway, type PaymentGatewayPublicConfig, type ProviderPaymentInfo } from "./gateway.js";
import { normalizeRazorpayFailure } from "./failure-mapper.js";
import { applyPaymentTransition, attachProviderPaymentId, createPayment, findPaymentByCheckoutId, findPaymentById, touchReconciledAt } from "./payment-repository.js";
import { resolvePaymentEvent } from "./payment-transition.js";
import { toPaymentDTO } from "./mapper.js";

const RECONCILE_COOLDOWN_MS = 5000;

type CheckoutWithOrder = CheckoutSession & { order: Order & { items: OrderItem[] } };

/**
 * Tamper check on an order's financial identity.
 *
 * A missing `authorizationId` used to fail this outright. That conflated
 * provenance with integrity: an order placed directly by a buyer has no
 * agent authorization, is perfectly well-formed, and was being treated as
 * corrupt. The hash comparison is the actual check — it still catches any
 * change to the amount or the line items — and the empty string is the
 * canonical "no agent authorization" value the fingerprint was built with.
 */
function verifyOrderFingerprint(order: Order & { items: OrderItem[] }, expectedFingerprint: string): boolean {
  const recomputed = computeOrderFingerprint({
    orderId: order.id,
    merchantId: order.merchantId,
    currency: order.currency,
    totalAmountMinor: order.totalAmountMinor,
    authorizationId: order.authorizationId ?? "",
    lines: order.items,
  });
  return recomputed === expectedFingerprint;
}

function toInitiationResponse(payment: Payment, keyId: string, testMode: boolean): PaymentInitiationResponseDTO {
  if (!payment.providerOrderId) {
    throw new AppError("PAYMENT_PROVIDER_ERROR", "Payment does not yet have a confirmed provider order reference.");
  }
  return {
    schemaVersion: "1.0",
    paymentId: payment.id,
    provider: payment.provider,
    providerOrderId: payment.providerOrderId,
    keyId,
    amountMinor: payment.amountMinor,
    currency: payment.currency,
    checkoutId: payment.checkoutId!,
    orderId: payment.orderId,
    testMode,
  };
}

export async function initiatePayment(prisma: PrismaClient, merchantId: string, checkoutId: string): Promise<PaymentInitiationResponseDTO> {
  const gateway = getPaymentGateway();
  const publicConfig = gateway?.getPublicConfig() ?? null;
  if (!gateway || !publicConfig) {
    throw new AppError("PAYMENT_NOT_CONFIGURED", "Razorpay Test Mode is not configured on this server.");
  }

  const now = systemClock.now();
  const checkout = (await findCheckoutById(prisma, merchantId, checkoutId)) as CheckoutWithOrder | null;
  if (!checkout) throw AppError.notFound(`Checkout not found: ${checkoutId}`);

  const existing = await findPaymentByCheckoutId(prisma, merchantId, checkoutId);
  if (existing) {
    if (existing.providerOrderId) {
      // PART 07 §90, §92 — idempotent return: this checkout already has an
      // active (or even fully resolved) payment attempt with a real
      // provider order; never create a second one.
      logger.info({ event: "payments.initiation_idempotent_reuse", merchantId, checkoutId, paymentId: existing.id }, "Reusing existing payment initiation");
      return toInitiationResponse(existing, publicConfig.keyId, publicConfig.testMode);
    }
    if (existing.state === "FAILED" || existing.state === "CANCELLED" || existing.state === "CAPTURED") {
      throw new AppError("PAYMENT_ALREADY_ATTEMPTED", `This checkout already has a resolved payment attempt (${existing.state}). A new attempt requires a new authorized checkout.`);
    }
    // `existing.state` is CREATED or UNKNOWN with no providerOrderId yet —
    // a prior provider-order-creation call never got a confirmed response
    // (PART 07 §43, §60). Retrying re-uses the SAME Payment row (and
    // therefore the same `receipt`) rather than creating a new one. Until
    // the provider confirms an outcome, the payment remains UNKNOWN and
    // cannot be treated as settled.
    return continueProviderOrderCreation(prisma, merchantId, existing, checkout.workflowId, gateway, publicConfig, now);
  }

  if (checkout.status !== "READY_FOR_PAYMENT") {
    throw new AppError("CHECKOUT_NOT_PAYABLE", `Checkout is not payable (status: ${checkout.status}).`);
  }
  if (checkout.expiresAt.getTime() <= now.getTime()) {
    throw new AppError("CHECKOUT_EXPIRED", "This checkout has expired.");
  }
  if (!verifyOrderFingerprint(checkout.order, checkout.orderFingerprint)) {
    throw new AppError("FINANCIAL_INTEGRITY_ERROR", "The order's financial fingerprint no longer matches its persisted line items.");
  }

  const paymentId = randomUUID();
  let payment: Payment;
  try {
    payment = await prisma.$transaction(async (tx) => {
      const created = await createPayment(tx, {
        id: paymentId,
        merchantId,
        orderId: checkout.orderId,
        checkoutId: checkout.id,
        provider: gateway.provider,
        amountMinor: checkout.amountMinor,
        currency: checkout.currency,
      });
      await appendLedgerEvent(tx, {
        workflowId: checkout.workflowId,
        merchantId,
        actorType: "CUSTOMER",
        actionType: "PAYMENT_INITIATION_REQUESTED",
        status: "EXECUTED",
        conciseReason: `Payment initiation requested for checkout ${checkout.id}.`,
        relatedEntityType: "CheckoutSession",
        relatedEntityId: checkout.id,
        executedAt: now,
      });
      await appendLedgerEvent(tx, {
        workflowId: checkout.workflowId,
        merchantId,
        actorType: "PAYMENT_SYSTEM",
        actionType: "PAYMENT_RECORD_CREATED",
        status: "EXECUTED",
        conciseReason: `Payment record created: ${checkout.amountMinor} ${checkout.currency} minor units.`,
        relatedEntityType: "Payment",
        relatedEntityId: created.id,
        executedAt: now,
      });
      return created;
    });
  } catch (err) {
    // A concurrent request may have won the race to create this checkout's
    // one Payment row (PART 07 §90, §126). Re-checking directly (rather
    // than only trusting `isPaymentCheckoutConflict`'s error-shape match)
    // is deliberate: the local PGlite dev database has been observed to
    // surface a real unique-constraint violation as a garbled "unexpected
    // message from server" instead of a clean `P2002` (the same class of
    // wire-protocol quirk documented elsewhere for FK-RESTRICT violations),
    // so relying on the error shape alone is not reliable there. If no
    // winner actually exists, this was a genuinely different failure and
    // the original error is rethrown unchanged.
    const winner = await findPaymentByCheckoutId(prisma, merchantId, checkoutId);
    if (winner) return continueProviderOrderCreation(prisma, merchantId, winner, checkout.workflowId, gateway, publicConfig, now);
    throw err;
  }

  return continueProviderOrderCreation(prisma, merchantId, payment, checkout.workflowId, gateway, publicConfig, now);
}

async function continueProviderOrderCreation(
  prisma: PrismaClient,
  merchantId: string,
  payment: Payment,
  workflowId: string,
  gateway: PaymentGateway,
  publicConfig: PaymentGatewayPublicConfig,
  now: Date,
): Promise<PaymentInitiationResponseDTO> {
  // PART 07 §90, §126 — re-check immediately before calling the provider:
  // closes most of the window where a concurrent request already
  // finished this exact call while we were waiting our turn.
  const latest = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
  if (latest.providerOrderId) {
    return toInitiationResponse(latest, publicConfig.keyId, publicConfig.testMode);
  }

  // Claim durably BEFORE the network call. Never expire this claim into a
  // second POST: a crashed worker may already have created the provider order.
  const ownership = await prisma.payment.updateMany({
    where: { id: payment.id, providerOrderId: null, state: "CREATED", automaticRetryBlocked: false },
    data: { automaticRetryBlocked: true },
  });
  if (ownership.count !== 1) {
    const recovered = await recoverProviderOrder(prisma, merchantId, payment, workflowId, gateway);
    return toInitiationResponse(recovered, publicConfig.keyId, publicConfig.testMode);
  }

  // PART 07 §58-§59 — the external network call happens OUTSIDE any open
  // database transaction; the pre/post states are what make this safe
  // under a crash between the two.
  let providerOrder;
  try {
    providerOrder = await gateway.createPaymentOrder({ internalPaymentId: payment.id, amountMinor: payment.amountMinor, currency: payment.currency });
  } catch (err) {
    if (err instanceof ProviderGatewayError) {
      if (!["PROVIDER_AUTHENTICATION_ERROR", "PROVIDER_VALIDATION_ERROR"].includes(err.category)) {
        await prisma.payment.update({ where: { id: payment.id }, data: { state: "UNKNOWN" } });
        logger.warn({ event: "payments.provider_order_uncertain", merchantId, paymentId: payment.id, err: err.message }, "Provider order creation timed out; state left UNKNOWN");
        throw new AppError("PAYMENT_PROVIDER_ERROR", "Provider order outcome is unknown. Reconcile the existing payment; do not create a new checkout.");
      }
      const failureCategory = normalizeRazorpayFailure(null, err.message);
      await withLedgerConcurrencyRetry(prisma, async (tx) => {
        await tx.payment.update({ where: { id: payment.id }, data: { state: "FAILED", failureCategory, failureCode: err.category, failedAt: now } });
        await appendLedgerEvent(tx, {
          workflowId,
          merchantId,
          actorType: "PAYMENT_SYSTEM",
          actionType: "PAYMENT_FAILED",
          status: "FAILED",
          conciseReason: `Provider order creation failed: ${err.category}.`,
          relatedEntityType: "Payment",
          relatedEntityId: payment.id,
          metadata: { failureCategory, providerErrorCategory: err.category },
          executedAt: now,
        });
      });
      logger.error({ event: "payments.provider_order_failed", merchantId, paymentId: payment.id, category: err.category }, err.message);
      throw new AppError("PAYMENT_PROVIDER_ERROR", `Payment provider rejected order creation: ${err.message}`);
    }
    await prisma.payment.update({ where: { id: payment.id }, data: { state: "UNKNOWN" } });
    throw err;
  }

  if (providerOrder.amountMinor !== payment.amountMinor || providerOrder.currency !== payment.currency) {
    await prisma.payment.update({ where: { id: payment.id }, data: { state: "UNKNOWN" } });
    throw new AppError("FINANCIAL_INTEGRITY_ERROR", "Provider order does not match the authorized amount and currency.");
  }

  // Publish only the claimed provider result; recovery may have published it first.
  //
  // Releasing `automaticRetryBlocked` is part of publishing, not an
  // afterthought. The flag is the durable claim taken before the network
  // call, and it exists to stop a second POST while the outcome is
  // unknown. Once the provider order id is recorded the outcome is known,
  // so the claim has done its job and must be handed back.
  //
  // Leaving it set was silently fatal: `GET .../payment/checkout` refuses
  // any payment with `automaticRetryBlocked`, so every successfully
  // created Razorpay order was immediately ineligible for the checkout it
  // had just been created for. The buyer reached "Complete Razorpay Test
  // checkout" and got "Payment is not eligible for checkout" — with a real
  // order sitting in Razorpay. The uncertain paths above deliberately keep
  // the claim: an UNKNOWN or FAILED attempt must stay blocked.
  const claim = await prisma.payment.updateMany({
    where: { id: payment.id, providerOrderId: null },
    data: { providerOrderId: providerOrder.providerOrderId, state: "CREATED", automaticRetryBlocked: false },
  });
  if (claim.count === 0) {
    const winner = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    return toInitiationResponse(winner, publicConfig.keyId, publicConfig.testMode);
  }

  const updated = await withLedgerConcurrencyRetry(prisma, async (tx) => {
    const result = await tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
    const checkoutNow = await tx.checkoutSession.findUniqueOrThrow({ where: { id: payment.checkoutId! } });
    if (checkoutNow.status === "READY_FOR_PAYMENT") {
      await updateCheckoutStatus(tx, payment.checkoutId!, "PAYMENT_IN_PROGRESS");
      await setOrderStatus(tx, payment.orderId, "PAYMENT_PENDING");
    }
    await appendLedgerEvent(tx, {
      workflowId,
      merchantId,
      actorType: "PAYMENT_SYSTEM",
      actionType: "PROVIDER_ORDER_CREATED",
      status: "EXECUTED",
      conciseReason: `Razorpay Test Mode order created: ${providerOrder.providerOrderId}.`,
      relatedEntityType: "Payment",
      relatedEntityId: payment.id,
      metadata: { providerOrderId: providerOrder.providerOrderId },
      executedAt: now,
    });
    return result;
  });

  return toInitiationResponse(updated, publicConfig.keyId, publicConfig.testMode);
}

async function recoverProviderOrder(
  prisma: PrismaClient, merchantId: string, payment: Payment, workflowId: string, gateway: PaymentGateway,
): Promise<Payment> {
  const latest = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
  if (latest.providerOrderId) return latest;
  if (!gateway.findOrdersByReceipt) throw AppError.conflict("Provider order requires manual reconciliation; automatic creation is blocked.");
  const orders = await gateway.findOrdersByReceipt(payment.id);
  if (orders.length !== 1) {
    throw AppError.conflict(orders.length === 0
      ? "Provider order creation is in progress or unconfirmed. Retry reconciliation later; no second order will be created."
      : "Multiple provider orders match this receipt. Manual reconciliation is required.");
  }
  const order = orders[0]!;
  if (order.amountMinor !== payment.amountMinor || order.currency !== payment.currency) {
    throw new AppError("FINANCIAL_INTEGRITY_ERROR", "Recovered provider order does not match the authorized amount and currency.");
  }
  return withLedgerConcurrencyRetry(prisma, async tx => {
    // Same release as the create path: recovering the order resolves the
    // uncertainty the claim was protecting, so the claim is handed back.
    const claim = await tx.payment.updateMany({ where: { id: payment.id, providerOrderId: null, state: { in: ["CREATED", "UNKNOWN"] } },
      data: { providerOrderId: order.providerOrderId, state: "CREATED", automaticRetryBlocked: false } });
    if (claim.count === 1) {
      await updateCheckoutStatus(tx, payment.checkoutId!, "PAYMENT_IN_PROGRESS");
      await setOrderStatus(tx, payment.orderId, "PAYMENT_PENDING");
      await appendLedgerEvent(tx, { workflowId, merchantId, actorType: "PAYMENT_SYSTEM", actionType: "PROVIDER_ORDER_RECOVERED",
        status: "VERIFIED", conciseReason: "Recovered one matching provider order by receipt without issuing another create request.",
        relatedEntityType: "Payment", relatedEntityId: payment.id, metadata: { providerOrderId: order.providerOrderId }, executedAt: new Date() });
    }
    return tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
  });
}

export async function verifyClientCompletion(prisma: PrismaClient, merchantId: string, request: PaymentClientVerificationRequestDTO): Promise<PaymentDTO> {
  const gateway = getPaymentGateway();
  if (!gateway) throw new AppError("PAYMENT_NOT_CONFIGURED", "Razorpay Test Mode is not configured on this server.");

  const payment = await findPaymentById(prisma, merchantId, request.paymentId);
  if (!payment) throw AppError.notFound(`Payment not found: ${request.paymentId}`);
  const checkout = await findCheckoutById(prisma, merchantId, payment.checkoutId!);
  if (!checkout) throw AppError.notFound(`Checkout not found for payment: ${request.paymentId}`);
  const now = systemClock.now();

  await withLedgerConcurrencyRetry(prisma, async (tx) => {
    await appendLedgerEvent(tx, {
      workflowId: checkout.workflowId,
      merchantId,
      actorType: "CUSTOMER",
      actionType: "CLIENT_PAYMENT_VERIFICATION_RECEIVED",
      status: "EXECUTED",
      conciseReason: "Client-submitted Razorpay checkout completion received.",
      relatedEntityType: "Payment",
      relatedEntityId: payment.id,
      executedAt: now,
    });
  });

  // PART 07 §57 — the signature alone is not enough: it must also
  // actually reference the provider order THIS payment created.
  const orderMatches = payment.providerOrderId === request.razorpayOrderId;
  const signatureValid =
    orderMatches &&
    gateway.verifyClientCompletion({ providerOrderId: request.razorpayOrderId, providerPaymentId: request.razorpayPaymentId, signature: request.razorpaySignature });

  if (!signatureValid) {
    await withLedgerConcurrencyRetry(prisma, async (tx) => {
      await appendLedgerEvent(tx, {
        workflowId: checkout.workflowId,
        merchantId,
        actorType: "PAYMENT_SYSTEM",
        actionType: "CLIENT_PAYMENT_SIGNATURE_INVALID",
        status: "REJECTED",
        conciseReason: orderMatches ? "Client-submitted completion signature failed verification." : "Client-submitted completion referenced a different provider order.",
        relatedEntityType: "Payment",
        relatedEntityId: payment.id,
        executedAt: now,
      });
    });
    throw new AppError("PAYMENT_VERIFICATION_FAILED", "Payment completion could not be verified.");
  }

  await withLedgerConcurrencyRetry(prisma, async (tx) => {
    await appendLedgerEvent(tx, {
      workflowId: checkout.workflowId,
      merchantId,
      actorType: "PAYMENT_SYSTEM",
      actionType: "CLIENT_PAYMENT_SIGNATURE_VERIFIED",
      status: "VERIFIED",
      conciseReason: "Client-submitted completion signature verified.",
      relatedEntityType: "Payment",
      relatedEntityId: payment.id,
      executedAt: now,
    });
  });

  // PART 07 §40-§41 — the client callback is the lowest-confidence
  // evidence tier; it only earns the right to immediately fetch the REAL
  // authoritative payment state from the provider, never to assert a
  // state itself.
  const providerInfo = await gateway.fetchPayment(request.razorpayPaymentId);
  await withLedgerConcurrencyRetry(prisma, async (tx) => {
    const fresh = await tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
    const freshOrder = await tx.order.findUniqueOrThrow({ where: { id: payment.orderId } });
    await resolvePaymentEvent(tx, {
      workflowId: checkout.workflowId,
      merchantId,
      payment: fresh,
      order: freshOrder,
      checkoutId: checkout.id,
      providerInfo,
      source: "CLIENT_VERIFICATION",
      now,
    });
  });

  const finalPayment = await findPaymentById(prisma, merchantId, payment.id);
  return toPaymentDTO(finalPayment!);
}

/**
 * Recovers a payment we hold a provider ORDER for but no provider PAYMENT
 * id — the stranded case: the customer completed checkout, but the browser
 * closed before the callback and no webhook arrived. Without this the row
 * sits at CREATED forever while the provider considers it paid.
 *
 * Selection is deliberately conservative. A single attempt is
 * unambiguous. With several attempts we take a settled one (`captured` /
 * `authorized`) because that is the outcome that decides financial truth,
 * and there can only be one — an order stops accepting payments once one
 * succeeds. If every attempt failed, the latest failure is the honest
 * current state. We never guess between two settled payments.
 */
async function recoverStrandedPayment(
  gateway: PaymentGateway,
  providerOrderId: string,
  internalPaymentId: string,
): Promise<ProviderPaymentInfo> {
  const attempts = await gateway.listPaymentsForOrder(providerOrderId);
  if (attempts.length === 0) {
    throw AppError.conflict(
      "The provider has no payment recorded against this order yet — the customer has not completed checkout.",
    );
  }

  const settled = attempts.filter((a) => a.providerStatus === "captured" || a.providerStatus === "authorized");
  if (settled.length > 1) {
    throw AppError.conflict(
      `The provider reports ${settled.length} settled payments on order ${providerOrderId}. Refusing to guess which is authoritative — reconcile this manually.`,
    );
  }

  const chosen = settled[0] ?? attempts[attempts.length - 1]!;
  logger.info(
    { event: "payment.stranded_recovered", internalPaymentId, providerOrderId, providerPaymentId: chosen.providerPaymentId, providerStatus: chosen.providerStatus },
    "Recovered a stranded payment by provider order lookup",
  );
  return chosen;
}

export async function reconcilePayment(prisma: PrismaClient, merchantId: string, paymentId: string): Promise<PaymentDTO> {
  const gateway = getPaymentGateway();
  if (!gateway) throw new AppError("PAYMENT_NOT_CONFIGURED", "Razorpay Test Mode is not configured on this server.");

  let payment = await findPaymentById(prisma, merchantId, paymentId);
  if (!payment) throw AppError.notFound(`Payment not found: ${paymentId}`);
  /**
   * NEVER ASK ONE PROVIDER ABOUT ANOTHER PROVIDER'S TRANSACTION.
   *
   * `Payment.provider` records who actually created the payment, and this
   * never compared it to the gateway now configured. On a server holding
   * Razorpay credentials, the Merchant Agent's reconcile tool dutifully
   * asked Razorpay about `mock_order_…` identifiers — a call that cannot
   * succeed, made once per payment, every cycle. The merchant saw "an
   * unexpected error stopped this step" against the agent's own headline
   * objective, forever.
   *
   * The mismatch is not only a dev-data artifact: any deployment that
   * changes provider, or holds rows from a previous one, has payments the
   * current gateway never made. An answer from the wrong provider is not
   * a worse answer, it is a meaningless one — and reconciliation exists
   * specifically to decide financial truth. Refuse and say so.
   *
   * CONFLICT is deliberate: `REFUSAL_CODES` classifies it as a guardrail
   * declining, not an outage, so a correctly-refused step is not counted
   * among real failures.
   */
  const gatewayProvider = gateway.provider;
  if (payment.provider !== gatewayProvider) {
    throw AppError.conflict(
      `This payment was created through ${payment.provider}, but the server is configured for ${gatewayProvider}. ` +
        `Reconciling would ask one provider about another's transaction, which cannot return a truthful answer.`,
    );
  }
  if (!payment.providerPaymentId && !payment.providerOrderId) {
    const pendingCheckout = await findCheckoutById(prisma, merchantId, payment.checkoutId!);
    if (!pendingCheckout) throw AppError.notFound("Checkout not found for payment.");
    payment = await recoverProviderOrder(prisma, merchantId, payment, pendingCheckout.workflowId, gateway);
  }
  const now = systemClock.now();
  if (payment.lastReconciledAt && now.getTime() - payment.lastReconciledAt.getTime() < RECONCILE_COOLDOWN_MS) {
    throw AppError.conflict("Reconciliation was attempted recently; please wait a few seconds before trying again.");
  }

  const checkout = await findCheckoutById(prisma, merchantId, payment.checkoutId!);
  if (!checkout) throw AppError.notFound(`Checkout not found for payment: ${paymentId}`);

  const providerInfo = payment.providerPaymentId
    ? await gateway.fetchPayment(payment.providerPaymentId)
    : await recoverStrandedPayment(gateway, payment.providerOrderId!, payment.id);

  await withLedgerConcurrencyRetry(prisma, async (tx) => {
    const fresh = await tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
    const freshOrder = await tx.order.findUniqueOrThrow({ where: { id: payment.orderId } });
    // Persist a reference recovered by order lookup before resolving the
    // event: if the provider still reports the same state, the state
    // machine short-circuits as an idempotent no-op and the reference we
    // just learned would be lost.
    if (!fresh.providerPaymentId && providerInfo.providerPaymentId) {
      await attachProviderPaymentId(tx, fresh.id, providerInfo.providerPaymentId);
      await appendLedgerEvent(tx, {
        workflowId: checkout.workflowId,
        merchantId,
        actorType: "PAYMENT_SYSTEM",
        actionType: "PAYMENT_RECONCILED",
        status: "EXECUTED",
        conciseReason: `Recovered stranded provider payment reference ${providerInfo.providerPaymentId} by order lookup.`,
        relatedEntityType: "Payment",
        relatedEntityId: fresh.id,
        executedAt: now,
      });
    }
    const result = await resolvePaymentEvent(tx, {
      workflowId: checkout.workflowId,
      merchantId,
      payment: fresh,
      order: freshOrder,
      checkoutId: checkout.id,
      providerInfo,
      source: "RECONCILE",
      now,
    });
    await appendLedgerEvent(tx, {
      workflowId: checkout.workflowId,
      merchantId,
      actorType: "PAYMENT_SYSTEM",
      actionType: "PAYMENT_RECONCILED",
      status: "EXECUTED",
      conciseReason: `Reconciliation fetched provider state (${result.toState}).`,
      relatedEntityType: "Payment",
      relatedEntityId: payment.id,
      executedAt: now,
    });
  });
  await touchReconciledAt(prisma, payment.id);

  const finalPayment = await findPaymentById(prisma, merchantId, paymentId);
  return toPaymentDTO(finalPayment!);
}

export async function getPayment(prisma: PrismaClient, merchantId: string, paymentId: string): Promise<PaymentDTO> {
  const payment = await findPaymentById(prisma, merchantId, paymentId);
  if (!payment) throw AppError.notFound(`Payment not found: ${paymentId}`);
  return toPaymentDTO(payment);
}

export { applyPaymentTransition };
