import { clsx } from "clsx";
import type { ReadinessBlockerDTO } from "@razorgrowth/contracts";
import { READINESS_DIMENSION_LABEL, type ReadinessDimension } from "@razorgrowth/domain";

const SEVERITY_CONFIG: Record<string, { label: string; className: string }> = {
  CRITICAL: { label: "Critical", className: "bg-danger-subtle text-danger-text border-danger/30" },
  HIGH: { label: "High", className: "bg-danger-subtle text-danger-text border-danger/20" },
  MEDIUM: { label: "Medium", className: "bg-warning-subtle text-warning-text border-warning/20" },
  LOW: { label: "Low", className: "bg-surface-sunken text-ink-muted border-border" },
};

/** PART 02 §64, §98 — prioritized, evidence-backed, never alphabetical. */
export function BlockerCard({ blocker, rank }: { blocker: ReadinessBlockerDTO; rank: number }) {
  const severity = SEVERITY_CONFIG[blocker.severity] ?? SEVERITY_CONFIG.LOW!;
  const dimensionLabel =
    READINESS_DIMENSION_LABEL[blocker.dimension as ReadinessDimension] ?? blocker.dimension;

  return (
    <div className={clsx("rounded-card border px-4 py-3", severity.className)}>
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold">
          {rank}. {severity.label}
        </span>
        <span className="text-xs opacity-70">{dimensionLabel}</span>
        {blocker.totalCount > 0 ? (
          <span className="ml-auto text-xs opacity-70">
            {blocker.affectedCount} of {blocker.totalCount} affected
          </span>
        ) : null}
      </div>
      <p className="text-sm font-medium">{blocker.title}</p>
      <p className="mt-1 text-sm opacity-90">{blocker.explanation}</p>
      <p className="mt-2 text-xs font-medium opacity-80">Fix: {blocker.remediation}</p>
    </div>
  );
}
