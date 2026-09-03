/**
 * 🛍 Commerce → Payments — payment state, and the recovery work attached
 * to it.
 *
 * THE STATE THIS PAGE EXISTS TO SURFACE
 *
 * UNKNOWN. A payment in UNKNOWN had an attempt made and its outcome never
 * established with the provider. The Revenue Opportunity Engine filtered
 * `state === "FAILED"` and nothing else, so these were detected by no
 * detector and worked by no cycle — money neither recovered nor written
 * off, on no screen and in no queue. The demo merchant had four.
 *
 * They are first here, and each carries the one honest action available:
 * ask the provider. That runs from this row rather than from somewhere
 * else, which is the whole point of the Commerce section being the agent's
 * action layer as well as the merchant's.
 */
import { Receipt } from "lucide-react";
import { useCommercePayments } from "../../hooks/use-commerce";
import { PageHeader } from "../../components/layout/PageHeader";
import { Card, CardBody } from "../../components/ui/Card";
import { EmptyState, ErrorState, Skeleton } from "../../components/ui/States";
import { PaymentStateBadge } from "../../components/ui/StatusBadge";
import { AttachedOpportunities } from "../../components/commerce/AttachedOpportunities";
import { formatDateTime, formatMoney } from "../../lib/format";

const VERIFICATION_NOTE: Record<string, string> = {
  UNVERIFIED: "Outcome never confirmed with the provider.",
  VERIFIED: "Confirmed with the provider.",
  NOT_APPLICABLE: "Still in flight — there is nothing to confirm yet.",
};

export default function CommercePaymentsPage() {
  const query = useCommercePayments();

  if (query.isPending) {
    return (
      <div className="space-y-3" role="status" aria-label="Loading payments">
        <Skeleton className="h-24" />
        <Skeleton className="h-56" />
      </div>
    );
  }
  if (query.isError || !query.data) {
    return (
      <Card>
        <ErrorState message="Could not load payments." onRetry={() => void query.refetch()} />
      </Card>
    );
  }

  const { payments, window, currency, totals } = query.data;

  // Unresolved money first: a payment nobody has confirmed, then one known
  // to have failed, then everything settled. Sorting by date would bury
  // the only rows that need a decision.
  const ordered = [...payments].sort((a, b) => {
    const rank = (state: string, verification: string) =>
      verification === "UNVERIFIED" ? 0 : state === "FAILED" ? 1 : 2;
    return rank(a.state, a.verification) - rank(b.state, b.verification);
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payments"
        lead="What the provider has actually confirmed, what failed, and what nobody has asked about yet."
      />

      <Card>
        <CardBody className="grid gap-4 py-3 sm:grid-cols-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">Captured</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-ink">
              {formatMoney({ amountMinor: totals.capturedMinor, currency })}
            </p>
            <p className="text-xs text-ink-muted">provider-confirmed</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">Failed</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-ink">{totals.failedCount}</p>
            <p className="text-xs text-ink-muted">{totals.recoverableCount} the agent can work on</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">Unknown outcome</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-ink">{totals.unverifiedCount}</p>
            <p className="text-xs text-ink-muted">neither recovered nor written off</p>
          </div>
        </CardBody>
      </Card>

      {ordered.length === 0 ? (
        <Card>
          <EmptyState icon={<Receipt size={18} />} title="No payments yet" description="Payments appear here as customers check out." />
        </Card>
      ) : (
        <div className="space-y-3">
          {ordered.map((payment) => (
            <Card key={payment.id}>
              <CardBody>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <PaymentStateBadge state={payment.state} />
                      {payment.verification === "UNVERIFIED" ? (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                          Unverified
                        </span>
                      ) : null}
                      {payment.attemptNumber > 1 ? (
                        <span className="text-xs text-ink-faint">attempt {payment.attemptNumber}</span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-xs text-ink-muted">
                      {formatDateTime(payment.createdAt)} · {payment.provider}
                      {payment.failureCategory ? ` · ${payment.failureCategory.replaceAll("_", " ").toLowerCase()}` : ""}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-faint">
                      {VERIFICATION_NOTE[payment.verification]}
                      {payment.lastReconciledAt ? ` Last checked ${formatDateTime(payment.lastReconciledAt)}.` : ""}
                    </p>
                  </div>
                  <p className="shrink-0 font-semibold tabular-nums text-ink">
                    {formatMoney({ amountMinor: payment.amountMinor, currency: payment.currency })}
                  </p>
                </div>
                <AttachedOpportunities opportunities={payment.opportunities} subjectId={payment.id} />
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      <p className="text-xs text-ink-faint">
        Showing {window.returned} of {window.total} payments, unresolved money first.
      </p>
    </div>
  );
}
