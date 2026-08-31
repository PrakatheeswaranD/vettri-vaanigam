/**
 * Post-Purchase Operations API Routes.
 * Implements Refunds, Returns, Fulfillment tracking, Disputes/Chargebacks, and GST Taxes.
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  canTransitionPaymentState,
  calculateTaxes,
  canTransitionFulfillment,
  canTransitionReturn,
  canTransitionDispute,
  type FulfillmentStatus,
  type ReturnStatus,
  type DisputeStatus,
} from "@razorgrowth/domain";
import { prisma } from "../../db/client.js";
import { AppError } from "../../http/errors.js";
import { getAuthenticatedMerchantId } from "../authorization/demo-context.js";
import { requireApprovalRole, requireOwnerRole } from "../auth/middleware.js";
import { appendLedgerEvent } from "../audit/ledger.js";

const createRefundSchema = z.object({
  paymentId: z.string().uuid(),
  amountMinor: z.number().int().positive(),
  reason: z.string().min(1).max(500),
});

const createReturnSchema = z.object({
  orderId: z.string().uuid(),
  reason: z.string().min(1).max(500),
  items: z.array(
    z.object({
      orderItemId: z.string().uuid(),
      quantity: z.number().int().positive(),
      reason: z.string().optional(),
    }),
  ).min(1),
});

const createFulfillmentSchema = z.object({
  orderId: z.string().uuid(),
  carrier: z.string().min(1).max(100),
  trackingNumber: z.string().min(1).max(120),
  estimatedDeliveryAt: z.coerce.date().optional(),
  items: z.array(
    z.object({
      orderItemId: z.string().uuid(),
      quantity: z.number().int().positive(),
    }),
  ).min(1),
});

const createDisputeSchema = z.object({
  paymentId: z.string().uuid(),
  amountMinor: z.number().int().positive(),
  reason: z.string().min(1).max(500),
  providerDisputeId: z.string().optional(),
  feeMinor: z.number().int().nonnegative().optional(),
});

const calculateTaxSchema = z.object({
  amountMinor: z.number().int().nonnegative(),
  taxRateBps: z.number().int().nonnegative().default(1800),
  merchantStateCode: z.string().min(2).max(10).default("KA"),
  buyerStateCode: z.string().min(2).max(10).default("KA"),
});

export function registerPostPurchaseRoutes(app: FastifyInstance, prefix: string): void {
  // ── Refunds ──────────────────────────────────────────────────────────
  app.post(`${prefix}/refunds`, async (request, reply) => {
    const merchantId = getAuthenticatedMerchantId(request);
    requireApprovalRole(request);
    const body = createRefundSchema.parse(request.body);

    const payment = await prisma.payment.findUnique({
      where: { id: body.paymentId },
      include: { order: true, refunds: true },
    });

    if (!payment || payment.merchantId !== merchantId) {
      throw AppError.notFound("Payment not found.");
    }

    if (payment.state !== "CAPTURED" && payment.state !== "PARTIALLY_REFUNDED") {
      throw AppError.conflict(`Cannot refund payment in state ${payment.state}.`);
    }

    const priorRefundedMinor = payment.refunds.reduce((sum, r) => sum + r.amountMinor, 0);
    const availableMinor = payment.amountMinor - priorRefundedMinor;

    if (body.amountMinor > availableMinor) {
      throw AppError.conflict(
        `Requested refund of ${body.amountMinor} exceeds available amount of ${availableMinor} minor units.`,
      );
    }

    const nextPaymentState = body.amountMinor === availableMinor ? "REFUNDED" : "PARTIALLY_REFUNDED";
    if (!canTransitionPaymentState(payment.state, nextPaymentState)) {
      throw AppError.conflict(`Illegal transition from ${payment.state} to ${nextPaymentState}.`);
    }

    const refundId = randomUUID();
    const result = await prisma.$transaction(async (tx) => {
      const refund = await tx.refund.create({
        data: {
          id: refundId,
          merchantId,
          orderId: payment.orderId,
          paymentId: payment.id,
          amountMinor: body.amountMinor,
          currency: payment.currency,
          reason: body.reason,
          status: "PROCESSED",
        },
      });

      await tx.payment.update({
        where: { id: payment.id },
        data: { state: nextPaymentState },
      });

      await appendLedgerEvent(tx, {
        workflowId: `order-${payment.orderId}`,
        merchantId,
        actorType: "MERCHANT_USER",
        actionType: "PAYMENT_REFUNDED",
        conciseReason: `Refund of ${body.amountMinor} ${payment.currency} processed: ${body.reason}`,
        relatedEntityType: "Refund",
        relatedEntityId: refund.id,
        metadata: {
          paymentId: payment.id,
          orderId: payment.orderId,
          amountMinor: body.amountMinor,
          newPaymentState: nextPaymentState,
        },
      });

      return refund;
    });

    return reply.status(201).send(result);
  });

  app.get(`${prefix}/refunds`, async (request) => {
    const merchantId = getAuthenticatedMerchantId(request);
    const refunds = await prisma.refund.findMany({
      where: { merchantId },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return { items: refunds };
  });

  // ── Returns ──────────────────────────────────────────────────────────
  app.post(`${prefix}/returns`, async (request, reply) => {
    const merchantId = getAuthenticatedMerchantId(request);
    const body = createReturnSchema.parse(request.body);

    const order = await prisma.order.findUnique({
      where: { id: body.orderId },
      include: { items: true },
    });

    if (!order || order.merchantId !== merchantId) {
      throw AppError.notFound("Order not found.");
    }

    const returnId = randomUUID();
    const returnRequest = await prisma.$transaction(async (tx) => {
      const ret = await tx.returnRequest.create({
        data: {
          id: returnId,
          merchantId,
          orderId: order.id,
          status: "REQUESTED",
          reason: body.reason,
          items: {
            create: body.items.map((item) => ({
              orderItemId: item.orderItemId,
              quantity: item.quantity,
              reason: item.reason,
            })),
          },
        },
        include: { items: true },
      });

      await appendLedgerEvent(tx, {
        workflowId: `order-${order.id}`,
        merchantId,
        actorType: "SYSTEM",
        actionType: "RETURN_REQUESTED",
        conciseReason: `Return requested for order ${order.id}: ${body.reason}`,
        relatedEntityType: "ReturnRequest",
        relatedEntityId: ret.id,
        metadata: { orderId: order.id, itemCount: body.items.length },
      });

      return ret;
    });

    return reply.status(201).send(returnRequest);
  });

  app.post(`${prefix}/returns/:returnId/status`, async (request) => {
    const merchantId = getAuthenticatedMerchantId(request);
    requireApprovalRole(request);
    const { returnId } = request.params as { returnId: string };
    const { status } = z
      .object({ status: z.enum(["REQUESTED", "APPROVED", "REJECTED", "ITEM_RECEIVED", "COMPLETED", "CANCELLED"]) })
      .parse(request.body);

    const existing = await prisma.returnRequest.findUnique({ where: { id: returnId } });
    if (!existing || existing.merchantId !== merchantId) {
      throw AppError.notFound("Return request not found.");
    }

    if (!canTransitionReturn(existing.status as ReturnStatus, status as ReturnStatus)) {
      throw AppError.conflict(`Cannot transition return from ${existing.status} to ${status}.`);
    }

    const updated = await prisma.$transaction(async (tx) => {
      const res = await tx.returnRequest.update({
        where: { id: returnId },
        data: { status },
        include: { items: true },
      });

      await appendLedgerEvent(tx, {
        workflowId: `order-${existing.orderId}`,
        merchantId,
        actorType: "MERCHANT_USER",
        actionType: `RETURN_${status}`,
        conciseReason: `Return ${returnId} transitioned from ${existing.status} to ${status}.`,
        relatedEntityType: "ReturnRequest",
        relatedEntityId: returnId,
      });

      return res;
    });

    return updated;
  });

  app.get(`${prefix}/returns`, async (request) => {
    const merchantId = getAuthenticatedMerchantId(request);
    const returns = await prisma.returnRequest.findMany({
      where: { merchantId },
      include: { items: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return { items: returns };
  });

  // ── Fulfillment ──────────────────────────────────────────────────────
  app.post(`${prefix}/fulfillments`, async (request, reply) => {
    const merchantId = getAuthenticatedMerchantId(request);
    requireApprovalRole(request);
    const body = createFulfillmentSchema.parse(request.body);

    const order = await prisma.order.findUnique({
      where: { id: body.orderId },
      include: { items: true },
    });

    if (!order || order.merchantId !== merchantId) {
      throw AppError.notFound("Order not found.");
    }

    const fulfillmentId = randomUUID();
    const fulfillment = await prisma.$transaction(async (tx) => {
      const res = await tx.fulfillment.create({
        data: {
          id: fulfillmentId,
          merchantId,
          orderId: order.id,
          status: "SHIPPED",
          carrier: body.carrier,
          trackingNumber: body.trackingNumber,
          estimatedDeliveryAt: body.estimatedDeliveryAt,
          items: {
            create: body.items.map((item) => ({
              orderItemId: item.orderItemId,
              quantity: item.quantity,
            })),
          },
        },
        include: { items: true },
      });

      await appendLedgerEvent(tx, {
        workflowId: `order-${order.id}`,
        merchantId,
        actorType: "MERCHANT_USER",
        actionType: "ORDER_FULFILLED",
        conciseReason: `Order ${order.id} shipped via ${body.carrier} (${body.trackingNumber}).`,
        relatedEntityType: "Fulfillment",
        relatedEntityId: res.id,
        metadata: { carrier: body.carrier, trackingNumber: body.trackingNumber },
      });

      return res;
    });

    return reply.status(201).send(fulfillment);
  });

  app.post(`${prefix}/fulfillments/:fulfillmentId/status`, async (request) => {
    const merchantId = getAuthenticatedMerchantId(request);
    requireApprovalRole(request);
    const { fulfillmentId } = request.params as { fulfillmentId: string };
    const { status } = z
      .object({ status: z.enum(["PENDING", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED"]) })
      .parse(request.body);

    const existing = await prisma.fulfillment.findUnique({ where: { id: fulfillmentId } });
    if (!existing || existing.merchantId !== merchantId) {
      throw AppError.notFound("Fulfillment not found.");
    }

    if (!canTransitionFulfillment(existing.status as FulfillmentStatus, status as FulfillmentStatus)) {
      throw AppError.conflict(`Cannot transition fulfillment from ${existing.status} to ${status}.`);
    }

    const updated = await prisma.$transaction(async (tx) => {
      const res = await tx.fulfillment.update({
        where: { id: fulfillmentId },
        data: {
          status,
          deliveredAt: status === "DELIVERED" ? new Date() : undefined,
        },
        include: { items: true },
      });

      await appendLedgerEvent(tx, {
        workflowId: `order-${existing.orderId}`,
        merchantId,
        actorType: "SYSTEM",
        actionType: `FULFILLMENT_${status}`,
        conciseReason: `Fulfillment ${fulfillmentId} transitioned to ${status}.`,
        relatedEntityType: "Fulfillment",
        relatedEntityId: fulfillmentId,
      });

      return res;
    });

    return updated;
  });

  app.get(`${prefix}/fulfillments`, async (request) => {
    const merchantId = getAuthenticatedMerchantId(request);
    const list = await prisma.fulfillment.findMany({
      where: { merchantId },
      include: { items: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return { items: list };
  });

  // ── Disputes ─────────────────────────────────────────────────────────
  app.post(`${prefix}/disputes`, async (request, reply) => {
    const merchantId = getAuthenticatedMerchantId(request);
    requireOwnerRole(request);
    const body = createDisputeSchema.parse(request.body);

    const payment = await prisma.payment.findUnique({
      where: { id: body.paymentId },
      include: { order: true },
    });

    if (!payment || payment.merchantId !== merchantId) {
      throw AppError.notFound("Payment not found.");
    }

    const disputeId = randomUUID();
    const dispute = await prisma.$transaction(async (tx) => {
      const res = await tx.dispute.create({
        data: {
          id: disputeId,
          merchantId,
          orderId: payment.orderId,
          paymentId: payment.id,
          amountMinor: body.amountMinor,
          currency: payment.currency,
          reason: body.reason,
          providerDisputeId: body.providerDisputeId,
          feeMinor: body.feeMinor ?? 0,
          status: "OPEN",
        },
      });

      await appendLedgerEvent(tx, {
        workflowId: `order-${payment.orderId}`,
        merchantId,
        actorType: "SYSTEM",
        actionType: "DISPUTE_OPENED",
        conciseReason: `Dispute opened for payment ${payment.id}: ${body.reason}`,
        relatedEntityType: "Dispute",
        relatedEntityId: res.id,
        metadata: { amountMinor: body.amountMinor, currency: payment.currency },
      });

      return res;
    });

    return reply.status(201).send(dispute);
  });

  app.post(`${prefix}/disputes/:disputeId/status`, async (request) => {
    const merchantId = getAuthenticatedMerchantId(request);
    requireOwnerRole(request);
    const { disputeId } = request.params as { disputeId: string };
    const { status, evidenceText } = z
      .object({
        status: z.enum(["OPEN", "UNDER_REVIEW", "WON", "LOST", "CLOSED"]),
        evidenceText: z.string().optional(),
      })
      .parse(request.body);

    const existing = await prisma.dispute.findUnique({ where: { id: disputeId } });
    if (!existing || existing.merchantId !== merchantId) {
      throw AppError.notFound("Dispute not found.");
    }

    if (!canTransitionDispute(existing.status as DisputeStatus, status as DisputeStatus)) {
      throw AppError.conflict(`Cannot transition dispute from ${existing.status} to ${status}.`);
    }

    const updated = await prisma.$transaction(async (tx) => {
      const res = await tx.dispute.update({
        where: { id: disputeId },
        data: {
          status,
          evidenceText: evidenceText ?? existing.evidenceText,
          evidenceSubmittedAt: evidenceText ? new Date() : existing.evidenceSubmittedAt,
          resolvedAt: status === "WON" || status === "LOST" || status === "CLOSED" ? new Date() : undefined,
        },
      });

      await appendLedgerEvent(tx, {
        workflowId: `order-${existing.orderId}`,
        merchantId,
        actorType: "MERCHANT_USER",
        actionType: `DISPUTE_${status}`,
        conciseReason: `Dispute ${disputeId} transitioned to ${status}.`,
        relatedEntityType: "Dispute",
        relatedEntityId: disputeId,
      });

      return res;
    });

    return updated;
  });

  app.get(`${prefix}/disputes`, async (request) => {
    const merchantId = getAuthenticatedMerchantId(request);
    const disputes = await prisma.dispute.findMany({
      where: { merchantId },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return { items: disputes };
  });

  // ── Taxes ────────────────────────────────────────────────────────────
  app.post(`${prefix}/taxes/calculate`, async (request) => {
    const body = calculateTaxSchema.parse(request.body);
    const result = calculateTaxes(
      [
        {
          variantId: "calc-variant",
          unitPriceMinor: body.amountMinor,
          quantity: 1,
          taxRateBps: body.taxRateBps,
        },
      ],
      body.merchantStateCode,
      body.buyerStateCode,
    );
    return result;
  });
}
