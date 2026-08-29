import type { PrismaClient } from "@prisma/client";

export function findMerchantUserByEmail(prisma: PrismaClient, email: string) {
  return prisma.merchantUser.findUnique({ where: { email } });
}

export function findMerchantUserById(prisma: PrismaClient, id: string) {
  return prisma.merchantUser.findUnique({ where: { id } });
}
