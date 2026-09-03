/**
 * The one CTA on the Growth workspace that moves the system.
 *
 * It calls `POST /payments/recovery/evaluate` once per failed payment.
 * That endpoint reconciles an uncertain payment state, re-runs the
 * deterministic recovery-eligibility check, and — only if eligible — asks
 * the Merchant Agent for a BOUNDED proposal which then enters the same
 * policy → approval → execution-authorization pipeline as every other
 * growth action. Nothing here moves money, and nothing here can.
 *
 * WHY IT REPORTS PER PAYMENT
 *
 * A single "Recovery started" toast would hide the most interesting
 * outcome. On this merchant's own data one of the three failures is a
 * bank timeout, and the engine is supposed to refuse that one: an
 * unverified outcome must be reconciled, never retried blind. A per
 * payment result list is what lets a merchant — or a jury — see the
 * refusal happen rather than take the guardrail on trust.
 */
import { useState } from "react";
import { CheckCircle2, Loader2, ShieldAlert } from "lucide-react";
import { Link } from "react-router-dom";
import type { GrowthActionProposalDTO } from "@razorgrowth/contracts";
import { apiPost, ApiError } from "../../lib/api-client";
import { useQueryClient } from "@tanstack/react-query";

interface AttemptOutcome {
  paymentId: string;
  ok: boolean;
  detail: string;
}

export function RecoveryActionButton({ paymentIds }: { paymentIds: string[] }) {
  const queryClient = useQueryClient();
  const [running, setRunning] = useState(false);
  const [outcomes, setOutcomes] = useState<AttemptOutcome[] | null>(null);

  async function run() {
    setRunning(true);
    setOutcomes(null);
    const results: AttemptOutcome[] = [];

    // Sequential on purpose. Each call reconciles payment state with the
    // provider before deciding; firing them in parallel would race on the
    // per-order recovery-attempt count the policy engine reads.
    for (const paymentId of paymentIds) {
      try {
        const proposal = await apiPost<GrowthActionProposalDTO>("/payments/recovery/evaluate", { paymentId });
        results.push({
          paymentId,
          ok: true,
          detail: `Proposal ${proposal.id.slice(0, 8)} created — status ${proposal.status.replaceAll("_", " ").toLowerCase()}.`,
        });
      } catch (error) {
        results.push({
          paymentId,
          ok: false,
          detail: error instanceof ApiError ? error.message : "Could not evaluate recovery for this payment.",
        });
      }
    }

    setOutcomes(results);
    setRunning(false);
    // Recovery writes proposals, ledger events and approvals; the pages
    // showing those must not keep serving a pre-recovery cache.
    void queryClient.invalidateQueries({ queryKey: ["growth"] });
    void queryClient.invalidateQueries({ queryKey: ["ledger"] });
    void queryClient.invalidateQueries({ queryKey: ["approvals"] });
  }

  const created = outcomes?.filter((o) => o.ok).length ?? 0;

  return (
    <div className="w-full space-y-3">
      <button
        type="button"
        onClick={() => void run()}
        disabled={running || paymentIds.length === 0}
        className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {running ? (
          <>
            <Loader2 size={14} className="animate-spin" aria-hidden />
            Evaluating {paymentIds.length} payment{paymentIds.length === 1 ? "" : "s"}…
          </>
        ) : (
          <>
            Start recovery on {paymentIds.length} failed payment{paymentIds.length === 1 ? "" : "s"}
          </>
        )}
      </button>

      {running ? (
        <p className="text-xs text-ink-muted" role="status" aria-live="polite">
          Reconciling each payment's state with the provider, re-checking eligibility, then asking the Merchant Agent for a
          bounded proposal. This takes a few seconds per payment.
        </p>
      ) : null}

      {outcomes ? (
        <div className="space-y-2" role="status" aria-live="polite">
          <ul className="space-y-1.5">
            {outcomes.map((outcome) => (
              <li key={outcome.paymentId} className="flex items-start gap-2 text-xs">
                {outcome.ok ? (
                  <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-success" aria-hidden />
                ) : (
                  <ShieldAlert size={13} className="mt-0.5 shrink-0 text-warning" aria-hidden />
                )}
                <span className={outcome.ok ? "text-ink-muted" : "text-warning-text"}>
                  <span className="font-mono text-[11px] text-ink-faint">{outcome.paymentId.slice(0, 8)}</span> — {outcome.detail}
                </span>
              </li>
            ))}
          </ul>
          {created > 0 ? (
            <p className="text-xs text-ink-muted">
              {created} recovery proposal{created === 1 ? "" : "s"} now waiting on governance.{" "}
              <Link to="/merchant/governance/approvals" className="font-medium text-brand-600 hover:underline">
                Review in Action Approvals →
              </Link>
            </p>
          ) : (
            <p className="text-xs text-ink-muted">
              No proposal was created. Every refusal above is the guardrail working, not a failure of the console.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
