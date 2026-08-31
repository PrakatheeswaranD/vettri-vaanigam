/**
 * Commerce Maintenance Service.
 * Sweeps expired or abandoned checkout sessions and safely restocks reserved inventory.
 */
import type { PrismaClient } from "@prisma/client";
import { appendLedgerEvent } from "../audit/ledger.js";

export interface SweepResult {
  expiredCount: number;
  restockedVariantsCount: number;
  expiredCheckoutIds: string[];
}

/**
 * Finds all expired active checkout sessions, marks them EXPIRED,
 * restocks reserved inventory items, and logs to the audit ledger.
 */
export async function sweepExpiredCheckouts(
  prisma: PrismaClient,
  merchantId?: string,
): Promise<SweepResult> {
  const now = new Date();

  const expiredSessions = await prisma.checkoutSession.findMany({
    where: {
      status: { in: ["CREATED", "READY_FOR_PAYMENT", "PAYMENT_IN_PROGRESS"] },
      expiresAt: { lt: now },
      ...(merchantId ? { merchantId } : {}),
    },
    include: {
      order: {
        include: {
          items: true,
          payments: true,
        },
      },
    },
  });

  if (expiredSessions.length === 0) {
    return { expiredCount: 0, restockedVariantsCount: 0, expiredCheckoutIds: [] };
  }

  let restockedVariantsCount = 0;
  const expiredCheckoutIds: string[] = [];

  for (const session of expiredSessions) {
    // Check if any payment was captured
    const hasCapturedPayment = session.order.payments.some((p) => p.state === "CAPTURED");
    if (hasCapturedPayment) {
      continue; // Do not cancel or restock orders that were actually paid
    }

    await prisma.$transaction(async (tx) => {
      await tx.checkoutSession.update({
        where: { id: session.id },
        data: { status: "EXPIRED" },
      });

      await tx.order.update({
        where: { id: session.orderId },
        data: { status: "CANCELLED" },
      });

      for (const item of session.order.items) {
        const updated = await tx.inventory.updateMany({
          where: { variantId: item.variantId },
          data: { availableQuantity: { increment: item.quantity } },
        });
        if (updated.count > 0) {
          restockedVariantsCount += item.quantity;
        }
      }

      await appendLedgerEvent(tx, {
        merchantId: session.merchantId,
        actorType: "SYSTEM",
        actionType: "CHECKOUT_EXPIRED_INVENTORY_RESTOCKED",
        conciseReason: `Restocked ${restockedVariantsCount} inventory items from expired checkout ${session.id}.`,
        relatedEntityType: "CheckoutSession",
        relatedEntityId: session.id,
        workflowId: session.workflowId,
        metadata: {
          orderId: session.orderId,
          restockedItemCount: session.order.items.length,
          reason: "CHECKOUT_SESSION_EXPIRED",
        },
      }).catch(() => undefined);
    });

    expiredCheckoutIds.push(session.id);
  }

  return {
    expiredCount: expiredCheckoutIds.length,
    restockedVariantsCount,
    expiredCheckoutIds,
  };
}
