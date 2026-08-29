/**
 * Agent Activity (Part 11 §28) — the merchant-legible narration of what
 * the specialist actually did, derived from the real Action Ledger via
 * `buildActivityFeed`. The Action Ledger page remains the deeper
 * technical audit view; this never becomes a second audit truth.
 */
import { Link } from "react-router-dom";
import { Activity as ActivityIcon } from "lucide-react";
import { useLedger } from "../../hooks/use-api";
import { EmptyState, ErrorState, Skeleton } from "../../components/ui/States";
import { ActorClassBadge } from "../trust-trace/ActorClassBadge";
import type { TrustTraceActorClass } from "../trust-trace/model";
import { buildActivityFeed, type ActivityActor, type ActivityTone } from "./model";
import { formatDateTime } from "../../lib/format";

const TONE_DOT: Record<ActivityTone, string> = {
  positive: "bg-success",
  attention: "bg-warning",
  negative: "bg-danger",
  neutral: "bg-border",
};

/** Reuses Trust Trace's badge rather than introducing a second actor
 * vocabulary. `SYSTEM` and `POLICY` both render as "Deterministic",
 * exactly as Trust Trace already labels them, so the same event is never
 * described two different ways across the product. */
const ACTOR_BADGE_CLASS: Record<ActivityActor, TrustTraceActorClass> = {
  AI: "AI",
  SYSTEM: "DETERMINISTIC",
  POLICY: "DETERMINISTIC",
  HUMAN: "HUMAN",
  PROVIDER: "PROVIDER",
};

export function ActivityFeed({ limit = 12 }: { limit?: number }) {
  const ledger = useLedger({ limit });

  if (ledger.isLoading) return <Skeleton className="h-64 w-full" />;
  if (ledger.isError) {
    return <ErrorState message="Could not load agent activity." onRetry={() => ledger.refetch()} />;
  }

  const entries = buildActivityFeed(ledger.data?.items ?? []);
  if (entries.length === 0) {
    return (
      <EmptyState
        icon={<ActivityIcon size={18} />}
        title="No agent activity yet"
        description="Run the demo from the Agent Gateway page to send five agent purchases."
      />
    );
  }

  return (
    <ol className="space-y-0">
      {entries.map((entry, i) => (
        <li key={entry.id} className="flex gap-3">
          <div className="flex flex-col items-center">
            <span className={"mt-1.5 h-2 w-2 shrink-0 rounded-full " + TONE_DOT[entry.tone]} />
            {i < entries.length - 1 ? <span className="my-1 w-px flex-1 bg-border" /> : null}
          </div>
          <div className="min-w-0 flex-1 pb-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-ink-faint">{formatDateTime(entry.createdAt)}</span>
              <ActorClassBadge actorClass={ACTOR_BADGE_CLASS[entry.actor]} />
              {entry.unmapped ? (
                <span className="rounded-full bg-surface-sunken px-1.5 py-0.5 text-[10px] text-ink-faint">
                  unmapped event
                </span>
              ) : null}
            </div>
            <p className="mt-0.5 text-sm font-medium text-ink">{entry.title}</p>
            <p className="mt-0.5 text-sm text-ink-muted">{entry.detail}</p>
            <Link
              to={`/trust-trace?workflowId=${entry.workflowId}`}
              className="mt-1 inline-block font-mono text-[11px] text-brand-600 hover:underline"
            >
              {entry.workflowId.slice(0, 8)}…
            </Link>
          </div>
        </li>
      ))}
    </ol>
  );
}
