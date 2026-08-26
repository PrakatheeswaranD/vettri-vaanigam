import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient, ReadinessSnapshot } from "@prisma/client";
import type { ReadinessAssessmentResponseDTO, ReadinessDeltaDTO, ReadinessSnapshotDTO } from "@razorgrowth/contracts";
import { READINESS_DIMENSIONS } from "@razorgrowth/domain";
import { AppError } from "../../http/errors.js";
import { logger } from "../../observability/logger.js";
import { appendLedgerEvent } from "../audit/ledger.js";
import { createSnapshot, findLatestSnapshot, findPreviousSnapshot, listSnapshotHistory } from "./repository.js";
import { toReadinessSnapshotDTO } from "./mapper.js";
import { runReadinessAssessment } from "./engine.js";

function computeDelta(current: ReadinessSnapshot, previous: ReadinessSnapshot | null): ReadinessDeltaDTO | null {
  if (!previous) return null;
  const dimensionDeltas: Record<string, number> = {};
  for (const dimension of READINESS_DIMENSIONS) {
    dimensionDeltas[dimension] = current[dimension] - previous[dimension];
  }
  return {
    overallScoreDelta: current.overallScore - previous.overallScore,
    dimensionDeltas,
    previousSnapshotAt: previous.createdAt.toISOString(),
  };
}

async function withDelta(prisma: PrismaClient, snapshot: ReadinessSnapshot): Promise<ReadinessAssessmentResponseDTO> {
  const previous = await findPreviousSnapshot(prisma, snapshot.merchantId, snapshot.id);
  return {
    snapshot: toReadinessSnapshotDTO(snapshot),
    delta: computeDelta(snapshot, previous),
  };
}

export async function getLatestReadiness(
  prisma: PrismaClient,
  merchantId: string,
): Promise<ReadinessAssessmentResponseDTO> {
  const snapshot = await findLatestSnapshot(prisma, merchantId);
  if (!snapshot) {
    throw AppError.notFound("Readiness has not been calculated yet for this merchant.");
  }
  return withDelta(prisma, snapshot);
}

/**
 * PART 02 §41 — chosen idempotency model: an explicit recalculation
 * ALWAYS creates a new timestamped snapshot (no silent dedup). This is
 * the simplest defensible model and keeps history meaningful — every
 * entry represents an actual recalculation event, not a cache.
 */
export async function recalculateReadiness(
  prisma: PrismaClient,
  merchantId: string,
): Promise<ReadinessAssessmentResponseDTO> {
  const startedAt = Date.now();
  const assessment = await runReadinessAssessment(prisma, merchantId);

  const snapshot = await createSnapshot(prisma, {
    merchantId,
    overallScore: assessment.overallScore,
    level: assessment.level,
    catalogCompleteness: assessment.dimensions.catalogCompleteness,
    aiDiscoverability: assessment.dimensions.aiDiscoverability,
    priceFreshness: assessment.dimensions.priceFreshness,
    inventoryReliability: assessment.dimensions.inventoryReliability,
    policyCompleteness: assessment.dimensions.policyCompleteness,
    checkoutReadiness: assessment.dimensions.checkoutReadiness,
    paymentReliability: assessment.dimensions.paymentReliability,
    metadataQuality: assessment.dimensions.metadataQuality,
    trustInformation: assessment.dimensions.trustInformation,
    weakestDimension: assessment.weakestDimension,
    strongestDimension: assessment.strongestDimension,
    recommendations: assessment.recommendations,
    blockers: assessment.blockers as unknown as Prisma.InputJsonValue,
    strengths: assessment.strengths,
    evidence: assessment.evidence,
    calculationVersion: assessment.calculationVersion,
    isSyntheticDemo: assessment.isSyntheticDemo,
  });

  // PART 02 §95 — audit event for the recalculation itself. Actor is
  // SYSTEM, not MERCHANT_AGENT: no AI participated in this deterministic
  // calculation, and the ledger must not misrepresent that.
  await appendLedgerEvent(prisma, {
    workflowId: randomUUID(),
    merchantId,
    actorType: "SYSTEM",
    actionType: "READINESS_CALCULATED",
    status: "EXECUTED",
    conciseReason: `Recalculated Agentic Readiness: ${assessment.overallScore}/100 (${assessment.level}), weakest dimension: ${assessment.weakestDimension}.`,
    relatedEntityType: "ReadinessSnapshot",
    relatedEntityId: snapshot.id,
    isSyntheticDemo: assessment.isSyntheticDemo,
    executedAt: new Date(),
  });

  // PART 02 §93-§94 — structured operational logging, no full catalog dump.
  logger.info(
    {
      event: "readiness.calculated",
      merchantId,
      calculationVersion: assessment.calculationVersion,
      overallScore: assessment.overallScore,
      level: assessment.level,
      durationMs: Date.now() - startedAt,
    },
    "readiness recalculated",
  );

  return withDelta(prisma, snapshot);
}

export async function getReadinessHistory(
  prisma: PrismaClient,
  merchantId: string,
  limit: number,
): Promise<ReadinessSnapshotDTO[]> {
  const snapshots = await listSnapshotHistory(prisma, merchantId, limit);
  return snapshots.map(toReadinessSnapshotDTO);
}
