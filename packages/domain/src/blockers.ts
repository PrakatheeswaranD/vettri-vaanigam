/**
 * Readiness blocker model (PART 02 §37, §38, §98).
 *
 * Blockers are produced by the application-layer `AgenticReadinessEngine`
 * from real evidence — this module only defines the shape and the
 * deterministic prioritization rule so ordering is centralized, tested,
 * and never left to the LLM (PART 02 §37: "Do not let the LLM invent
 * severity").
 */
import type { ReadinessDimension } from "./readiness.js";

export const BLOCKER_SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;
export type BlockerSeverity = (typeof BLOCKER_SEVERITIES)[number];

const SEVERITY_RANK: Record<BlockerSeverity, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};

export interface ReadinessBlocker {
  dimension: ReadinessDimension;
  severity: BlockerSeverity;
  code: string;
  title: string;
  explanation: string;
  affectedCount: number;
  totalCount: number;
  remediation: string;
}

/**
 * Sort blockers by severity first (CRITICAL before LOW), then by the
 * number of affected products/variants (bigger impact first) within the
 * same severity, then by dimension declaration order for full
 * determinism on ties (PART 02 §38, §98 — critical transaction blockers
 * before metadata polish, never alphabetical).
 */
export function prioritizeBlockers(blockers: readonly ReadinessBlocker[]): ReadinessBlocker[] {
  return [...blockers].sort((a, b) => {
    const severityDelta = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (severityDelta !== 0) return severityDelta;
    const affectedDelta = b.affectedCount - a.affectedCount;
    if (affectedDelta !== 0) return affectedDelta;
    return a.code.localeCompare(b.code);
  });
}
