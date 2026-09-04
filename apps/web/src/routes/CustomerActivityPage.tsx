/**
 * Agent Activity — what the agent actually did, from the audit ledger.
 *
 * WHAT THIS REPLACED
 *
 * A three-field summary per purchase proposal: policy outcome, reason
 * code, negotiation status. Real data, but not activity — it showed the
 * VERDICT of a pipeline while the pipeline itself was invisible, and a
 * conversation that searched without buying produced no row at all.
 *
 * EVERY EVENT HERE IS A LEDGER ROW
 *
 * Nothing on this page is generated for display. Each event is an
 * `AgentAction` written by the code that performed the action, and an API
 * test asserts every returned event exists in the ledger with the same id,
 * actor and timestamp.
 *
 * THE STAGES SHOWN ARE THE STAGES THAT HAPPENED
 *
 * A workflow that searched and stopped shows INTENT → DISCOVERY →
 * RECOMMENDATION and nothing else. It does not render a ten-step tracker
 * with seven greyed-out steps: a progress bar showing work nobody did is a
 * lie with a nice animation. What did not happen is absent, and the
 * absence is the information.
 */
import { useQuery } from "@tanstack/react-query";
import { Activity, ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import type { BuyerActivityResponseDTO, BuyerActivityStage } from "@razorgrowth/contracts";
import { apiGet } from "../lib/api-client";
import { formatDateTime, formatMoney } from "../lib/format";
import { PageHeader } from "../components/layout/PageHeader";
import { Card, CardBody } from "../components/ui/Card";
import { EmptyState, ErrorState, Skeleton } from "../components/ui/States";

/** Buyer-facing names. The ledger's own `actionType` stays on each event
 * so an auditor can trace a row back without going through this map. */
const STAGE_LABEL: Record<BuyerActivityStage, string> = {
  INTENT: "Understood what you asked for",
  DISCOVERY: "Searched the catalogue",
  COMPARISON: "Compared options",
  RECOMMENDATION: "Recommended products",
  OFFER_CHECK: "Checked for offers",
  POLICY: "Checked your spending policy",
  AUTHORIZATION: "Authorization",
  CHECKOUT: "Created the checkout",
  PAYMENT: "Payment",
  ORDER: "Order",
};

/**
 * Ledger statuses that mean the step did NOT succeed.
 *
 * PART 13 made failure events reachable here — a refused capture, a
 * rejected state transition, an invalid client signature. Before that
 * every event on this page was EXECUTED or VERIFIED, so nothing needed to
 * tell them apart.
 */
const FAILED_STATUSES = new Set(["FAILED", "REJECTED", "DENIED", "CANCELLED"]);

function useBuyerActivity() {
  return useQuery({
    queryKey: ["buyer", "activity"],
    queryFn: () => apiGet<BuyerActivityResponseDTO>("/buyer/activity"),
  });
}

function StageRail({ reached, order }: { reached: BuyerActivityStage[]; order: BuyerActivityStage[] }) {
  const reachedSet = new Set(reached);
  // Only the stages this workflow reached, in pipeline order. Stages that
  // did not happen are not rendered at all.
  const shown = order.filter((stage) => reachedSet.has(stage));

  return (
    <div className="flex flex-wrap items-center gap-1">
      {shown.map((stage, index) => (
        <span key={stage} className="flex items-center gap-1">
          <span className="rounded-full bg-brand-50 px-2 py-0.5 text-micro font-medium text-brand-700">
            {STAGE_LABEL[stage]}
          </span>
          {index < shown.length - 1 ? <span className="text-ink-faint" aria-hidden>→</span> : null}
        </span>
      ))}
    </div>
  );
}

export default function CustomerActivityPage() {
  const activity = useBuyerActivity();
  const [expanded, setExpanded] = useState<string | null>(null);

  if (activity.isPending) return <Skeleton className="h-80" />;
  if (activity.isError) {
    return (
      <Card>
        <ErrorState message="Could not load your agent activity." onRetry={() => void activity.refetch()} />
      </Card>
    );
  }

  const { workflows, stageOrder } = activity.data!;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Agent activity"
        lead="Every step your agent took, read from the audit ledger it writes as it works. Nothing here is reconstructed after the fact."
      />

      {workflows.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Activity size={18} />}
            title="No agent activity yet"
            description="Ask the Buyer Agent for something and its work will be recorded here, step by step."
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {workflows.map((workflow) => {
            const isOpen = expanded === workflow.workflowId;
            return (
              <Card key={workflow.workflowId}>
                <CardBody className="space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 space-y-2">
                      <p className="text-xs text-ink-muted">{formatDateTime(workflow.startedAt)}</p>
                      <StageRail reached={workflow.reachedStages} order={stageOrder} />
                    </div>

                    {workflow.outcome ? (
                      <div className="shrink-0 text-right">
                        {workflow.outcome.amountMinor !== null && workflow.outcome.currency ? (
                          <p className="font-semibold tabular-nums text-ink">
                            {formatMoney({
                              amountMinor: workflow.outcome.amountMinor,
                              currency: workflow.outcome.currency as "INR" | "USD",
                            })}
                          </p>
                        ) : null}
                        <p className="text-xs text-ink-muted">{workflow.outcome.policyOutcome.replaceAll("_", " ")}</p>
                      </div>
                    ) : null}
                  </div>

                  {/* The policy's own words, verbatim. */}
                  {workflow.outcome ? (
                    <p className="text-sm leading-relaxed text-ink-muted">{workflow.outcome.explanation}</p>
                  ) : null}

                  <button
                    type="button"
                    onClick={() => setExpanded(isOpen ? null : workflow.workflowId)}
                    className="inline-flex items-center gap-1 text-micro font-medium text-ink-faint transition-colors hover:text-ink"
                  >
                    {isOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                    {isOpen ? "Hide the steps" : `Show all ${workflow.events.length} steps`}
                  </button>

                  {isOpen ? (
                    <ol className="space-y-2 border-t border-border-hair pt-3">
                      {workflow.events.map((event) => (
                        <li key={event.id} className="flex gap-3">
                          {/* A refused capture, a rejected transition and a
                              successful one used to render identically —
                              same dot, same weight — because only EXECUTED
                              events could reach this page. Failures can now,
                              and a step that went wrong must not look like a
                              step that went right. */}
                          <span
                            className={`mt-1 flex h-1.5 w-1.5 shrink-0 rounded-full ${FAILED_STATUSES.has(event.status) ? "bg-danger" : "bg-brand-600"}`}
                            aria-hidden
                          />
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-semibold text-ink">{STAGE_LABEL[event.stage]}</p>
                            {/* The reason written AT THE TIME of the action,
                                carried verbatim — a structured fact, never
                                model reasoning. */}
                            <p className="mt-0.5 text-xs leading-snug text-ink-muted">{event.detail}</p>
                            <p className="mt-0.5 text-micro text-ink-faint">
                              {/* The ledger's own action type, so this row
                                  can be traced back to the exact record. */}
                              {event.actionType} · {event.actor} · {formatDateTime(event.at)}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ol>
                  ) : null}
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}

      <p className="text-xs leading-relaxed text-ink-faint">
        These are entries from the agent’s own hash-chained audit ledger, written as each action happened. A step that
        does not appear did not happen — the agent’s private reasoning is never recorded or shown.
      </p>
    </div>
  );
}
