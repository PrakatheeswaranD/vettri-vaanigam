/**
 * Trust Trace (§13-§21, §212) — the single most important screen in the
 * product. It answers, for one real workflow: what happened, who
 * decided it, what was AI-generated vs. deterministic vs. human-gated
 * vs. provider-verified, and can the audit trail be trusted. Built
 * entirely from the real `/action-ledger/workflows/:id/trace` endpoint
 * (PART 08) — no second financial state model, no hardcoded status.
 */
import { useMemo, useState } from "react";
import { ShieldCheck, ShieldX, Sparkles } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { useLedger } from "../hooks/use-api";
import { useWorkflowTrace } from "../hooks/use-policy";
import { Card, CardBody, CardHeader, CardTitle } from "../components/ui/Card";
import { EmptyState, ErrorState, Skeleton } from "../components/ui/States";
import { DemoDataBadge } from "../components/ui/DemoDataBadge";
import { ApiError } from "../lib/api-client";
import { TrustTracePipeline } from "../features/trust-trace/TrustTracePipeline";
import { TrustTraceDetailDrawer } from "../features/trust-trace/TrustTraceDetailDrawer";
import { FinancialAuthorityStrip } from "../features/trust-trace/FinancialAuthorityStrip";
import { GrowthEffectPanel } from "../features/trust-trace/GrowthEffectPanel";
import { TrustBoundaryLegend } from "../features/trust-trace/ActorClassBadge";
import { ACTION_GROUP, buildTrustTraceModel } from "../features/trust-trace/model";
import { PageHeader } from "../components/layout/PageHeader";

const OUTCOME_LABEL: Record<string, string> = {
  PENDING: "Pending",
  FAILED: "Failed",
  RECOVERED: "Recovered",
  CAPTURED: "Captured",
};

