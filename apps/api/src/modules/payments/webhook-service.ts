/**
 * Razorpay webhook processing (PART 07 §25-§35, §85-§89, §150). The
 * signature is verified against the RAW request body (captured by
 * `webhook-routes.ts` BEFORE any JSON parsing) — never a re-serialized
 * representation. No AI call anywhere in this file (`grep -i
 * "anthropic\|AIProvider"` returns nothing) — webhook processing is
 * deterministic infrastructure, exactly as required.
 */
import { createHash, randomUUID } from "node:crypto";
import type { PaymentProvider, PrismaClient } from "@prisma/client";
import { systemClock } from "@razorgrowth/domain";
import { logger } from "../../observability/logger.js";
import { appendLedgerEvent, withLedgerConcurrencyRetry } from "../audit/ledger.js";
import { findCheckoutById } from "../commerce/checkout-repository.js";
import { getPaymentGateway } from "./gateway-factory.js";
import { findPaymentByProviderOrderId, createProviderEvent, findProviderEventByFingerprint, isProviderEventDuplicateConflict, updateProviderEventStatus } from "./payment-repository.js";
import { resolvePaymentEvent } from "./payment-transition.js";
import { razorpayWebhookEventSchema } from "./razorpay-webhook-schema.js";
import type { ProviderPaymentInfo } from "./gateway.js";

export interface WebhookProcessingResult {
  accepted: boolean;
  reason: string;
}

function computeEventFingerprint(provider: PaymentProvider, eventType: string, providerPaymentId: string | null, providerOrderId: string | null, payloadHash: string): string {
  return createHash("sha256").update(`${provider}|${eventType}|${providerPaymentId ?? ""}|${providerOrderId ?? ""}|${payloadHash}`).digest("hex");
}

/**
 * PART 10 §1 — deliberately takes NO `merchantId` parameter. A webhook
 * is authenticated by HMAC signature, never a merchant session (this
 * route is on `auth/middleware.ts`'s unauthenticated allowlist), so
 * which merchant a given event belongs to is only knowable once its
 * `providerOrderId` resolves to a real `Payment` row — which already
 * carries its own `merchantId`, itself resolved without ever trusting
 * anything the request claims.
 */
