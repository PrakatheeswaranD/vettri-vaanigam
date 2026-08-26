import { z } from "zod";

const dimensionScoreSchema = z.number().min(0).max(100);

export const readinessLevelSchema = z.enum(["AGENT_READY", "NEARLY_READY", "PARTIALLY_READY", "NOT_READY"]);
export const blockerSeveritySchema = z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]);

export const readinessBlockerSchema = z.object({
  dimension: z.string(),
  severity: blockerSeveritySchema,
  code: z.string(),
  title: z.string(),
  explanation: z.string(),
  affectedCount: z.number().int().min(0),
  totalCount: z.number().int().min(0),
  remediation: z.string(),
});
export type ReadinessBlockerDTO = z.infer<typeof readinessBlockerSchema>;

export const readinessSnapshotSchema = z.object({
  id: z.string().uuid(),
  merchantId: z.string().uuid(),
  overallScore: dimensionScoreSchema,
  level: readinessLevelSchema,
  dimensions: z.object({
    catalogCompleteness: dimensionScoreSchema,
    aiDiscoverability: dimensionScoreSchema,
    priceFreshness: dimensionScoreSchema,
    inventoryReliability: dimensionScoreSchema,
    policyCompleteness: dimensionScoreSchema,
    checkoutReadiness: dimensionScoreSchema,
    paymentReliability: dimensionScoreSchema,
    metadataQuality: dimensionScoreSchema,
    trustInformation: dimensionScoreSchema,
  }),
  weakestDimension: z.string(),
  strongestDimension: z.string(),
  recommendations: z.array(z.string()),
  blockers: z.array(readinessBlockerSchema),
  strengths: z.array(z.string()),
  /** Evidence counters the engine used (PART 02 §32, §46) — e.g.
   * activeProductCount, productsMissingReturnPolicy. */
  evidence: z.record(z.string(), z.number()),
  calculationVersion: z.string(),
  isSyntheticDemo: z.boolean(),
  createdAt: z.string().datetime(),
});
export type ReadinessSnapshotDTO = z.infer<typeof readinessSnapshotSchema>;

export const readinessDeltaSchema = z.object({
  overallScoreDelta: z.number(),
  dimensionDeltas: z.record(z.string(), z.number()),
  previousSnapshotAt: z.string().datetime(),
});
export type ReadinessDeltaDTO = z.infer<typeof readinessDeltaSchema>;

export const readinessAssessmentResponseSchema = z.object({
  snapshot: readinessSnapshotSchema,
  delta: readinessDeltaSchema.nullable(),
});
export type ReadinessAssessmentResponseDTO = z.infer<typeof readinessAssessmentResponseSchema>;

export const readinessHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
