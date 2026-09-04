import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { ORDER_FINGERPRINT_VERSION } from "@razorgrowth/domain";
import { AppError } from "../../http/errors.js";
import { appendLedgerEvent, withLedgerConcurrencyRetry } from "../audit/ledger.js";
import { createCartWithItems, updateCartStatus } from "../commerce/cart-repository.js";
import { createOrderWithItems, setOrderFingerprint, setOrderStatus } from "../commerce/order-repository.js";
import { computeOrderFingerprint } from "../commerce/order-fingerprint.js";
import { updateCheckoutStatus } from "../commerce/checkout-repository.js";
import { initiatePayment } from "../payments/payment-service.js";
import { resolvePaymentEvent } from "../payments/payment-transition.js";
import { applyPaymentTransition } from "../payments/payment-repository.js";

export interface GatewayExecutionLine {
  productId: string;
  variantId: string;
  quantity: number;
  unitPriceMinor: number;
  lineDiscountMinor?: number;
}

export interface GatewayExecutionResult {
  orderId: string;
  checkoutId: string;
  paymentId: string;
  providerOrderId: string;
}

export class ExternalPurchaseExecutionError extends Error {
  constructor(
    public readonly executionStatus: "FAILED" | "UNKNOWN",
    public readonly refs: { orderId: string; checkoutId: string; paymentId: string | null; providerOrderId: string | null },
    message: string,
  ) {
    super(message);
    this.name = "ExternalPurchaseExecutionError";
  }
}

/**
 * Turns one already-approved external intent into the same authoritative
 * Cart → Order → CheckoutSession → Payment chain used by human/merchant
 * flows. The DecisionRecord id is the authorization identifier included in
 * the order fingerprint and workflow ledger.
 */
