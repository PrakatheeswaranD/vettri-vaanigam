import type { Prisma, PrismaClient } from "@prisma/client";

export function findLatestSnapshot(prisma: PrismaClient, merchantId: string) {
  return prisma.readinessSnapshot.findFirst({
    where: { merchantId },
    orderBy: { createdAt: "desc" },
  });
}

/** The snapshot immediately before the latest one — used to compute a
 * delta (PART 02 §39, §101). */
export async function findPreviousSnapshot(prisma: PrismaClient, merchantId: string, beforeId: string) {
  const latest = await prisma.readinessSnapshot.findUnique({ where: { id: beforeId }, select: { createdAt: true } });
  if (!latest) return null;
  return prisma.readinessSnapshot.findFirst({
    where: { merchantId, createdAt: { lt: latest.createdAt } },
    orderBy: { createdAt: "desc" },
  });
}

export function listSnapshotHistory(prisma: PrismaClient, merchantId: string, limit: number) {
  return prisma.readinessSnapshot.findMany({
    where: { merchantId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export function createSnapshot(prisma: PrismaClient, data: Prisma.ReadinessSnapshotUncheckedCreateInput) {
  return prisma.readinessSnapshot.create({ data });
}
