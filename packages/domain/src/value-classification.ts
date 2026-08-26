/**
 * Revenue/value classification (PART 00 §19, §29, §78).
 *
 * Every monetary figure shown to a merchant or judge must be tagged with
 * exactly one of these. Mixing them — e.g. presenting an ESTIMATED number
 * where OBSERVED is implied — is the fabrication PART 00 §41 forbids.
 */
export const VALUE_CLASSIFICATIONS = ["OBSERVED", "ESTIMATED", "OPPORTUNITY"] as const;
export type ValueClassification = (typeof VALUE_CLASSIFICATIONS)[number];

export const VALUE_CLASSIFICATION_LABEL: Record<ValueClassification, string> = {
  OBSERVED: "Observed",
  ESTIMATED: "Estimated Incremental",
  OPPORTUNITY: "Potential Opportunity",
};

/** Data provenance (PART 00 §17, §23; PART 01 §23). */
export const DATA_PROVENANCE = ["MERCHANT_AUTHORED", "SYSTEM_DERIVED", "AI_GENERATED", "SYNTHETIC_DEMO"] as const;
export type DataProvenance = (typeof DATA_PROVENANCE)[number];
