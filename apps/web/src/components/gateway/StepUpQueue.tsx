/**
 * Orders the gateway would not auto-approve, waiting on a person.
 *
 * This is the human half of the governance loop, and it had no screen.
 * The endpoints existed — a queue, a decision, an optimistic-lock so two
 * approvers cannot both decide, a consent revalidation on approval, a
 * ledger event either way — and the console rendered none of it. A merchant
 * could see that an order had stepped up, and had no way to resolve it.
 *
 * WHAT THIS SHOWS AND WHY
 *
 * Each row states the amount, the ceiling it exceeded, and the gateway's
 * own sentence about why it stopped. That triple is the whole decision: a
 * human approving an agent's order needs to know how far past the line it
 * was, not merely that a line existed.
 *
 * Rejection is the unstyled default and approval is the deliberate one.
 * Approving releases money on an agent's say-so, so it does not get to be
 * the easy button.
 */
import { useState } from "react";
import { ShieldQuestion } from "lucide-react";
import { usePendingStepUps, useDecideStepUp, type PendingStepUp } from "../../hooks/use-agent-gateway";
import { Card, CardBody } from "../ui/Card";
import { EmptyState, ErrorState, Skeleton } from "../ui/States";
import { formatDateTime, formatMoney } from "../../lib/format";
import { ApiError } from "../../lib/api-client";

function overBy(row: PendingStepUp): string | null {
  if (row.computedTotalMinor === null || row.appliedCeilingMinor === null || !row.currency) return null;
  const excess = row.computedTotalMinor - row.appliedCeilingMinor;
  if (excess <= 0) return null;
  return formatMoney({ amountMinor: excess, currency: row.currency as "INR" | "USD" });
}

function StepUpRow({ row }: { row: PendingStepUp }) {
  const decide = useDecideStepUp();
  const [note, setNote] = useState("");
  const excess = overBy(row);

  return (
    <Card>
      <CardBody className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-semibold text-ink">
              {row.currency && row.computedTotalMinor !== null
                ? formatMoney({ amountMinor: row.computedTotalMinor, currency: row.currency as "INR" | "USD" })
                : "Amount unavailable"}
            </p>
            <p className="mt-1 text-xs text-ink-muted">
              {row.externalAgentId ?? "Unidentified agent"}
              {row.protocol ? ` · ${row.protocol}` : ""} · {formatDateTime(row.createdAt)}
            </p>
          </div>
          <span className="rounded-pill bg-warning-subtle px-2 py-0.5 text-micro font-medium text-warning-text">
            {row.reasonCode.replaceAll("_", " ")}
          </span>
        </div>

        <p className="text-sm text-ink-muted">{row.explanation}</p>

        {excess ? (
          <p className="text-sm text-ink-muted">
            <span className="font-medium text-ink">Over the applied ceiling by {excess}</span>
            {row.appliedCeilingMinor !== null && row.currency
              ? ` (ceiling ${formatMoney({ amountMinor: row.appliedCeilingMinor, currency: row.currency as "INR" | "USD" })})`
              : ""}
          </p>
        ) : null}

        <label className="block">
          <span className="text-xs font-medium text-ink-muted">Note (recorded on the ledger entry)</span>
          <input
            type="text"
            value={note}
            maxLength={500}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Optional — why you decided this way"
            className="mt-1 w-full rounded-md border border-border-hair bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint"
          />
        </label>

        {decide.isError ? (
          <p className="text-sm text-danger-text">
            {decide.error instanceof ApiError ? decide.error.message : "Could not record that decision."}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={decide.isPending}
            onClick={() => decide.mutate({ decisionId: row.id, decision: "REJECTED", note: note.trim() || undefined })}
            className="rounded-md border border-border-hair px-3 py-2 text-sm font-medium text-ink hover:bg-surface-sunken disabled:opacity-50"
          >
            Reject
          </button>
          <button
            type="button"
            disabled={decide.isPending}
            onClick={() => decide.mutate({ decisionId: row.id, decision: "APPROVED", note: note.trim() || undefined })}
            className="rounded-md bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {decide.isPending ? "Recording…" : "Approve this order"}
          </button>
        </div>
      </CardBody>
    </Card>
  );
}

export function StepUpQueue() {
  const { data, isLoading, isError, error, refetch } = usePendingStepUps();

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-faint">Waiting on you</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Orders the gateway refused to auto-approve. Each one is a real agent purchase held until a person decides it.
        </p>
      </div>

      {isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : isError ? (
        <Card>
          <ErrorState
            message={error instanceof ApiError ? error.message : "Could not load the step-up queue."}
            onRetry={() => void refetch()}
          />
        </Card>
      ) : !data || data.items.length === 0 ? (
        <Card>
          <EmptyState
            icon={<ShieldQuestion size={18} />}
            title="Nothing waiting"
            description="Every inbound agent order so far was either inside your policy or declined outright."
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {data.items.map((row) => (
            <StepUpRow key={row.id} row={row} />
          ))}
        </div>
      )}
    </section>
  );
}
