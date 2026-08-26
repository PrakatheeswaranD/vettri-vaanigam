/**
 * The governance chain (§10, §15, §103): a responsive pipeline of real
 * workflow stages. Desktop renders a horizontal chain with connectors;
 * mobile collapses to a vertical chain — same semantic order, never
 * shrunk illegibly. Every status comes from `buildTrustTraceModel`
 * (§16) — nothing here decides a stage's outcome.
 */
import { clsx } from "clsx";
import type { TrustTraceStage } from "./model";
import { STAGE_STATUS_SPEC } from "./stage-status";
import { ActorClassBadge } from "./ActorClassBadge";

export function TrustTracePipeline({
  stages,
  selectedStageId,
  onSelectStage,
}: {
  stages: TrustTraceStage[];
  selectedStageId: string | null;
  onSelectStage: (stageId: string) => void;
}) {
  return (
    <div className="flex flex-col gap-0 overflow-x-auto sm:flex-row sm:items-start sm:gap-0 sm:pb-2" data-tour-id="trust-trace-pipeline">
      {stages.map((stage, index) => {
        const spec = STAGE_STATUS_SPEC[stage.status];
        const Icon = spec.icon;
        const isSelected = stage.id === selectedStageId;
        return (
          <div key={stage.id} className="flex sm:flex-1 sm:min-w-[9.5rem] flex-col">
            <div className="flex items-stretch sm:flex-col">
              <div className="flex flex-col items-center sm:w-full">
                <div className="flex items-center sm:w-full">
                  {/* connector before (desktop: horizontal line to the left; mobile: vertical line above) */}
                  <span className={clsx("hidden h-px flex-1 sm:block", index === 0 ? "sm:invisible" : "bg-border-strong")} />
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onSelectStage(stage.id)}
              aria-current={isSelected ? "step" : undefined}
              className={clsx(
                "flex w-full items-start gap-3 rounded-md border px-3 py-2.5 text-left transition-colors sm:mx-1 sm:flex-col sm:items-center sm:gap-1.5 sm:text-center",
                isSelected ? "border-brand-500 bg-brand-50" : "border-border bg-surface hover:bg-surface-subtle",
              )}
            >
              <span className={clsx("flex h-7 w-7 shrink-0 items-center justify-center rounded-full", spec.dotClassName)}>
                <Icon size={14} />
              </span>
              <span className="flex flex-col sm:items-center">
                <span className="text-xs font-semibold text-ink">{stage.label}</span>
                <span className={clsx("mt-0.5 inline-flex w-fit items-center rounded-full px-2 py-0.5 text-[10px] font-medium", spec.badgeClassName)}>
                  {spec.label}
                </span>
                {stage.actorClass ? (
                  <span className="mt-1">
                    <ActorClassBadge actorClass={stage.actorClass} />
                  </span>
                ) : null}
              </span>
            </button>
            {/* connector after, mobile only (vertical line down to next node) */}
            {index < stages.length - 1 ? <div className="ml-[2.1rem] h-3 w-px bg-border-strong sm:hidden" /> : null}
          </div>
        );
      })}
    </div>
  );
}
