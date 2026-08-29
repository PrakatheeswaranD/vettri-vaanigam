/**
 * Agent Action Ledger (PART 00 §20; PART 05 §51-§63, §84-§89). A
 * structured, append-oriented audit trail — never a chat transcript.
 * Selecting a workflow shows its full ordered timeline (Buyer Agent →
 * Merchant Agent → Policy → Approval → Authorization) alongside a
 * restrained tamper-evidence indicator: an application-level hash chain,
 * explicitly NOT a blockchain (PART 05 §63, §130).
 */
import { useState } from "react";
import { ScrollText, ShieldCheck, ShieldX } from "lucide-react";
import { useLedger } from "../hooks/use-api";
import { useWorkflowLedgerVerification, useWorkflowTrace } from "../hooks/use-policy";
import { Card } from "../components/ui/Card";
import { EmptyState, ErrorState, Skeleton } from "../components/ui/States";
import { AgentActionStatusBadge, PolicyDecisionBadge } from "../components/ui/StatusBadge";
import { DemoDataBadge } from "../components/ui/DemoDataBadge";
import { formatDateTime } from "../lib/format";
import { ApiError } from "../lib/api-client";
import { PageHeader } from "../components/layout/PageHeader";

const ACTOR_LABEL: Record<string, string> = {
  BUYER_AGENT: "Buyer Agent",
  MERCHANT_AGENT: "Merchant Agent",
  POLICY_ENGINE: "Policy Engine",
  MERCHANT_USER: "Merchant (human)",
  CUSTOMER: "Customer",
  SYSTEM: "System",
  COMMERCE: "Commerce",
  PAYMENT_SYSTEM: "Payment System",
  RAZORPAY: "Razorpay",
};

const ACTOR_TYPES = ["BUYER_AGENT", "MERCHANT_AGENT", "POLICY_ENGINE", "MERCHANT_USER", "CUSTOMER", "SYSTEM", "COMMERCE", "PAYMENT_SYSTEM", "RAZORPAY"];
const STATUSES = ["PROPOSED", "PENDING_APPROVAL", "APPROVED", "REJECTED", "EXPIRED", "EXECUTED", "FAILED", "VERIFIED"];

function WorkflowTimeline({ workflowId, onClose }: { workflowId: string; onClose: () => void }) {
  const { data, isLoading } = useLedger({ workflowId, limit: 100 });
  const { data: verification, isLoading: isVerifying } = useWorkflowLedgerVerification(workflowId);
  const { data: trace } = useWorkflowTrace(workflowId);
  const events = [...(data?.items ?? [])].sort((a, b) => a.sequence - b.sequence);

  return (
    <Card className="border-brand-200">
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <div>
          <p className="text-sm font-semibold text-ink">Workflow timeline</p>
          <p className="font-mono text-xs text-ink-faint">{workflowId}</p>
        </div>
        <div className="flex items-center gap-2">
          {trace ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-surface-sunken px-2.5 py-1 text-xs font-medium text-ink-muted">
              Financial outcome: {trace.financialOutcome}
            </span>
          ) : null}
          {isVerifying ? null : verification ? (
            <span
              className={
                verification.valid
                  ? "inline-flex items-center gap-1 rounded-full bg-success-subtle px-2.5 py-1 text-xs font-medium text-success-text"
                  : "inline-flex items-center gap-1 rounded-full bg-danger-subtle px-2.5 py-1 text-xs font-medium text-danger-text"
              }
            >
              {verification.valid ? <ShieldCheck size={12} /> : <ShieldX size={12} />}
              Ledger integrity: {verification.valid ? "VERIFIED" : "FAILED"} ({verification.eventCount} events)
            </span>
          ) : null}
          <button type="button" onClick={onClose} className="rounded-md border border-border px-2 py-1 text-xs text-ink-muted hover:bg-surface-subtle">
            Close
          </button>
        </div>
      </div>
      <div className="divide-y divide-border">
        {isLoading ? (
          <div className="p-4">
            <Skeleton className="h-32 w-full" />
          </div>
        ) : (
          events.map((event) => (
            <div key={event.id} className="flex flex-col gap-1 px-5 py-3 sm:flex-row sm:items-start sm:gap-4">
              <span className="w-8 shrink-0 font-mono text-xs text-ink-faint">#{event.sequence}</span>
              <span className="w-40 shrink-0 font-mono text-xs text-ink-faint">{formatDateTime(event.createdAt)}</span>
              <span className="w-32 shrink-0 rounded-full bg-surface-sunken px-2 py-0.5 text-center text-[11px] font-medium text-ink-muted">
                {ACTOR_LABEL[event.actorType] ?? event.actorType}
              </span>
              <div className="flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium text-ink">{event.actionType}</span>
                  {event.policyDecision ? <PolicyDecisionBadge decision={event.policyDecision} /> : null}
                </div>
                <p className="text-sm text-ink-muted">{event.conciseReason}</p>
              </div>
            </div>
          ))
        )}
        {!isLoading && verification && !verification.valid ? (
          <div className="flex items-start gap-2 bg-danger-subtle px-5 py-3 text-sm text-danger-text">
            <ShieldX size={14} className="mt-0.5 shrink-0" />
            Hash-chain verification failed at sequence #{verification.brokenAtSequence} — a persisted event no longer
            matches what was recorded at write time.
          </div>
        ) : null}
      </div>
    </Card>
  );
}