export async function processRazorpayWebhook(
  prisma: PrismaClient,
  rawBody: Buffer,
  signatureHeader: string | undefined,
): Promise<WebhookProcessingResult> {
  const gateway = getPaymentGateway();
  const payloadHash = createHash("sha256").update(rawBody).digest("hex");

  if (!gateway) {
    logger.warn({ event: "webhook.received_but_not_configured" }, "Razorpay webhook received but payment integration is not configured");
    return { accepted: false, reason: "PAYMENT_NOT_CONFIGURED" };
  }

  // PART 07 §26, §28, §117 — verified against the exact raw bytes, never
  // a parsed-then-re-stringified body.
  const signatureVerified = gateway.verifyWebhookSignature(rawBody, signatureHeader);
  if (!signatureVerified) {
    logger.warn({ event: "webhook.signature_failed", payloadHash }, "Razorpay webhook signature verification failed");
    return { accepted: false, reason: "INVALID_SIGNATURE" };
  }

  // Only now — signature verified — does the body earn schema validation
  // and further processing (PART 07 §30).
  let parsedEvent;
  try {
    const json: unknown = JSON.parse(rawBody.toString("utf8"));
    parsedEvent = razorpayWebhookEventSchema.parse(json);
  } catch (err) {
    logger.warn({ event: "webhook.malformed_body", payloadHash, err: err instanceof Error ? err.message : String(err) }, "Signature-verified Razorpay webhook had an unparseable body");
    return { accepted: false, reason: "MALFORMED_BODY" };
  }

  const paymentEntity = parsedEvent.payload.payment?.entity ?? null;
  const providerPaymentId = paymentEntity?.id ?? null;
  const providerOrderId = paymentEntity?.order_id ?? null;
  const eventFingerprint = computeEventFingerprint(gateway.provider, parsedEvent.event, providerPaymentId, providerOrderId, payloadHash);
  const eventId = randomUUID();

  // PART 07 §23, §87 — check-then-insert, not insert-then-catch-P2002: the
  // local PGlite dev database surfaces a real unique-constraint violation
  // as a garbled "unexpected message from server" rather than a clean
  // `P2002` (the same class of wire-protocol quirk documented in
  // PROGRESS.md for FK-RESTRICT violations), so `isProviderEventDuplicate
  // Conflict` cannot reliably catch it there. This trades perfect atomicity
  // under a genuinely simultaneous redelivery (rare — provider retries are
  // spaced in time, not concurrent) for working correctly against this
  // dev shim; the database-level unique constraint remains as a real
  // defense-in-depth against a true race on real Postgres.
  const alreadySeen = await findProviderEventByFingerprint(prisma, gateway.provider, eventFingerprint);
  if (alreadySeen) {
    logger.info({ event: "webhook.duplicate", eventFingerprint, eventType: parsedEvent.event }, "Duplicate Razorpay webhook delivery ignored");
    return { accepted: true, reason: "DUPLICATE" };
  }

  let created;
  try {
    created = await createProviderEvent(prisma, {
      id: eventId,
      merchantId: null,
      provider: gateway.provider,
      providerEventId: null,
      eventType: parsedEvent.event,
      paymentId: null,
      providerPaymentId,
      providerOrderId,
      eventFingerprint,
      payloadHash,
      signatureVerified: true,
      processingStatus: "RECEIVED",
    });
  } catch (err) {
    if (isProviderEventDuplicateConflict(err)) {
      logger.info({ event: "webhook.duplicate", eventFingerprint, eventType: parsedEvent.event }, "Duplicate Razorpay webhook delivery ignored");
      return { accepted: true, reason: "DUPLICATE" };
    }
    throw err;
  }

  if (!paymentEntity || !providerOrderId) {
    await updateProviderEventStatus(prisma, created.id, "UNRESOLVED");
    logger.info({ event: "webhook.unresolved_no_payment_entity", eventType: parsedEvent.event }, "Razorpay webhook did not carry a payment entity to resolve");
    return { accepted: true, reason: "NO_PAYMENT_ENTITY" };
  }

  const payment = await findPaymentByProviderOrderId(prisma, gateway.provider, providerOrderId);
  if (!payment) {
    // PART 07 §85 — a valid, signed event for a provider order this
    // system has no record of. Never create an order/payment from an
    // inbound event alone.
    await updateProviderEventStatus(prisma, created.id, "UNRESOLVED");
    logger.warn({ event: "webhook.unresolved_unknown_order", providerOrderId }, "Razorpay webhook referenced an unknown provider order");
    return { accepted: true, reason: "UNKNOWN_PROVIDER_ORDER" };
  }

  // Derived from the resolved Payment row itself — never trusted from
  // anything the request claims (PART 10 §1: this route has no
  // authenticated merchant session at all).
  const merchantId = payment.merchantId;
  const checkout = await findCheckoutById(prisma, merchantId, payment.checkoutId!);
  if (!checkout) {
    await updateProviderEventStatus(prisma, created.id, "UNRESOLVED");
    return { accepted: true, reason: "CHECKOUT_NOT_FOUND" };
  }

  const providerInfo: ProviderPaymentInfo = {
    providerPaymentId: paymentEntity.id,
    providerOrderId: paymentEntity.order_id ?? null,
    amountMinor: paymentEntity.amount,
    currency: paymentEntity.currency.toUpperCase(),
    providerStatus: paymentEntity.status,
    method: paymentEntity.method ?? null,
    errorCode: paymentEntity.error_code ?? null,
    errorDescription: paymentEntity.error_description ?? null,
    capturedAt: paymentEntity.status === "captured" ? systemClock.now() : null,
  };

  const now = systemClock.now();
  const result = await withLedgerConcurrencyRetry(prisma, async (tx) => {
    await appendLedgerEvent(tx, {
      workflowId: checkout.workflowId,
      merchantId,
      actorType: "RAZORPAY",
      actionType: "WEBHOOK_RECEIVED",
      status: "EXECUTED",
      conciseReason: `Received webhook event: ${parsedEvent.event}.`,
      relatedEntityType: "Payment",
      relatedEntityId: payment.id,
      executedAt: now,
    });
    await appendLedgerEvent(tx, {
      workflowId: checkout.workflowId,
      merchantId,
      actorType: "SYSTEM",
      actionType: "WEBHOOK_SIGNATURE_VERIFIED",
      status: "VERIFIED",
      conciseReason: "Webhook signature verified against the raw request body.",
      relatedEntityType: "Payment",
      relatedEntityId: payment.id,
      executedAt: now,
    });
    const fresh = await tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
    const freshOrder = await tx.order.findUniqueOrThrow({ where: { id: payment.orderId } });
    return resolvePaymentEvent(tx, {
      workflowId: checkout.workflowId,
      merchantId,
      payment: fresh,
      order: freshOrder,
      checkoutId: checkout.id,
      providerInfo,
      source: "WEBHOOK",
      now,
    });
  });

  await updateProviderEventStatus(prisma, created.id, result.integrityError ? "FAILED_PROCESSING" : "PROCESSED");
  return { accepted: true, reason: result.reason };
}
