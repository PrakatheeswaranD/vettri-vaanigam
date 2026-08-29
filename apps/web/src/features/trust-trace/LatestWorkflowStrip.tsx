/**
 * Compact "what happened in the latest commerce workflow" strip for the
 * Overview command center — the same real Trust Trace model, condensed
 * to a single row of stage dots, never a second summary of workflow
 * state invented for this page.
 */
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { useLedger } from "../../hooks/use-api";
import { useWorkflowTrace } from "../../hooks/use-policy";
import { buildTrustTraceModel } from "./model";
import { STAGE_STATUS_SPEC } from "./stage-status";
import { Skeleton, EmptyState } from "../../components/ui/States";
import { Sparkles } from "lucide-react";

export function LatestWorkflowStrip() {
  const ledger = useLedger({ limit: 1 });
  const latestWorkflowId = ledger.data?.items[0]?.workflowId ?? null;
  const trace = useWorkflowTrace(latestWorkflowId);
  const model = trace.data ? buildTrustTraceModel(trace.data) : null;

  if (ledger.isLoading || (latestWorkflowId && trace.isLoading)) {
    return <Skeleton className="h-16 w-full" />;
  }

  if (!latestWorkflowId || !model) {
    return (
      <EmptyState
        icon={<Sparkles size={18} />}
        title="No commerce workflow yet"
        description="Run the demo from the Agent Gateway page to create one."
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-1 gap-y-2">
        {model.stages.map((stage, i) => (
          <span key={stage.id} className="flex items-center gap-1">
            <span
              className={
                "inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-medium " +
                STAGE_STATUS_SPEC[stage.status].badgeClassName
              }
              title={stage.status}
            >
              <span className={"h-1.5 w-1.5 rounded-full " + STAGE_STATUS_SPEC[stage.status].dotClassName} />
              {stage.label}
            </span>
            {i < model.stages.length - 1 ? <span className="text-ink-faint">›</span> : null}
          </span>
        ))}
      </div>
      <Link
        to={`/trust-trace?workflowId=${latestWorkflowId}`}
        className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700"
      >
        Open Trust Trace <ArrowRight size={12} />
      </Link>
    </div>
  );
}