export async function executeExternalAgentPurchase(
  prisma: PrismaClient,
  params: {
    merchantId: string;
    decisionId: string;
    workflowId: string;
    currency: string;
    amountMinor: number;
    lines: GatewayExecutionLine[];
  },
): Promise<GatewayExecutionResult> {
  const cartId = randomUUID();
  const orderId = randomUUID();
  const checkoutId = randomUUID();

  const created = await withLedgerConcurrencyRetry(prisma, async (tx) => {
    const variants = await tx.productVariant.findMany({
      where: {
        id: { in: params.lines.map((line) => line.variantId) },
        active: true,
        product: { merchantId: params.merchantId, status: "ACTIVE", merchant: { status: "ACTIVE" } },
      },
      include: { product: { select: { name: true } }, inventory: true },
    });
    const byId = new Map(variants.map((variant) => [variant.id, variant]));
    if (variants.length !== params.lines.length) {
      throw new AppError("PRODUCT_NOT_ELIGIBLE", "A product became unavailable before checkout. Nothing was charged.");
    }

    let recomputedTotal = 0;
    for (const line of params.lines) {
      const variant = byId.get(line.variantId);
      if (!variant || variant.priceMinor !== line.unitPriceMinor || variant.currency !== params.currency) {
        throw new AppError("PRICE_CHANGED", "A price changed after approval. The stale authorization was not executed.");
      }
      const lineDiscount = line.lineDiscountMinor ?? 0;
      recomputedTotal += (variant.priceMinor * line.quantity) - lineDiscount;
    }
    if (recomputedTotal !== params.amountMinor) {
      throw new AppError("FINANCIAL_INTEGRITY_ERROR", "The approved basket no longer matches its server-computed total.");
    }

    // Guarded decrement inside the same transaction as the order. Missing
    // inventory is UNKNOWN and therefore not autonomously purchasable.
    for (const line of params.lines) {
      const reserved = await tx.inventory.updateMany({
        where: { variantId: line.variantId, availableQuantity: { gte: line.quantity } },
        data: { availableQuantity: { decrement: line.quantity } },
      });
      if (reserved.count !== 1) {
        throw new AppError(
          "INSUFFICIENT_INVENTORY",
          "Stock became unavailable while the agent checkout was being created. Nothing was reserved or charged.",
        );
      }
    }

    const cart = await createCartWithItems(tx, {
      id: cartId,
      merchantId: params.merchantId,
      customerId: null,
      currency: params.currency,
      items: params.lines.map((line) => ({
        variantId: line.variantId,
        quantity: line.quantity,
        unitPriceMinor: line.unitPriceMinor,
        lineDiscountMinor: line.lineDiscountMinor ?? 0,
        currency: params.currency,
        source: "AGENT_GATEWAY",
        growthProposalId: null,
      })),
    });
    await updateCartStatus(tx, cart.id, "CHECKOUT_PENDING");

    const orderLines = params.lines.map((line) => {
      const variant = byId.get(line.variantId)!;
      const discount = line.lineDiscountMinor ?? 0;
      return {
        variantId: line.variantId,
        productNameSnapshot: variant.product.name,
        variantTitleSnapshot: variant.title,
        unitPriceMinor: line.unitPriceMinor,
        quantity: line.quantity,
        lineDiscountMinor: discount,
        lineTotalMinor: (line.unitPriceMinor * line.quantity) - discount,
        currency: params.currency,
        source: "AGENT_GATEWAY",
        growthProposalId: null,
      };
    });
    const order = await createOrderWithItems(tx, {
      id: orderId,
      merchantId: params.merchantId,
      customerId: null,
      currency: params.currency,
      totalAmountMinor: params.amountMinor,
      source: "AGENT_GATEWAY",
      growthProposalId: null,
      authorizationId: params.decisionId,
      items: orderLines,
    });
    const orderFingerprint = computeOrderFingerprint({
      orderId,
      merchantId: params.merchantId,
      currency: params.currency,
      totalAmountMinor: params.amountMinor,
      authorizationId: params.decisionId,
      lines: orderLines,
    });
    await setOrderFingerprint(tx, order.id, orderFingerprint, ORDER_FINGERPRINT_VERSION);
    // The merchant growth path records ORDER_CREATED; this one did not,
    // so an order placed by a buyer's agent existed in the database with
    // nothing in the ledger saying it had been created.
    await appendLedgerEvent(tx, {
      workflowId: params.workflowId,
      merchantId: params.merchantId,
      actorType: "COMMERCE",
      actionType: "ORDER_CREATED",
      status: "EXECUTED",
      conciseReason: `Order created: total ${params.amountMinor} ${params.currency} minor units. No payment has been started.`,
      relatedEntityType: "Order",
      relatedEntityId: orderId,
      metadata: { decisionId: params.decisionId, lineCount: params.lines.length },
      executedAt: new Date(),
    });

    await tx.checkoutSession.create({
      data: {
        id: checkoutId,
        merchantId: params.merchantId,
        customerId: null,
        cartId,
        orderId,
        authorizationId: null,
        gatewayDecisionId: params.decisionId,
        status: "READY_FOR_PAYMENT",
        amountMinor: params.amountMinor,
        currency: params.currency as never,
        orderFingerprint,
        fingerprintVersion: ORDER_FINGERPRINT_VERSION,
        workflowId: params.workflowId,
        expiresAt: new Date(Date.now() + 15 * 60_000),
      },
    });
    await updateCartStatus(tx, cart.id, "CONVERTED");
    await appendLedgerEvent(tx, {
      workflowId: params.workflowId,
      merchantId: params.merchantId,
      actorType: "COMMERCE",
      actionType: "AGENT_CHECKOUT_CREATED",
      status: "EXECUTED",
      conciseReason: `External agent checkout created for ${params.amountMinor} ${params.currency} minor units with stock reserved transactionally.`,
      relatedEntityType: "Order",
      relatedEntityId: orderId,
      metadata: { decisionId: params.decisionId, checkoutId, lineCount: params.lines.length },
      executedAt: new Date(),
    });
    return { cartId, orderId, checkoutId };
  });

  try {
    const payment = await initiatePayment(prisma, params.merchantId, created.checkoutId);
    return {
      orderId: created.orderId,
      checkoutId: created.checkoutId,
      paymentId: payment.paymentId,
      providerOrderId: payment.providerOrderId,
    };
  } catch (error) {
    const payment = await prisma.payment.findUnique({ where: { checkoutId: created.checkoutId } });
    // A deterministic provider rejection is final: release the reservation.
    // UNKNOWN is deliberately not released because the provider may have
    // accepted the order before the response was lost.
    if (payment?.state === "FAILED") {
      await withLedgerConcurrencyRetry(prisma, async (tx) => {
        for (const line of params.lines) {
          await tx.inventory.update({
            where: { variantId: line.variantId },
            data: { availableQuantity: { increment: line.quantity } },
          });
        }
        await setOrderStatus(tx, created.orderId, "FAILED");
        await updateCheckoutStatus(tx, created.checkoutId, "FAILED");
        await appendLedgerEvent(tx, {
          workflowId: params.workflowId,
          merchantId: params.merchantId,
          actorType: "COMMERCE",
          actionType: "AGENT_INVENTORY_RESERVATION_RELEASED",
          status: "EXECUTED",
          conciseReason: "Provider order creation failed definitively; the agent basket reservation was released.",
          relatedEntityType: "Order",
          relatedEntityId: created.orderId,
          executedAt: new Date(),
        });
        await tx.decisionRecord.update({
          where: { id: params.decisionId },
          data: {
            internalOrderId: created.orderId,
            internalPaymentId: payment.id,
            providerOrderId: payment.providerOrderId,
            settlementStatus: "FAILED",
            inventoryReleasedAt: new Date(),
          },
        });
      });
    }
    const status = payment?.state === "UNKNOWN" || payment?.state === "CREATED" ? "UNKNOWN" : "FAILED";
    if (status === "UNKNOWN") {
      await prisma.decisionRecord.update({
        where: { id: params.decisionId },
        data: {
          internalOrderId: created.orderId,
          internalPaymentId: payment?.id ?? null,
          providerOrderId: payment?.providerOrderId ?? null,
          settlementStatus: "UNKNOWN",
        },
      });
    }
    throw new ExternalPurchaseExecutionError(
      status,
      {
        orderId: created.orderId,
        checkoutId: created.checkoutId,
        paymentId: payment?.id ?? null,
        providerOrderId: payment?.providerOrderId ?? null,
      },
      status === "UNKNOWN"
        ? "The provider outcome is unknown. Reconcile the existing payment; do not create another checkout."
        : error instanceof Error
          ? error.message
          : "Provider order creation failed definitively.",
    );
  }
}

