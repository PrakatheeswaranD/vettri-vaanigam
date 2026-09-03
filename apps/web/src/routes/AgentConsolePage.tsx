/**
 * 🤖 Merchant Agent → Console — what the agent is doing, and the button
 * that makes it do it.
 *
 * WHAT THIS ADDS THAT DID NOT EXIST
 *
 * Every stage of the agent's loop was implemented and none of it was
 * reachable as a loop. A merchant could ask for a proposal on one product,
 * or start a recovery on one payment, and then had to drive policy,
 * authorization and execution through three more endpoints the console
 * never called. There was no screen that answered "what is my agent doing".
 *
 * THE FIVE QUESTIONS, IN THE ORDER A MERCHANT ASKS THEM
 *
 *   How can I increase revenue?   → the objective, and next actions
 *   What did you automatically do? → the run log and autonomous actions
 *   Why did you do it?             → every row carries its own reason
 *   What happened?                 → executed, verified, failures
 *   What should happen next?       → awaiting approval, next actions
 *
 * WHAT THE RUN BUTTON HONESTLY DOES
 *
 * It is not "make me money". It walks detected opportunities through
 * propose → validate → policy, and then either executes inside the
 * merchant's own automatic-approval limits or stops and waits for them.
 * The outcome list afterwards shows every stage each step reached, so a
 * refusal is visible as a refusal rather than disappearing into a success
 * count.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleSlash,
  Loader2,
  Play,
  Radar,
  ShieldQuestion,
  Sparkles,
  Target,
} from "lucide-react";
import type { AgentRunOutcomeDTO, AgentRunResultDTO, AgentRunStepDTO } from "@razorgrowth/contracts";
import { useAgentStatus, useRunAgentCycle } from "../hooks/use-merchant-agent";
import { PageHeader } from "../components/layout/PageHeader";
import { AgentToolbox } from "../components/merchant-agent/AgentToolbox";
import { Card, CardBody, CardHeader, CardTitle } from "../components/ui/Card";
import { EmptyState, ErrorState, Skeleton } from "../components/ui/States";
import { ValueTag } from "../components/ui/ValueTag";
import { formatMoney, formatRelativeTime } from "../lib/format";
import { ApiError } from "../lib/api-client";

/** The pipeline, in order, so a step's progress reads as a path rather
 * than a status word. */
const ALL_STAGES = ["DETECTED", "PROPOSED", "POLICY_CHECKED", "AUTHORIZED", "EXECUTED", "VERIFIED"] as const;

const STAGE_LABEL: Record<(typeof ALL_STAGES)[number], string> = {
  DETECTED: "Detected",
  PROPOSED: "Proposed",
  POLICY_CHECKED: "Policy",
  AUTHORIZED: "Authorized",
  EXECUTED: "Executed",
  VERIFIED: "Verified",
};

/**
 * An outcome's tone.
 *
 * `REFUSED` and `BLOCKED` are deliberately neutral rather than red. The
 * agent declining to retry an unreconciled payment, and policy refusing an
 * action outside its bounds, are the guardrails working — colouring them
 * as errors would train a merchant to read correct behaviour as breakage.
 * Only `FAILED` is red.
 */
const OUTCOME: Record<AgentRunOutcomeDTO, { label: string; className: string }> = {
  EXECUTED: { label: "Executed", className: "bg-success-subtle text-success-text" },
  AWAITING_APPROVAL: { label: "Waiting on you", className: "bg-warning-subtle text-warning-text" },
  BLOCKED: { label: "Blocked by policy", className: "bg-surface-sunken text-ink-muted" },
  REFUSED: { label: "Agent declined", className: "bg-surface-sunken text-ink-muted" },
  SKIPPED: { label: "Skipped", className: "bg-surface-sunken text-ink-muted" },
  FAILED: { label: "Failed", className: "bg-danger-subtle text-danger-text" },
};

function StageTrack({ stages }: { stages: AgentRunStepDTO["stages"] }) {
  return (
    <ol className="flex flex-wrap items-center gap-1" aria-label="Pipeline stages reached">
      {ALL_STAGES.map((stage) => {
        const reached = stages.includes(stage);
        return (
          <li
            key={stage}
            className={
              reached
                ? "rounded-pill bg-brand-50 px-2 py-0.5 text-[10px] font-semibold text-brand-700"
                : "rounded-pill bg-surface-sunken px-2 py-0.5 text-[10px] font-medium text-ink-faint line-through"
            }
          >
            {STAGE_LABEL[stage]}
          </li>
        );
      })}
    </ol>
  );
}

