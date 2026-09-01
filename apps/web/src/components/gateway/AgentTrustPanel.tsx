/**
 * The adaptive trust score, shown the way a merchant would want it.
 *
 * TWO THINGS THIS DELIBERATELY DOES NOT DO
 *
 * 1. It never renders a score for an agent the server did not score. A
 *    dash is honest; a default of 50 would look like a measurement.
 *
 * 2. It never shows the number alone. A bare "72" is a credit score with
 *    no credit bureau — the merchant cannot act on it, argue with it, or
 *    tell whether it is right. Every row carries the ceiling it produced
 *    and the sentence explaining how it got there.
 *
 * The bar is anchored at the unknown-agent ceiling rather than at zero,
 * because that is the line that actually means something: above it, the
 * agent has earned headroom a stranger would not get; below it, being
 * caught has cost it more than never having transacted at all.
 *
 * WHY THE LIST IS SORTED AND CAPPED
 *
 * A gateway that has been demoed a few times accumulates dozens of
 * throwaway agent identities, every one of them sitting at the baseline
 * with no history. Rendering them in last-seen order buries the two rows a
 * merchant actually needs — the agent that just got caught, and the one
 * that has earned real headroom — under forty identical ones.
 *
 * So rows are ordered by how much they have to say: attacks first, then
 * declines, then settled orders, then recency. Everything still at the
 * untouched baseline collapses behind one line, because "nothing has
 * happened with this agent" is a single fact, not forty.
 */
import { ShieldCheck, ShieldAlert, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "../ui/Card";
import { useState } from "react";
import { useEnrolledAgents, type EnrolledAgentRow, type GatewayPolicy } from "../../hooks/use-agent-gateway";
import { formatMoney } from "../../lib/format";

const BAND_STYLE: Record<NonNullable<EnrolledAgentRow["trustBand"]>, { cls: string; label: string }> = {
  TRUSTED: { cls: "bg-success-subtle text-success-text border-success-border", label: "Trusted" },
  ESTABLISHED: { cls: "bg-brand-50 text-brand-800 border-brand-200", label: "Established" },
  PROVISIONAL: { cls: "bg-surface-sunken text-ink-muted border-border-strong", label: "Provisional" },
  UNTRUSTED: { cls: "bg-danger-subtle text-danger-text border-danger-border", label: "Untrusted" },
};

function rupees(minor: number | null | undefined, currency: string | null | undefined): string {
  if (minor == null) return "—";
  return formatMoney({ amountMinor: minor, currency: currency === "USD" ? "USD" : "INR" });
}

/**
 * A bar whose midpoint is the unknown-agent ceiling.
 *
 * Scaled against the KNOWN-agent ceiling on the right, because that is the
 * maximum the merchant configured and the score can never exceed it.
 */
function CeilingBar({ agent, policy }: { agent: EnrolledAgentRow; policy: GatewayPolicy | undefined }) {
  if (!policy || agent.effectiveCeilingMinor == null) return null;

  const floor = policy.unknownAgentCeilingMinor;
  const max = Math.max(floor, policy.knownAgentCeilingMinor);
  // Guard the degenerate config where both ceilings are zero.
  const span = max > 0 ? max : 1;

  const anchorPct = Math.min(100, (floor / span) * 100);
  const valuePct = Math.min(100, (agent.effectiveCeilingMinor / span) * 100);
  const collapsed = agent.trustCeilingCollapsed;

  return (
    <div className="mt-3">
      <div className="relative h-1.5 overflow-hidden rounded-pill bg-surface-sunken">
        <div
          className={`absolute inset-y-0 left-0 rounded-pill transition-[width] duration-500 ease-ui ${
            collapsed ? "bg-danger" : agent.trustCeilingEarned ? "bg-success" : "bg-brand-500"
          }`}
          style={{ width: `${Math.max(valuePct, 1.5)}%` }}
        />
        {/* Where a stranger sits. The line the score is measured against. */}
        <span
          aria-hidden
          className="absolute inset-y-0 w-px bg-ink-faint"
          style={{ left: `${anchorPct}%` }}
        />
      </div>
      <div className="mt-1.5 flex items-center justify-between text-micro text-ink-faint">
        <span>
          Auto-approves up to{" "}
          <span className="font-semibold tabular-nums text-ink">
            {rupees(agent.effectiveCeilingMinor, policy.currency)}
          </span>
        </span>
        <span className="tabular-nums">
          stranger {rupees(floor, policy.currency)} · max {rupees(max, policy.currency)}
        </span>
      </div>
    </div>
  );
}

/** True when nothing has ever happened with this agent. */
function isUntouched(agent: EnrolledAgentRow): boolean {
  return (
    agent.settledOrderCount === 0 &&
    agent.declineCount === 0 &&
    agent.flaggedAttackCount === 0
  );
}

/** Most to say first. Ties fall back to recency, so the order is stable. */
function bySignal(a: EnrolledAgentRow, b: EnrolledAgentRow): number {
  return (
    b.flaggedAttackCount - a.flaggedAttackCount ||
    b.declineCount - a.declineCount ||
    b.settledOrderCount - a.settledOrderCount ||
    Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt)
  );
}