export interface PreparedX402Purchase {
  cartId: string;
  orderId: string;
  checkoutId: string;
  paymentId: string;
}

/**
 * Reserves stock and creates the internal financial lifecycle before x402
 * settlement is attempted. This is deliberately separate from Razorpay order
 * creation: switching rails behind an x402 authorization would violate the
 * buyer's consent.
 */
export async function prepareX402ExternalAgentPurchase(
  prisma: PrismaClient,
  params: {
    merchantId: string;
    decisionId: string;
    workflowId: string;
    currency: string;
    amountMinor: number;
    authorizationReference: string;
    lines: GatewayExecutionLine[];
  },
): Promise<PreparedX402Purchase> {
  const cartId = randomUUID();
  const orderId = randomUUID();
  const checkoutId = randomUUID();
  const paymentId = randomUUID();

  return withLedgerConcurrencyRetry(prisma, async (tx) => {
    const variants = await tx.productVariant.findMany({
      where: {
        id: { in: params.lines.map((line) => line.variantId) },
        active: true,
        product: { merchantId: params.merchantId, status: "ACTIVE" },
      },
      include: { product: { select: { name: true } } },
    });
    const byId = new Map(variants.map((variant) => [variant.id, variant]));
    if (variants.length !== params.lines.length) {
      throw new AppError("PRODUCT_NOT_ELIGIBLE", "A product became unavailable before x402 settlement. Nothing was charged.");
    }

    let recomputedTotal = 0;
    for (const line of params.lines) {
      const variant = byId.get(line.variantId);
      if (!variant || variant.priceMinor !== line.unitPriceMinor || variant.currency !== params.currency) {
        throw new AppError("PRICE_CHANGED", "A price changed before x402 settlement. Nothing was charged.");
      }
      recomputedTotal += variant.priceMinor * line.quantity;
      const reserved = await tx.inventory.updateMany({
        where: { variantId: line.variantId, availableQuantity: { gte: line.quantity } },
        data: { availableQuantity: { decrement: line.quantity } },
      });
      if (reserved.count !== 1) {
        throw new AppError("INSUFFICIENT_INVENTORY", "Stock is unavailable for this x402 purchase. Nothing was charged.");
      }
    }
    if (recomputedTotal !== params.amountMinor) {
      throw new AppError("FINANCIAL_INTEGRITY_ERROR", "The x402 quote no longer matches the server-priced basket.");
    }

    const cart = await createCartWithItems(tx, {
      id: cartId,
      merchantId: params.merchantId,
      customerId: null,
      currency: params.currency,
      items: params.lines.map((line) => ({
        variantId: line.variantId,
        quantity: line.quantity,
        unitPriceMinor: line.unitPriceMinor,
        lineDiscountMinor: 0,
        currency: params.currency,
        source: "AGENT_GATEWAY",
        growthProposalId: null,
      })),
    });
    await updateCartStatus(tx, cart.id, "CONVERTED");

    const orderLines = params.lines.map((line) => {
      const variant = byId.get(line.variantId)!;
      return {
        variantId: line.variantId,
        productNameSnapshot: variant.product.name,
        variantTitleSnapshot: variant.title,
        unitPriceMinor: line.unitPriceMinor,
        quantity: line.quantity,
        lineDiscountMinor: 0,
        lineTotalMinor: line.unitPriceMinor * line.quantity,
        currency: params.currency,
        source: "AGENT_GATEWAY",
        growthProposalId: null,
      };
    });
    const order = await createOrderWithItems(tx, {
      id: orderId,
      merchantId: params.merchantId,
      customerId: null,
      currency: params.currency,
      totalAmountMinor: params.amountMinor,
      source: "AGENT_GATEWAY",
      growthProposalId: null,
      authorizationId: params.decisionId,
      items: orderLines,
    });
    const orderFingerprint = computeOrderFingerprint({
      orderId,
      merchantId: params.merchantId,
      currency: params.currency,
      totalAmountMinor: params.amountMinor,
      authorizationId: params.decisionId,
      lines: orderLines,
    });
    await setOrderFingerprint(tx, order.id, orderFingerprint, ORDER_FINGERPRINT_VERSION);
    await setOrderStatus(tx, order.id, "PAYMENT_PENDING");

    await tx.checkoutSession.create({
      data: {
        id: checkoutId,
        merchantId: params.merchantId,
        customerId: null,
        cartId,
        orderId,
        authorizationId: null,
        gatewayDecisionId: params.decisionId,
        status: "PAYMENT_IN_PROGRESS",
        amountMinor: params.amountMinor,
        currency: params.currency as never,
        orderFingerprint,
        fingerprintVersion: ORDER_FINGERPRINT_VERSION,
        workflowId: params.workflowId,
        expiresAt: new Date(Date.now() + 15 * 60_000),
      },
    });
    await tx.payment.create({
      data: {
        id: paymentId,
        merchantId: params.merchantId,
        orderId,
        checkoutId,
        attemptNumber: 1,
        provider: "X402",
        providerOrderId: params.authorizationReference,
        amountMinor: params.amountMinor,
        currency: params.currency as never,
        state: "AUTHORIZED",
        authorizedAt: new Date(),
        providerMetadata: { rail: "x402", authorizationReference: params.authorizationReference },
      },
    });
    await tx.decisionRecord.update({
      where: { id: params.decisionId },
      data: { internalOrderId: orderId, internalPaymentId: paymentId },
    });
    await appendLedgerEvent(tx, {
      workflowId: params.workflowId,
      merchantId: params.merchantId,
      actorType: "COMMERCE",
      actionType: "X402_CHECKOUT_PREPARED",
      status: "EXECUTED",
      conciseReason: "Stock was reserved and an internal x402 payment authorization was created before settlement.",
      relatedEntityType: "Payment",
      relatedEntityId: paymentId,
      metadata: { orderId, checkoutId, decisionId: params.decisionId },
      executedAt: new Date(),
    });
    return { cartId, orderId, checkoutId, paymentId };
  });
}

