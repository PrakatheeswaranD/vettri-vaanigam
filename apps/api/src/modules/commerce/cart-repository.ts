import type { Prisma, PrismaClient } from "@prisma/client";

export interface CreateCartItemInput {
  variantId: string;
  quantity: number;
  unitPriceMinor: number;
  lineDiscountMinor: number;
  currency: string;
  source: string;
  growthProposalId: string | null;
}

export async function createCartWithItems(
  tx: Prisma.TransactionClient,
  params: {
    id: string;
    merchantId: string;
    customerId: string | null;
    currency: string;
    items: CreateCartItemInput[];
  },
) {
  const cart = await tx.cart.create({
    data: {
      id: params.id,
      merchantId: params.merchantId,
      customerId: params.customerId,
      currency: params.currency as never,
      status: "ACTIVE",
    },
  });
  await tx.cartItem.createMany({
    data: params.items.map((item) => ({
      cartId: cart.id,
      variantId: item.variantId,
      quantity: item.quantity,
      unitPriceMinor: item.unitPriceMinor,
      lineDiscountMinor: item.lineDiscountMinor,
      currency: item.currency as never,
      source: item.source,
      growthProposalId: item.growthProposalId,
    })),
  });
  return cart;
}

export function updateCartStatus(tx: Prisma.TransactionClient, cartId: string, status: "ACTIVE" | "CHECKOUT_PENDING" | "CONVERTED" | "EXPIRED" | "ABANDONED") {
  return tx.cart.update({ where: { id: cartId }, data: { status } });
}

export function findCartById(prisma: PrismaClient, merchantId: string, cartId: string) {
  return prisma.cart.findFirst({ where: { id: cartId, merchantId }, include: { items: true } });
}