export default function ActionLedgerPage() {
  const [actorType, setActorType] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);

  const { data, isLoading, isError, error, refetch } = useLedger({
    page,
    limit: 20,
    actorType: actorType || undefined,
    status: status || undefined,
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <PageHeader
          title={"Audit Log"}
          lead={"The tamper-evident record, for an auditor. Every entry is chained to the one before it, so a changed or deleted row is detectable."}
        />
        </div>
        <div className="flex gap-2">
          <select
            value={actorType}
            onChange={(e) => {
              setActorType(e.target.value);
              setPage(1);
            }}
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink focus:border-brand-500"
          >
            <option value="">All actors</option>
            {ACTOR_TYPES.map((a) => (
              <option key={a} value={a}>
                {ACTOR_LABEL[a]}
              </option>
            ))}
          </select>
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink focus:border-brand-500"
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace("_", " ")}
              </option>
            ))}
          </select>
        </div>
      </div>

      {selectedWorkflowId ? (
        <WorkflowTimeline workflowId={selectedWorkflowId} onClose={() => setSelectedWorkflowId(null)} />
      ) : null}

      {isLoading ? (
        <Skeleton className="h-96 w-full" />
      ) : isError ? (
        <Card>
          <ErrorState
            message={error instanceof ApiError ? error.message : "Could not load the action ledger."}
            onRetry={() => refetch()}
          />
        </Card>
      ) : !data || data.items.length === 0 ? (
        <Card>
          <EmptyState icon={<ScrollText size={18} />} title="No agent actions have been recorded" description="Actions will appear here as buyer and merchant agent workflows run." />
        </Card>
      ) : (
        <>
          <div className="space-y-2">
            {data.items.map((action) => (
              <Card key={action.id}>
                <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-mono text-ink-faint">{formatDateTime(action.createdAt)}</span>
                      <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-[11px] font-medium text-ink-muted">
                        {ACTOR_LABEL[action.actorType] ?? action.actorType}
                      </span>
                      <span className="text-xs font-medium text-ink">{action.actionType}</span>
                      <AgentActionStatusBadge status={action.status} />
                      {action.policyDecision ? <PolicyDecisionBadge decision={action.policyDecision} /> : null}
                      {action.isSyntheticDemo ? <DemoDataBadge /> : null}
                    </div>
                    <p className="text-sm text-ink-muted">{action.conciseReason}</p>
                    <button
                      type="button"
                      onClick={() => setSelectedWorkflowId(action.workflowId)}
                      className="text-[11px] font-mono text-brand-600 hover:underline"
                    >
                      workflow {action.workflowId.slice(0, 8)} · #{action.sequence} — view timeline
                    </button>
                  </div>
                </div>
              </Card>
            ))}
          </div>

          <div className="flex items-center justify-between text-sm text-ink-muted">
            <span>
              Page {data.pagination.page} of {data.pagination.totalPages} · {data.pagination.total} actions
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded-md border border-border px-3 py-1.5 disabled:opacity-40"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={page >= data.pagination.totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="rounded-md border border-border px-3 py-1.5 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