/** Applies verified facilitator evidence and releases inventory only when the
 * facilitator definitively reports failure. An unavailable/ambiguous response
 * becomes UNKNOWN and retains the reservation for manual reconciliation. */
export async function finalizeX402ExternalAgentPurchase(
  prisma: PrismaClient,
  params: {
    merchantId: string;
    workflowId: string;
    prepared: PreparedX402Purchase;
    lines: GatewayExecutionLine[];
    outcome: "CAPTURED" | "FAILED" | "UNKNOWN";
    transactionId?: string;
    reason?: string;
  },
): Promise<void> {
  await withLedgerConcurrencyRetry(prisma, async (tx) => {
    const payment = await tx.payment.findUnique({ where: { id: params.prepared.paymentId } });
    const order = await tx.order.findUnique({ where: { id: params.prepared.orderId } });
    if (!payment || !order || payment.merchantId !== params.merchantId || payment.state !== "AUTHORIZED") {
      throw AppError.conflict("The x402 payment lifecycle is no longer in its expected authorized state.");
    }

    if (params.outcome === "UNKNOWN") {
      await applyPaymentTransition(tx, payment.id, {
        state: "UNKNOWN",
        providerMetadata: { rail: "x402", settlement: "unknown", reason: params.reason ?? "facilitator_unavailable" },
      });
      await appendLedgerEvent(tx, {
        workflowId: params.workflowId,
        merchantId: params.merchantId,
        actorType: "PAYMENT_SYSTEM",
        actionType: "X402_SETTLEMENT_UNKNOWN",
        status: "FAILED",
        conciseReason: "The facilitator outcome is unknown; inventory remains reserved and the payment requires reconciliation.",
        relatedEntityType: "Payment",
        relatedEntityId: payment.id,
        executedAt: new Date(),
      });
      return;
    }

    await resolvePaymentEvent(tx, {
      workflowId: params.workflowId,
      merchantId: params.merchantId,
      payment,
      order,
      checkoutId: params.prepared.checkoutId,
      providerInfo: {
        providerPaymentId: params.transactionId,
        providerOrderId: payment.providerOrderId,
        amountMinor: payment.amountMinor,
        currency: payment.currency,
        providerStatus: params.outcome === "CAPTURED" ? "captured" : "failed",
        method: "x402",
        errorCode: params.outcome === "FAILED" ? "X402_SETTLEMENT_FAILED" : null,
        errorDescription: params.outcome === "FAILED" ? params.reason ?? "Facilitator declined settlement" : null,
        capturedAt: params.outcome === "CAPTURED" ? new Date() : null,
      },
      source: "FACILITATOR",
      now: new Date(),
    });

  });
}