export default function TrustTracePage() {
  const { data: recent } = useLedger({ limit: 50 });

  /**
   * Recent workflows, ORDER TRAILS FIRST.
   *
   * Not every ledger workflow is a purchase. A readiness recalculation or
   * a growth scan writes a single event under its own workflow id, and
   * those are frequently the newest rows — so a page called "Order Trail"
   * opened on a workflow with no order in it, every stage reading "Not
   * Reached", above a note explaining that its one event is not part of
   * this view. Correct, and a terrible first impression of the feature.
   *
   * Workflows carrying at least one pipeline event are listed first, so
   * the default selection is an actual order trail. Nothing is hidden —
   * single-event workflows still appear, just below the ones this page
   * can actually draw.
   */
  const recentWorkflowIds = useMemo(() => {
    const events = new Map<string, string[]>();
    for (const item of recent?.items ?? []) {
      const list = events.get(item.workflowId) ?? [];
      list.push(item.actionType);
      events.set(item.workflowId, list);
    }
    const pipelineEvents = (id: string) =>
      (events.get(id) ?? []).filter((actionType) => actionType in ACTION_GROUP).length;
    // Fullest trail first. Ordering only by "has any pipeline event" still
    // opened on a lone GROWTH_PROPOSAL_CREATED — one stage lit, five
    // reading "Not Reached". The workflow that best demonstrates the page
    // is the one that got furthest through it.
    return [...events.keys()].sort((a, b) => pipelineEvents(b) - pipelineEvents(a));
  }, [recent]);

  const [searchParams] = useSearchParams();
  const linkedWorkflowId = searchParams.get("workflowId");
  const [workflowId, setWorkflowId] = useState<string | null>(null);
  const [workflowInput, setWorkflowInput] = useState("");
  const activeWorkflowId = workflowId ?? linkedWorkflowId ?? recentWorkflowIds[0] ?? null;
  const [selectedStageId, setSelectedStageId] = useState<string | null>(null);

  const { data: trace, isLoading, isError, error, refetch } = useWorkflowTrace(activeWorkflowId);
  const model = trace ? buildTrustTraceModel(trace) : null;
  const selectedStage = model?.stages.find((s) => s.id === selectedStageId) ?? null;

  return (
    <div className="space-y-6">
      <div>
        <PageHeader
          title={"Order Trail"}
          lead={"Follow a single order end to end: what was asked, which rule decided it, who approved it, and what the payment provider confirmed."}
        />
      </div>

      <FinancialAuthorityStrip />

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Workflow</CardTitle>
            <p className="mt-0.5 font-mono text-xs text-ink-faint">{activeWorkflowId ?? "no workflow selected"}</p>
          </div>
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (workflowInput.trim()) setWorkflowId(workflowInput.trim());
            }}
          >
            <input
              type="text"
              value={workflowInput}
              onChange={(e) => setWorkflowInput(e.target.value)}
              placeholder="Paste a workflow ID…"
              className="w-56 rounded-md border border-border px-2.5 py-1.5 text-xs text-ink placeholder:text-ink-faint focus:border-brand-500 focus:outline-none"
            />
            <button type="submit" className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface-subtle">
              Open
            </button>
          </form>
        </CardHeader>
        <CardBody className="flex flex-wrap gap-2">
          {recentWorkflowIds.length === 0 ? (
            <p className="text-sm text-ink-muted">No workflows yet — run the demo from the Agent Gateway page to create one.</p>
          ) : (
            recentWorkflowIds.slice(0, 8).map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setWorkflowId(id);
                  setSelectedStageId(null);
                }}
                className={
                  "rounded-full border px-3 py-1 font-mono text-[11px] " +
                  (id === activeWorkflowId ? "border-brand-500 bg-brand-50 text-brand-700" : "border-border text-ink-muted hover:bg-surface-subtle")
                }
              >
                {id.slice(0, 8)}…
              </button>
            ))
          )}
        </CardBody>
      </Card>

      {!activeWorkflowId ? (
        <Card>
          <CardBody>
            <EmptyState
              title="No workflow to trace yet"
              description="Run the demo from the Agent Gateway page — a Trust Trace appears the moment a governed workflow exists."
              icon={<Sparkles size={18} />}
            />
          </CardBody>
        </Card>
      ) : isLoading ? (
        <Card>
          <CardBody>
            <Skeleton className="h-40 w-full" />
          </CardBody>
        </Card>
      ) : isError ? (
        <Card>
          <CardBody>
            <ErrorState message={error instanceof ApiError ? error.message : "Could not load this workflow's trace."} onRetry={() => void refetch()} />
          </CardBody>
        </Card>
      ) : model ? (
        <>
          <Card>
            <CardHeader className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle>Governance chain</CardTitle>
              <div className="flex items-center gap-2">
                <DemoDataBadge />
                <span className="rounded-full bg-surface-sunken px-2.5 py-1 text-xs font-medium text-ink-muted">
                  Financial outcome: {OUTCOME_LABEL[model.financialOutcome] ?? model.financialOutcome}
                </span>
                <span
                  className={
                    "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium " +
                    (model.ledgerIntegrity.valid ? "bg-success-subtle text-success-text" : "bg-danger-subtle text-danger-text")
                  }
                >
                  {model.ledgerIntegrity.valid ? <ShieldCheck size={12} /> : <ShieldX size={12} />}
                  Ledger integrity: {model.ledgerIntegrity.valid ? "VERIFIED" : "FAILED"} ({model.ledgerIntegrity.eventCount} events)
                </span>
              </div>
            </CardHeader>
            <CardBody>
              <TrustTracePipeline stages={model.stages} selectedStageId={selectedStageId} onSelectStage={setSelectedStageId} />
              <div className="mt-4 border-t border-border pt-3">
                <TrustBoundaryLegend />
              </div>
            </CardBody>
          </Card>

          {trace?.growthEffect ? <GrowthEffectPanel effect={trace.growthEffect} /> : null}

          {selectedStage ? <TrustTraceDetailDrawer stage={selectedStage} onClose={() => setSelectedStageId(null)} /> : null}

          {model.unrecognizedEvents.length > 0 ? (
            <Card>
              <CardBody>
                <p className="text-xs text-ink-muted">
                  {model.unrecognizedEvents.length} ledger event(s) on this workflow use an actionType this view does not yet
                  recognize — shown here rather than silently dropped: {model.unrecognizedEvents.map((e) => e.event).join(", ")}.
                </p>
              </CardBody>
            </Card>
          ) : null}

          <p className="text-xs text-ink-faint">
            Want to try to break it? <Link to="/merchant/governance/sandbox" className="font-medium text-brand-600 hover:underline">Open Break the Agent</Link>.
          </p>
        </>
      ) : null}
    </div>
  );
}
