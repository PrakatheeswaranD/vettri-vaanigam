import { Fragment, useState } from "react";
import { Receipt, LifeBuoy } from "lucide-react";
import { useTransactions } from "../hooks/use-api";
import { Card } from "../components/ui/Card";
import { EmptyState, ErrorState, Skeleton } from "../components/ui/States";
import { PaymentStateBadge } from "../components/ui/StatusBadge";
import { formatDateTime, formatMoney } from "../lib/format";
import { ApiError } from "../lib/api-client";
import { PageHeader } from "../components/layout/PageHeader";
import { RecoveryPanel } from "../components/commerce/RecoveryPanel";

const SOURCE_LABEL: Record<string, string> = {
  DIRECT_BUYER: "Direct",
  AI_CROSS_SELL: "AI cross-sell",
  AI_UPSELL: "AI upsell",
  AI_BUNDLE: "AI bundle",
  AI_BOUNDED_OFFER: "AI bounded offer",
  AI_RECOVERY: "AI recovery",
  direct: "Direct", // PART 01 legacy seed value, predating the closed PART 06 vocabulary
};

export default function TransactionsPage() {
  const [page, setPage] = useState(1);
  /**
   * Which failed payment has its recovery pipeline open.
   *
   * The recovery pipeline — evaluate, merchant policy, approval, bounded
   * retry — was fully built and reachable ONLY from the merchant-agent
   * growth checkout. Failures do not happen there; they happen here, on
   * the payments list, where the merchant was shown "FAILED · Retry
   * blocked" and given nothing to do about it. The capability existed and
   * the affordance did not, which is indistinguishable from not having it.
   */
  const [recovering, setRecovering] = useState<string | null>(null);
  const { data, isLoading, isError, error, refetch } = useTransactions({ page, limit: 15 });

  return (
    <div className="space-y-6">
      <div>
        <PageHeader
          title={"Payments"}
          lead={"Orders and their payment outcomes, including anything that failed and how it was recovered."}
        />
      </div>

      {isLoading ? (
        <Skeleton className="h-96 w-full" />
      ) : isError ? (
        <Card>
          <ErrorState
            message={error instanceof ApiError ? error.message : "Could not load transactions."}
            onRetry={() => refetch()}
          />
        </Card>
      ) : !data || data.items.length === 0 ? (
        <Card>
          <EmptyState icon={<Receipt size={18} />} title="No transactions yet" description="Orders and payments will appear here once checkout is available." />
        </Card>
      ) : (
        <>
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-border text-xs text-ink-faint">
                <tr>
                  <th className="px-4 py-3 font-medium">Order</th>
                  <th className="px-4 py-3 font-medium">Customer</th>
                  <th className="px-4 py-3 font-medium">Amount</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Debit / Credit</th>
                  <th className="px-4 py-3 font-medium">Source</th>
                  <th className="px-4 py-3 font-medium">Provider</th>
                  <th className="px-4 py-3 font-medium">Captured</th>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium sr-only">Recovery</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((tx) => (
                  <Fragment key={tx.orderId}>
                  <tr className="border-b border-border last:border-0">
                    <td className="px-4 py-3 font-mono text-xs text-ink-muted">{tx.orderId.slice(0, 8)}</td>
                    <td className="px-4 py-3 text-ink">{tx.customerName}</td>
                    <td className="px-4 py-3 font-medium text-ink">{formatMoney(tx.amount)}</td>
                    <td className="px-4 py-3">
                      <PaymentStateBadge state={tx.state} />
                    </td>
                    <td className="px-4 py-3 text-xs"><p>{tx.customerDebitStatus}</p><p className="text-ink-faint">{tx.merchantCreditStatus}</p>{tx.automaticRetryBlocked ? <span className="font-semibold text-danger-text">Retry blocked</span> : null}</td>
                    <td className="px-4 py-3 text-xs text-ink-faint">{tx.source ? (SOURCE_LABEL[tx.source] ?? tx.source) : "—"}</td>
                    <td className="px-4 py-3 text-xs text-ink-faint">
                      {tx.provider}
                      {tx.providerPaymentId ? <span className="ml-1 font-mono text-[10px] opacity-70">({tx.providerPaymentId.slice(0, 12)}…)</span> : null}
                    </td>
                    <td className="px-4 py-3 text-xs text-ink-faint">{tx.capturedAt ? formatDateTime(tx.capturedAt) : "—"}</td>
                    <td className="px-4 py-3 text-xs text-ink-faint">{formatDateTime(tx.createdAt)}</td>
                    <td className="px-4 py-3 text-right">
                      {tx.state === "FAILED" && tx.paymentId ? (
                        <button
                          type="button"
                          onClick={() => setRecovering((current) => (current === tx.paymentId ? null : tx.paymentId))}
                          className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs font-semibold hover:bg-surface-subtle"
                        >
                          <LifeBuoy size={12} />
                          {recovering === tx.paymentId ? "Close" : "Recover"}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                  {recovering === tx.paymentId && tx.paymentId ? (
                    <tr className="border-b border-border bg-surface-subtle last:border-0">
                      <td colSpan={10} className="px-4 py-4">
                        {/* Recovery is never automatic. This runs the same
                            evaluate -> policy -> approval -> bounded retry
                            pipeline the API enforces; the button only opens
                            it. */}
                        <RecoveryPanel paymentId={tx.paymentId} />
                      </td>
                    </tr>
                  ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </Card>

          <div className="flex items-center justify-between text-sm text-ink-muted">
            <span>
              Page {data.pagination.page} of {data.pagination.totalPages} · {data.pagination.total} transactions
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded-md border border-border px-3 py-1.5 disabled:opacity-40"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={page >= data.pagination.totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="rounded-md border border-border px-3 py-1.5 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
