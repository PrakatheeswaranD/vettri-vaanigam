/**
 * The Growth findings that attach to one Commerce row — and, where a safe
 * automated action exists, the button that runs it.
 *
 * WHY THE ACTION LIVES HERE AND NOT ON A DIFFERENT SCREEN
 *
 * The agent already had these capabilities. The only way to reach one was
 * to leave the row you were reading, find the right screen, and do the
 * work by hand. A merchant looking at a payment whose outcome is unknown
 * should be able to ask the provider from there.
 *
 * WHAT THE BUTTON PROMISES
 *
 * Exactly what the server's tool registry declares, never a friendlier
 * version of it. A GOVERNED tool says so and says it may need approval; an
 * AUTOMATIC one says it moves no money. Those words come from `movesMoney`
 * and `requiresApproval` on the tool itself, so the console cannot promise
 * something the backend does not do.
 */
import { useState } from "react";
import { AlertTriangle, ArrowRight, Check, Loader2, ShieldCheck } from "lucide-react";
import type { AgentToolDTO, AttachedOpportunityDTO } from "@razorgrowth/contracts";
import { useAgentTools, useRunAgentTool } from "../../hooks/use-commerce";
import { ApiError } from "../../lib/api-client";

const OUTCOME_TONE: Record<string, string> = {
  EXECUTED: "text-emerald-700 dark:text-emerald-400",
  AWAITING_APPROVAL: "text-amber-700 dark:text-amber-400",
  BLOCKED: "text-rose-700 dark:text-rose-400",
  REFUSED: "text-amber-700 dark:text-amber-400",
  FAILED: "text-rose-700 dark:text-rose-400",
};

function ToolButton({ tool, subjectId }: { tool: AgentToolDTO; subjectId: string }) {
  const run = useRunAgentTool();
  const [result, setResult] = useState<{ outcome: string; detail: string } | null>(null);

  if (result) {
    return (
      <p className={`mt-2 flex items-start gap-1.5 text-xs leading-snug ${OUTCOME_TONE[result.outcome] ?? "text-ink-muted"}`}>
        {result.outcome === "EXECUTED" ? (
          <Check size={13} className="mt-0.5 shrink-0" aria-hidden />
        ) : (
          <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden />
        )}
        <span>{result.detail}</span>
      </p>
    );
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        disabled={run.isPending}
        onClick={() =>
          run.mutate(
            { tool: tool.name, subjectId },
            {
              onSuccess: (data) => setResult({ outcome: data.outcome, detail: data.detail }),
              onError: (error) =>
                setResult({
                  outcome: "FAILED",
                  detail:
                    error instanceof ApiError
                      ? error.message
                      : "Could not reach the agent. Only an OWNER may run a tool.",
                }),
            },
          )
        }
        className="inline-flex items-center gap-1.5 rounded-md border border-border-hair bg-surface px-2.5 py-1.5 text-xs font-semibold text-ink hover:bg-surface-raised disabled:opacity-50"
      >
        {run.isPending ? <Loader2 size={12} className="animate-spin" aria-hidden /> : <ArrowRight size={12} aria-hidden />}
        {run.isPending ? "Asking the agent…" : `Let the agent ${tool.name.replaceAll("_", " ")}`}
      </button>
      {/* The server's own declaration, not a reassuring paraphrase. */}
      <p className="mt-1 flex items-start gap-1 text-xs leading-snug text-ink-faint">
        <ShieldCheck size={11} className="mt-0.5 shrink-0" aria-hidden />
        <span>
          {tool.movesMoney
            ? "This can put money in motion, inside the limits you set."
            : "Moves no money and invents nothing."}
          {tool.requiresApproval ? " It stops for your approval if it falls outside those limits." : ""}
        </span>
      </p>
    </div>
  );
}

export function AttachedOpportunities({
  opportunities,
  subjectId,
}: {
  opportunities: AttachedOpportunityDTO[];
  subjectId: string;
}) {
  const tools = useAgentTools();
  if (opportunities.length === 0) return null;

  const byName = new Map((tools.data?.tools ?? []).map((t) => [t.name, t]));

  return (
    <div className="mt-3 space-y-2 border-t border-border-hair pt-3">
      {opportunities.map((o) => {
        const tool = o.tool ? byName.get(o.tool) : undefined;
        return (
          <div key={o.id}>
            <p className="text-xs font-semibold text-ink">
              {o.title}
              {o.status !== "DETECTED" ? (
                <span className="ml-1.5 font-normal text-ink-faint">· {o.status.toLowerCase().replaceAll("_", " ")}</span>
              ) : null}
            </p>
            {/* The engine's own words. A restatement here would be a second
                explanation of the same finding, free to drift from it. */}
            <p className="mt-0.5 text-xs leading-snug text-ink-muted">{o.whyDetected}</p>
            {o.policyOutcome === "BLOCKED" ? (
              <p className="mt-1 text-xs text-ink-faint">Your policy refuses this outright, so the agent will not act on it.</p>
            ) : tool ? (
              <ToolButton tool={tool} subjectId={subjectId} />
            ) : (
              <p className="mt-1 text-xs leading-snug text-ink-faint">
                No automatic action — this one needs a decision only you can make.
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
