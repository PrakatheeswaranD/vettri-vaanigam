import type { ReadinessSnapshot } from "@prisma/client";
import type { ReadinessBlockerDTO, ReadinessSnapshotDTO } from "@razorgrowth/contracts";

export function toReadinessSnapshotDTO(snapshot: ReadinessSnapshot): ReadinessSnapshotDTO {
  return {
    id: snapshot.id,
    merchantId: snapshot.merchantId,
    overallScore: snapshot.overallScore,
    level: snapshot.level,
    dimensions: {
      catalogCompleteness: snapshot.catalogCompleteness,
      aiDiscoverability: snapshot.aiDiscoverability,
      priceFreshness: snapshot.priceFreshness,
      inventoryReliability: snapshot.inventoryReliability,
      policyCompleteness: snapshot.policyCompleteness,
      checkoutReadiness: snapshot.checkoutReadiness,
      paymentReliability: snapshot.paymentReliability,
      metadataQuality: snapshot.metadataQuality,
      trustInformation: snapshot.trustInformation,
    },
    weakestDimension: snapshot.weakestDimension,
    strongestDimension: snapshot.strongestDimension,
    recommendations: snapshot.recommendations as string[],
    blockers: snapshot.blockers as ReadinessBlockerDTO[],
    strengths: snapshot.strengths as string[],
    evidence: snapshot.evidence as Record<string, number>,
    calculationVersion: snapshot.calculationVersion,
    isSyntheticDemo: snapshot.isSyntheticDemo,
    createdAt: snapshot.createdAt.toISOString(),
  };
}
