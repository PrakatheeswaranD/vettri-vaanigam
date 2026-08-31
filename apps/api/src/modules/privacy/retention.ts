import { Prisma, type PrismaClient } from "@prisma/client";
import { env } from "../../config/env.js";
import { logger } from "../../observability/logger.js";

export async function runRetentionSweep(prisma: PrismaClient, now = new Date()) {
  const cutoff = new Date(now.getTime() - env.DATA_RETENTION_DAYS * 24 * 60 * 60 * 1_000);
  const idempotencyCutoff = new Date(
    now.getTime() - env.FINANCIAL_IDEMPOTENCY_RETENTION_DAYS * 24 * 60 * 60 * 1_000,
  );
  const [decisions, acpSessions, delegatedPayments, idempotencyRecords, userSessions] = await prisma.$transaction([
    prisma.decisionRecord.updateMany({
      where: {
        createdAt: { lt: cutoff },
      },
      data: { rawProtocolPayload: Prisma.DbNull, buyerEmail: null, buyerName: null },
    }),
    prisma.acpCheckoutSession.updateMany({
      where: { createdAt: { lt: cutoff } },
      data: { buyerEmail: null, buyerName: null, allowance: Prisma.DbNull, riskSignals: Prisma.DbNull },
    }),
    prisma.acpDelegatedPayment.deleteMany({
      where: { expiresAt: { lt: cutoff }, status: { in: ["CONSUMED", "REVOKED"] } },
    }),
    // Financial replay evidence outlives PII. Deleting it on the privacy
    // schedule could make a late retry execute a second money action.
    prisma.idempotencyRecord.deleteMany({ where: { createdAt: { lt: idempotencyCutoff } } }),
    prisma.session.deleteMany({ where: { expiresAt: { lt: now } } }),
  ]);
  return {
    cutoff,
    decisionsRedacted: decisions.count,
    acpSessionsRedacted: acpSessions.count,
    delegatedPaymentsDeleted: delegatedPayments.count,
    idempotencyRecordsDeleted: idempotencyRecords.count,
    userSessionsDeleted: userSessions.count,
  };
}

export function startRetentionSweeper(prisma: PrismaClient): () => void {
  // Starting a development API against a connected database must not
  // silently delete sessions or redact historical records. Opt in explicitly.
  if (!env.RETENTION_SWEEPER_ENABLED) return () => {};
  const sweep = () => {
    void runRetentionSweep(prisma).then(
      (result) => logger.info({ event: "privacy.retention_sweep", ...result }, "Retention sweep completed"),
      (error) => logger.error({ event: "privacy.retention_sweep_failed", err: error }, "Retention sweep failed"),
    );
  };
  sweep();
  const timer = setInterval(sweep, env.RETENTION_SWEEP_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}