function RunOutcome({ run }: { run: AgentRunResultDTO }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Last cycle</CardTitle>
      </CardHeader>
      <CardBody className="space-y-4">
        <p className="text-sm text-ink-muted">
          Detected <span className="font-semibold text-ink">{run.detectedCount}</span> opportunit
          {run.detectedCount === 1 ? "y" : "ies"}, covering{" "}
          <span className="font-semibold text-ink">{run.actionableCount}</span> directly actionable item
          {run.actionableCount === 1 ? "" : "s"}. Worked{" "}
          <span className="font-semibold text-ink">{run.consideredCount}</span> this cycle
          {run.deferredCount > 0 ? `, leaving ${run.deferredCount} for the next one` : ""}.
        </p>

        <div className="flex flex-wrap gap-2 text-xs">
          {([
            ["Executed", run.counts.executed],
            ["Waiting on you", run.counts.awaitingApproval],
            ["Blocked by policy", run.counts.blocked],
            ["Agent declined", run.counts.refused],
            ["Failed", run.counts.failed],
          ] as const).map(([label, count]) => (
            <span key={label} className="rounded-pill bg-surface-sunken px-2.5 py-1 text-ink-muted">
              {label}: <span className="font-semibold tabular-nums text-ink">{count}</span>
            </span>
          ))}
        </div>

        {run.steps.length === 0 ? (
          <p className="text-sm text-ink-muted">
            Nothing was directly actionable this cycle. The opportunities below still need a person — see what each one asks for.
          </p>
        ) : (
          <ul className="space-y-3">
            {run.steps.map((step, index) => (
              <li key={`${step.opportunityId}-${index}`} className="rounded-card border border-border-hair p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-ink">{step.title}</p>
                  <span className={`rounded-pill px-2 py-0.5 text-[11px] font-semibold ${OUTCOME[step.outcome].className}`}>
                    {OUTCOME[step.outcome].label}
                  </span>
                </div>
                <p className="mt-1.5 text-xs text-ink-muted">
                  <span className="font-medium text-ink">Why: </span>
                  {step.whyDetected}
                </p>
                <p className="mt-1 text-xs text-ink-muted">
                  <span className="font-medium text-ink">What happened: </span>
                  {step.detail}
                </p>
                <div className="mt-2">
                  <StageTrack stages={step.stages} />
                </div>
              </li>
            ))}
          </ul>
        )}

        <Link
          to={`/merchant/governance/trace?workflowId=${run.workflowId}`}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:underline"
        >
          Follow this cycle in the audit trail <ArrowRight size={14} />
        </Link>
      </CardBody>
    </Card>
  );
}

