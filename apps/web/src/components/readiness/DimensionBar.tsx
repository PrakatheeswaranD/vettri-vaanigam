import { clsx } from "clsx";

function toneForScore(score: number): string {
  if (score >= 85) return "bg-success";
  if (score >= 70) return "bg-warning";
  return "bg-danger";
}

export function DimensionBar({ label, score }: { label: string; score: number }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-ink-muted">{label}</span>
        <span className="font-medium text-ink">{score}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken">
        <div
          className={clsx("h-full rounded-full transition-all", toneForScore(score))}
          style={{ width: `${Math.max(0, Math.min(100, score))}%` }}
        />
      </div>
    </div>
  );
}
