import type { Prisma, PrismaClient } from "@prisma/client";

export function createCheckoutSession(
  tx: Prisma.TransactionClient,
  data: {
    id: string;
    merchantId: string;
    customerId: string | null;
    cartId: string;
    orderId: string;
    authorizationId: string;
    amountMinor: number;
    currency: string;
    orderFingerprint: string;
    fingerprintVersion: string;
    workflowId: string;
    expiresAt: Date;
  },
) {
  return tx.checkoutSession.create({
    data: {
      id: data.id,
      merchantId: data.merchantId,
      customerId: data.customerId,
      cartId: data.cartId,
      orderId: data.orderId,
      authorizationId: data.authorizationId,
      status: "CREATED",
      amountMinor: data.amountMinor,
      currency: data.currency as never,
      orderFingerprint: data.orderFingerprint,
      fingerprintVersion: data.fingerprintVersion,
      workflowId: data.workflowId,
      expiresAt: data.expiresAt,
    },
  });
}

export function updateCheckoutStatus(
  tx: Prisma.TransactionClient,
  checkoutId: string,
  status: "CREATED" | "READY_FOR_PAYMENT" | "PAYMENT_IN_PROGRESS" | "COMPLETED" | "FAILED" | "EXPIRED" | "CANCELLED",
) {
  return tx.checkoutSession.update({ where: { id: checkoutId }, data: { status } });
}

export function findCheckoutById(prismaLike: PrismaClient | Prisma.TransactionClient, merchantId: string, checkoutId: string) {
  return prismaLike.checkoutSession.findFirst({
    where: { id: checkoutId, merchantId },
    include: { order: { include: { items: true } }, cart: { include: { items: true } }, payments: true },
  });
}
