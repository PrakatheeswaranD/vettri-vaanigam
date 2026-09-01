/**
 * Gateway decisions on the Activity timeline.
 *
 * WHY THIS IS A SEPARATE FEED AND NOT MERGED INTO THE LEDGER
 *
 * The Activity page read the Action Ledger only. The ledger is
 * workflow-scoped and hash-chained — it records what THIS merchant's own
 * systems did inside a governed workflow. A gateway decision is a
 * different kind of event: an OUTSIDE agent asked, and policy answered.
 * Most of those never become a workflow at all, because most are refused.
 *
 * Writing them into the ledger to make one list would have meant either
 * inventing a workflow id for a decision that has none, or loosening what
 * a ledger entry means. Both would damage the thing that makes the ledger
 * worth having. So the page shows both truths side by side and says which
 * is which, rather than flattening two different records into one and
 * quietly changing what "audited" means.
 */
import { Link } from "react-router-dom";
import { CheckCircle2, AlertTriangle, XCircle, ArrowRight } from "lucide-react";
import { useDecisionLog, type DecisionLogEntry } from "../../hooks/use-agent-gateway";
import { formatMoney } from "../../lib/format";

const STYLE: Record<DecisionLogEntry["outcome"], { icon: typeof CheckCircle2; cls: string; verb: string }> = {
  AUTO_APPROVE: { icon: CheckCircle2, cls: "text-success", verb: "approved" },
  STEP_UP: { icon: AlertTriangle, cls: "text-warning", verb: "sent to you" },
  DECLINE: { icon: XCircle, cls: "text-danger", verb: "declined" },
};

function when(iso: string): string {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export function GatewayDecisionFeed({ limit = 12 }: { limit?: number }) {
  const decisions = useDecisionLog();
  const items = (decisions.data?.items ?? []).slice(0, limit);

  if (decisions.isPending) return <p className="text-sm text-ink-muted">Loading agent decisions…</p>;

  if (items.length === 0) {
    return (
      <p className="text-sm text-ink-muted">
        No outside agent has called your gateway yet.{" "}
        <Link to="/agent-gateway" className="font-medium text-brand-600 hover:underline">
          Run the demo
        </Link>{" "}
        to send five.
      </p>
    );
  }

  return (
    <ol className="space-y-3">
      {items.map((d) => {
        const style = STYLE[d.outcome];
        const Icon = style.icon;
        return (
          <li key={d.id} className="flex gap-3">
            <Icon size={15} className={`mt-0.5 shrink-0 ${style.cls}`} />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-ink">
                <span className="font-medium">{d.externalAgentId ?? "An unidentified agent"}</span> tried to buy{" "}
                {d.computedTotalMinor === null
                  ? "something we could not price"
                  : formatMoney({ amountMinor: d.computedTotalMinor, currency: d.currency === "USD" ? "USD" : "INR" })}
                {d.protocol ? ` over ${d.protocol}` : ""} — {style.verb}.
              </p>
              <p className="mt-0.5 text-xs text-ink-muted">{d.explanation}</p>
              <p className="mt-0.5 text-[11px] text-ink-faint">
                {/* A decision that took literally zero milliseconds did not
                    happen; these are rows written before the gate started
                    timing itself, and printing "0ms" states a measurement
                    that was never taken. Say it was not recorded instead. */}
                {when(d.createdAt)} · {d.decisionLatencyMs > 0 ? `${d.decisionLatencyMs}ms` : "timing not recorded"}
                {d.providerOrderId ? ` · ${d.providerOrderId}` : ""}
              </p>
            </div>
          </li>
        );
      })}

      <li className="pt-1 text-xs text-ink-faint">
        <Link to="/agent-gateway" className="inline-flex items-center gap-1 font-medium text-brand-600 hover:underline">
          Open the full decision log <ArrowRight size={11} />
        </Link>
      </li>
    </ol>
  );
}