function ListCard({
  title,
  icon,
  emptyTitle,
  emptyBody,
  items,
  footer,
}: {
  title: string;
  icon: React.ReactNode;
  emptyTitle: string;
  emptyBody: string;
  items: Array<{ id: string; primary: string; secondary: string; meta: string }>;
  footer?: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex items-center justify-between gap-2">
        <CardTitle>{title}</CardTitle>
        {footer}
      </CardHeader>
      <CardBody>
        {items.length === 0 ? (
          <EmptyState icon={icon} title={emptyTitle} description={emptyBody} />
        ) : (
          <ul className="divide-y divide-border-hair">
            {items.map((item) => (
              <li key={item.id} className="py-2.5 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <p className="text-sm font-medium text-ink">{item.primary}</p>
                  <span className="text-xs text-ink-faint">{item.meta}</span>
                </div>
                <p className="mt-0.5 text-xs leading-snug text-ink-muted">{item.secondary}</p>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

export default function AgentConsolePage() {
  const status = useAgentStatus();
  const run = useRunAgentCycle();
  const [lastRun, setLastRun] = useState<AgentRunResultDTO | null>(null);

  async function handleRun() {
    const result = await run.mutateAsync();
    setLastRun(result);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Agent console"
        lead="What your Merchant Agent is working on, what it has done on its own, and what it needs you for. Running a cycle acts on real orders inside the limits you set."
        actions={
          <button
            type="button"
            onClick={() => void handleRun()}
            disabled={run.isPending}
            className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {run.isPending ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Play size={14} aria-hidden />}
            {run.isPending ? "Running…" : "Run a cycle"}
          </button>
        }
      />

      {run.isError ? (
        <Card>
          <ErrorState message={run.error instanceof ApiError ? run.error.message : "The cycle could not be started."} />
        </Card>
      ) : null}

      {/* Declared by the server, not described here. A merchant asked to
          switch on unattended runs should be able to see exactly what
          unattended runs are permitted to do. */}
      <AgentToolbox />

      {status.isPending ? (
        <div className="space-y-4" role="status" aria-label="Loading agent status">
          <Skeleton className="h-28" />
          <Skeleton className="h-48" />
        </div>
      ) : status.isError || !status.data ? (
        <Card>
          <ErrorState
            message={status.error instanceof ApiError ? status.error.message : "Could not read the agent's status."}
            onRetry={() => void status.refetch()}
          />
        </Card>
      ) : (
        (() => {
          const s = status.data;
          return (
            <>
              {/* ── CURRENT OBJECTIVE ─────────────────────────────────── */}
              <Card>
                <CardHeader className="flex items-center gap-2">
                  <Target size={16} className="text-brand-600" aria-hidden />
                  <CardTitle>Current objective</CardTitle>
                </CardHeader>
                <CardBody className="space-y-2">
                  {s.objective ? (
                    <>
                      <p className="text-base font-semibold text-ink">{s.objective.headline}</p>
                      <p className="text-sm text-ink-muted">
                        <span className="font-medium text-ink">Why: </span>
                        {s.objective.why}
                      </p>
                      <div className="flex flex-wrap gap-2 pt-1 text-[11px]">
                        <span className="rounded-pill bg-surface-sunken px-2 py-0.5 text-ink-muted">
                          {s.objective.proposedAction.replaceAll("_", " ").toLowerCase()}
                        </span>
                        <span className="rounded-pill bg-surface-sunken px-2 py-0.5 text-ink-muted">
                          {s.objective.effort === "AGENT_AUTOMATIC"
                            ? "the agent can do this alone"
                            : s.objective.effort === "ONE_APPROVAL"
                              ? "needs one approval from you"
                              : "needs work from you"}
                        </span>
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-ink-muted">
                      Nothing needs attention. The engine scanned your orders, payments and catalogue and found no
                      recoverable revenue — this is the good empty state, not a missing feature.
                    </p>
                  )}

                  {s.lastRun ? (
                    <p className="border-t border-border-hair pt-3 text-xs text-ink-faint">
                      Last cycle {formatRelativeTime(s.lastRun.completedAt)} — {s.lastRun.summary}
                    </p>
                  ) : (
                    <p className="border-t border-border-hair pt-3 text-xs text-ink-faint">
                      This agent has not run a cycle yet.
                    </p>
                  )}
                </CardBody>
              </Card>

              {lastRun ? <RunOutcome run={lastRun} /> : null}

              {/* ── DETECTED + VERIFIED ───────────────────────────────── */}
              <div className="grid gap-4 sm:grid-cols-3">
                <Card>
                  <CardBody>
                    <Radar size={16} className="text-brand-600" aria-hidden />
                    <p className="mt-3 text-2xl font-bold tabular-nums text-ink">{s.detected.count}</p>
                    <p className="mt-0.5 text-sm font-medium text-ink">Opportunities detected</p>
                    <p className="mt-1.5 text-[11px] leading-snug text-ink-faint">
                      {s.detected.directlyActionable} the agent can act on with no buyer present
                      {s.detected.blockedByPolicy > 0 ? `; ${s.detected.blockedByPolicy} blocked by your policy` : ""}.
                    </p>
                  </CardBody>
                </Card>
                <Card>
                  <CardBody>
                    <div className="flex items-start justify-between gap-2">
                      <CheckCircle2 size={16} className="text-brand-600" aria-hidden />
                      <ValueTag classification="VERIFIED" />
                    </div>
                    <p className="mt-3 text-2xl font-bold tabular-nums text-ink">
                      {formatMoney(s.verified.capturedValue)}
                    </p>
                    <p className="mt-0.5 text-sm font-medium text-ink">Captured on agent-proposed orders</p>
                    <p className="mt-1.5 text-[11px] leading-snug text-ink-faint">
                      Provenance, not attribution — there is no control group, so this is not a claim about uplift.
                    </p>
                  </CardBody>
                </Card>
                <Card>
                  <CardBody>
                    <div className="flex items-start justify-between gap-2">
                      <CheckCircle2 size={16} className="text-brand-600" aria-hidden />
                      <ValueTag classification="VERIFIED" />
                    </div>
                    <p className="mt-3 text-2xl font-bold tabular-nums text-ink">
                      {formatMoney(s.verified.recoveredValue)}
                    </p>
                    <p className="mt-0.5 text-sm font-medium text-ink">Recovered after a failed attempt</p>
                    <p className="mt-1.5 text-[11px] leading-snug text-ink-faint">
                      {s.verified.recoveredOrders} order{s.verified.recoveredOrders === 1 ? "" : "s"} whose money arrived
                      only on a later bounded retry.
                    </p>
                  </CardBody>
                </Card>
              </div>

              {/* ── WHAT IT DID, WHAT IT NEEDS ────────────────────────── */}
              <div className="grid gap-4 lg:grid-cols-2">
                <ListCard
                  title="What it did on its own"
                  icon={<Sparkles size={18} />}
                  emptyTitle="No autonomous actions yet"
                  emptyBody="Every scan and proposal the agent decides on writes a ledger entry. Run a cycle to give it something to record."
                  items={s.autonomousActions.map((a) => ({
                    id: a.id,
                    primary: a.actionType.replaceAll("_", " ").toLowerCase(),
                    secondary: a.reason,
                    meta: formatRelativeTime(a.at),
                  }))}
                  footer={
                    <Link to="/merchant/governance/ledger" className="text-xs font-medium text-brand-600 hover:underline">
                      Audit trail
                    </Link>
                  }
                />

                <ListCard
                  title="Waiting on your approval"
                  icon={<ShieldQuestion size={18} />}
                  emptyTitle="Nothing waiting on you"
                  emptyBody="Every proposal so far was either inside your automatic limits or refused before it reached you."
                  items={s.awaitingApproval.map((p) => ({
                    id: p.proposalId,
                    primary: (p.actionType ?? "proposal").replaceAll("_", " ").toLowerCase(),
                    secondary: p.explanation,
                    meta: formatRelativeTime(p.at),
                  }))}
                  footer={
                    <Link
                      to="/merchant/governance/approvals"
                      className="text-xs font-medium text-brand-600 hover:underline"
                    >
                      Decide these
                    </Link>
                  }
                />

                <ListCard
                  title="Carried through governance"
                  icon={<CheckCircle2 size={18} />}
                  emptyTitle="Nothing authorized yet"
                  emptyBody="A proposal reaches this list once policy has allowed it and an execution authorization has been issued against it."
                  items={s.executedActions.map((p) => ({
                    id: p.proposalId,
                    primary: (p.actionType ?? "proposal").replaceAll("_", " ").toLowerCase(),
                    secondary: p.explanation,
                    meta: formatRelativeTime(p.at),
                  }))}
                />

                <ListCard
                  title="Stopped, and why"
                  icon={<CircleSlash size={18} />}
                  emptyTitle="Nothing was refused"
                  emptyBody="Proposals refused by validation, policy or a human appear here with the reason attached."
                  items={s.failures.map((p) => ({
                    id: p.proposalId,
                    primary: (p.actionType ?? "proposal").replaceAll("_", " ").toLowerCase(),
                    secondary: p.reason,
                    meta: formatRelativeTime(p.at),
                  }))}
                />
              </div>

              {/* ── NEXT ──────────────────────────────────────────────── */}
              <Card>
                <CardHeader className="flex items-center justify-between gap-2">
                  <CardTitle>What should happen next</CardTitle>
                  <Link to="/merchant/growth" className="text-xs font-medium text-brand-600 hover:underline">
                    Full ranked list
                  </Link>
                </CardHeader>
                <CardBody>
                  {s.nextActions.length === 0 ? (
                    <EmptyState
                      icon={<AlertTriangle size={18} />}
                      title="Nothing recommended"
                      description="The engine found no opportunity worth acting on in your current data."
                    />
                  ) : (
                    <ol className="space-y-3">
                      {s.nextActions.map((next, index) => (
                        <li key={next.opportunityId} className="flex gap-3">
                          <span
                            aria-hidden
                            className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-[11px] font-bold text-ink-muted"
                          >
                            {index + 1}
                          </span>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-ink">{next.title}</p>
                            <p className="mt-0.5 text-xs text-ink-muted">{next.why}</p>
                            <p className="mt-1 text-xs font-medium text-brand-700">{next.actionLabel}</p>
                          </div>
                        </li>
                      ))}
                    </ol>
                  )}
                </CardBody>
              </Card>
            </>
          );
        })()
      )}
    </div>
  );
}
