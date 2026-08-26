/**
 * PART 03 §109-§111 — a restrained, expandable pipeline trace. Structured
 * stage facts only ("3 candidates found"), never hidden chain-of-thought
 * or a "AI reasoning:" block (§27, §111).
 */
import { useState } from "react";
import { ChevronDown, ChevronRight, Workflow } from "lucide-react";

export function AgentTracePanel({ trace, traceId }: { trace: { stage: string; detail: string }[]; traceId: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-card border border-border bg-surface-subtle">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-ink-muted"
      >
        {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <Workflow size={13} />
        Agent trace
        <span className="ml-auto font-mono text-[10px] text-ink-faint">{traceId.slice(0, 8)}</span>
      </button>
      {expanded ? (
        <ol className="space-y-1.5 border-t border-border px-3 py-2">
          {trace.map((step, i) => (
            <li key={`${step.stage}-${i}`} className="text-xs text-ink-muted">
              <span className="font-semibold text-ink">
                {i + 1}. {step.stage.replace(/_/g, " ")}
              </span>{" "}
              — {step.detail}
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