function TrustRow({ agent, policy }: { agent: EnrolledAgentRow; policy: GatewayPolicy | undefined }) {
  const band = agent.trustBand ? BAND_STYLE[agent.trustBand] : null;
  const Direction = agent.trustCeilingCollapsed ? TrendingDown : agent.trustCeilingEarned ? TrendingUp : Minus;

  return (
    <li className="px-5 py-4 transition hover:bg-surface-veil">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-mono text-[13px] font-medium text-ink">{agent.externalAgentId}</span>
            {band ? (
              <span className={`rounded-pill border px-2 py-0.5 text-micro font-semibold ${band.cls}`}>
                {band.label}
              </span>
            ) : null}
            {agent.flaggedAttackCount > 0 ? (
              <span className="inline-flex items-center gap-1 rounded-pill border border-danger-border bg-danger-subtle px-2 py-0.5 text-micro font-semibold text-danger-text">
                <ShieldAlert className="h-3 w-3" aria-hidden />
                {agent.flaggedAttackCount} flagged {agent.flaggedAttackCount === 1 ? "attack" : "attacks"}
              </span>
            ) : null}
          </div>
          {agent.trustExplanation ? (
            <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-ink-muted">{agent.trustExplanation}</p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-2.5">
          <Direction
            className={`h-4 w-4 ${
              agent.trustCeilingCollapsed
                ? "text-danger"
                : agent.trustCeilingEarned
                  ? "text-success"
                  : "text-ink-faint"
            }`}
            aria-hidden
          />
          <div className="text-right">
            {/* A dash, not a zero, when nothing was measured. */}
            <p className="text-2xl font-semibold leading-none tabular-nums text-ink">
              {agent.trustScore ?? "—"}
            </p>
            <p className="mt-1 text-micro text-ink-faint">trust score</p>
          </div>
        </div>
      </div>

      <CeilingBar agent={agent} policy={policy} />

      <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-micro text-ink-faint">
        <div className="flex gap-1">
          <dt>Settled orders</dt>
          <dd className="font-semibold tabular-nums text-ink-muted">{agent.settledOrderCount}</dd>
        </div>
        <div className="flex gap-1">
          <dt>Policy declines</dt>
          <dd className="font-semibold tabular-nums text-ink-muted">{agent.declineCount}</dd>
        </div>
        <div className="flex gap-1">
          <dt>Key</dt>
          <dd className="font-semibold text-ink-muted">
            {agent.hasRegisteredKey
              ? agent.keyTrustSource === "PINNED_ON_FIRST_USE"
                ? "pinned on first use"
                : "registered by you"
              : "none on file"}
          </dd>
        </div>
      </dl>
    </li>
  );
}

export function AgentTrustPanel({ policy }: { policy: GatewayPolicy | undefined }) {
  const agents = useEnrolledAgents();
  const [showAll, setShowAll] = useState(false);

  const rows = [...(agents.data?.items ?? [])].sort(bySignal);
  const withHistory = rows.filter((a) => !isUntouched(a));
  const untouched = rows.filter(isUntouched);
  const visible = showAll ? rows : withHistory;

  const flagged = rows.filter((a) => a.flaggedAttackCount > 0).length;
  const earned = rows.filter((a) => a.trustCeilingEarned).length;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Agent trust</CardTitle>
            <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-ink-muted">
              Each agent's limit is derived from its own record with you — settled orders raise it toward the
              maximum you configured, flagged attacks collapse it below what a stranger gets. Nobody edits a
              policy to make this happen.
            </p>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-pill border border-border bg-surface-subtle px-2.5 py-1 text-micro font-medium text-ink-muted">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
            Live
          </span>
        </div>
      </CardHeader>

      {agents.isLoading ? (
        <CardBody>
          <p className="text-sm text-ink-muted">Loading agents…</p>
        </CardBody>
      ) : rows.length === 0 ? (
        <CardBody>
          <p className="text-sm text-ink-muted">
            No agent has been enrolled yet. Register an agent's signing key to let it transact, or run the demo
            to see the score move.
          </p>
        </CardBody>
      ) : (
        <>
          <div className="flex flex-wrap gap-x-6 gap-y-1.5 border-b border-border-hair bg-surface-subtle px-5 py-2.5 text-micro text-ink-muted">
            <span>
              <span className="font-semibold tabular-nums text-ink">{rows.length}</span> enrolled
            </span>
            <span>
              <span className="font-semibold tabular-nums text-ink">{earned}</span> have earned extra headroom
            </span>
            <span className={flagged > 0 ? "text-danger-text" : undefined}>
              <span className="font-semibold tabular-nums">{flagged}</span> flagged for attacks
            </span>
          </div>

          {visible.length === 0 ? (
            <CardBody>
              <p className="text-sm text-ink-muted">
                Nothing has happened with any of your {rows.length} enrolled agents yet — every one of them sits
                at the baseline and gets your unknown-agent limit.
              </p>
            </CardBody>
          ) : (
            <ul className="divide-y divide-border-hair">
              {visible.map((agent) => (
                <TrustRow key={agent.id} agent={agent} policy={policy} />
              ))}
            </ul>
          )}

          {untouched.length > 0 ? (
            <div className="border-t border-border-hair px-5 py-3">
              <button
                type="button"
                onClick={() => setShowAll((v) => !v)}
                className="text-[13px] font-medium text-brand-700 hover:text-brand-800"
              >
                {showAll
                  ? `Hide ${untouched.length} agent${untouched.length === 1 ? "" : "s"} with no history`
                  : `Show ${untouched.length} agent${untouched.length === 1 ? "" : "s"} with no history yet`}
              </button>
            </div>
          ) : null}
        </>
      )}
    </Card>
  );
}
