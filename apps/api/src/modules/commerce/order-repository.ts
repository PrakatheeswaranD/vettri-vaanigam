import type { Prisma, PrismaClient } from "@prisma/client";

export interface CreateOrderItemInput {
  variantId: string;
  productNameSnapshot: string;
  variantTitleSnapshot: string;
  unitPriceMinor: number;
  quantity: number;
  lineDiscountMinor: number;
  lineTotalMinor: number;
  currency: string;
  source: string;
  growthProposalId: string | null;
}

export async function createOrderWithItems(
  tx: Prisma.TransactionClient,
  params: {
    id: string;
    merchantId: string;
    customerId: string | null;
    currency: string;
    totalAmountMinor: number;
    source: string;
    growthProposalId: string | null;
    authorizationId: string;
    items: CreateOrderItemInput[];
  },
) {
  const order = await tx.order.create({
    data: {
      id: params.id,
      merchantId: params.merchantId,
      customerId: params.customerId,
      currency: params.currency as never,
      totalAmountMinor: params.totalAmountMinor,
      status: "PENDING",
      source: params.source,
      growthProposalId: params.growthProposalId,
      authorizationId: params.authorizationId,
    },
  });
  await tx.orderItem.createMany({
    data: params.items.map((item) => ({
      orderId: order.id,
      variantId: item.variantId,
      productNameSnapshot: item.productNameSnapshot,
      variantTitleSnapshot: item.variantTitleSnapshot,
      unitPriceMinor: item.unitPriceMinor,
      quantity: item.quantity,
      lineDiscountMinor: item.lineDiscountMinor,
      lineTotalMinor: item.lineTotalMinor,
      currency: item.currency as never,
      source: item.source,
      growthProposalId: item.growthProposalId,
    })),
  });
  return order;
}

export function setOrderFingerprint(tx: Prisma.TransactionClient, orderId: string, orderFingerprint: string, fingerprintVersion: string) {
  return tx.order.update({ where: { id: orderId }, data: { orderFingerprint, fingerprintVersion } });
}

/** PART 07 §52 — order state changes only as a deterministic consequence
 * of a verified payment-state transition, never a client-submitted value. */
export function setOrderStatus(tx: Prisma.TransactionClient, orderId: string, status: "PENDING" | "PAYMENT_PENDING" | "PAID" | "FAILED" | "CANCELLED") {
  return tx.order.update({ where: { id: orderId }, data: { status } });
}

export function findOrderById(prisma: PrismaClient, merchantId: string, orderId: string) {
  return prisma.order.findFirst({ where: { id: orderId, merchantId }, include: { items: true } });
}
