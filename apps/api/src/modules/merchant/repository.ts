import type { PrismaClient } from "@prisma/client";

export function findMerchantById(prisma: PrismaClient, merchantId: string) {
  return prisma.merchant.findUniqueOrThrow({ where: { id: merchantId } });
}

export function findMerchantPolicy(prisma: PrismaClient, merchantId: string) {
  return prisma.merchantPolicy.findUniqueOrThrow({ where: { merchantId } });
}

export async function computeMerchantStats(prisma: PrismaClient, merchantId: string) {
  const [productCount, orderCount, capturedPayments, failedPayments, outOfStockVariants] = await Promise.all([
    prisma.product.count({ where: { merchantId, status: "ACTIVE" } }),
    prisma.order.count({ where: { merchantId } }),
    prisma.payment.count({ where: { order: { merchantId }, state: "CAPTURED" } }),
    prisma.payment.count({ where: { order: { merchantId }, state: "FAILED" } }),
    prisma.inventory.count({ where: { variant: { product: { merchantId } }, availableQuantity: 0 } }),
  ]);
  return { productCount, orderCount, capturedPayments, failedPayments, outOfStockVariants };
}
