/**
 * A score with its working shown.
 *
 * A bare "Revenue Growth Score: 32" is worse than no score — it invites a
 * merchant to either feel bad or dismiss it, and offers no way to check
 * whether it means anything. So the components are always visible, each
 * with the fact that earned it and the specific thing that would earn the
 * rest. The number at the top is only a summary of the rows beneath it,
 * and a reader can add them up.
 */
import { clsx } from "clsx";
import { ArrowRight } from "lucide-react";
import type { CompositeScoreDTO } from "@razorgrowth/contracts";
import { Card, CardBody, CardHeader, CardTitle } from "../ui/Card";

function bandColour(score: number): string {
  if (score >= 70) return "text-success";
  if (score >= 40) return "text-warning";
  return "text-danger";
}

export function CompositeScorePanel({
  title,
  lead,
  score,
}: {
  title: string;
  /** One sentence on what the score measures, and what it deliberately
   * does not — a score without stated limits reads as a verdict. */
  lead: string;
  score: CompositeScoreDTO;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <CardTitle>{title}</CardTitle>
            <p className="mt-1 text-xs leading-relaxed text-ink-muted">{lead}</p>
          </div>
          <div className="shrink-0 text-right">
            <p className={clsx("text-3xl font-bold tabular-nums leading-none", bandColour(score.score))}>{score.score}</p>
            <p className="mt-1 text-[11px] text-ink-faint">out of 100</p>
          </div>
        </div>
      </CardHeader>
      <CardBody>
        <ul className="space-y-3">
          {score.components.map((component) => {
            const pct = component.max > 0 ? Math.round((component.earned * 100) / component.max) : 0;
            return (
              <li key={component.key}>
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-xs font-medium text-ink">{component.label}</p>
                  <p className="shrink-0 text-xs font-semibold tabular-nums text-ink-muted">
                    {component.earned}
                    <span className="text-ink-faint"> / {component.max}</span>
                  </p>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-sunken">
                  <div
                    className={clsx(
                      "h-full rounded-full",
                      pct >= 70 ? "bg-success" : pct >= 40 ? "bg-warning" : "bg-danger",
                    )}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="mt-1 text-[11px] leading-snug text-ink-muted">{component.evidence}</p>
                {component.toImprove ? (
                  <p className="mt-1 inline-flex items-start gap-1 text-[11px] leading-snug text-brand-600">
                    <ArrowRight size={11} className="mt-0.5 shrink-0" aria-hidden />
                    {component.toImprove}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      </CardBody>
    </Card>
  );
}
