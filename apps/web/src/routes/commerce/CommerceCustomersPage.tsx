/**
 * 🛍 Commerce → Customers — observable behaviour, and what may be done
 * about it.
 *
 * WHAT IS DELIBERATELY ABSENT
 *
 * Any predicted number. There is no churn risk, no propensity score and no
 * projected lifetime value, because this build has no basis for one — and
 * a confident-looking figure without a basis is exactly what the rest of
 * this product refuses to print.
 *
 * Everything here was observed: orders they paid for, what those came to,
 * how long between them. Where a gap cannot be measured — one paid order,
 * so no interval exists — it says so rather than showing zero.
 *
 * The opportunities are the Revenue Opportunity Engine's, attached to the
 * customer by subject id on the server. This page does not detect anything.
 */
import { Users } from "lucide-react";
import { useCommerceCustomers } from "../../hooks/use-commerce";
import { PageHeader } from "../../components/layout/PageHeader";
import { Card, CardBody } from "../../components/ui/Card";
import { EmptyState, ErrorState, Skeleton } from "../../components/ui/States";
import { AttachedOpportunities } from "../../components/commerce/AttachedOpportunities";
import { formatDateTime, formatMoney } from "../../lib/format";

export default function CommerceCustomersPage() {
  const query = useCommerceCustomers();

  if (query.isPending) {
    return (
      <div className="space-y-3" role="status" aria-label="Loading customers">
        <Skeleton className="h-24" />
        <Skeleton className="h-56" />
      </div>
    );
  }
  if (query.isError || !query.data) {
    return (
      <Card>
        <ErrorState message="Could not load customers." onRetry={() => void query.refetch()} />
      </Card>
    );
  }

  const { customers, window, currency } = query.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Customers"
        lead="People who have bought from you, described only by what they actually did. Nothing here is predicted."
      />

      {customers.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Users size={18} />}
            title="No customers yet"
            description="A customer appears here once they interact with your commerce flow."
          />
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {customers.map((customer) => {
            const b = customer.behaviour;
            return (
              <Card key={customer.id}>
                <CardBody>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-ink">{customer.displayName}</p>
                      <p className="truncate text-xs text-ink-muted">
                        {customer.email ?? "No email"}
                        {customer.segment ? ` · ${customer.segment}` : ""}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-semibold tabular-nums text-ink">
                        {formatMoney({ amountMinor: b.lifetimeValueMinor, currency })}
                      </p>
                      <p className="text-xs text-ink-faint">paid to date</p>
                    </div>
                  </div>

                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 border-t border-border-hair pt-3 text-xs">
                    <div className="flex justify-between gap-2">
                      <dt className="text-ink-muted">Paid orders</dt>
                      <dd className="tabular-nums text-ink">
                        {b.paidOrderCount} of {b.orderCount}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-ink-muted">Average order</dt>
                      {/* Null, not zero. An average over no paid orders is
                          not a number, and printing 0 would read as "they
                          spend nothing". */}
                      <dd className="tabular-nums text-ink">
                        {b.averageOrderValueMinor === null
                          ? "—"
                          : formatMoney({ amountMinor: b.averageOrderValueMinor, currency })}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-ink-muted">Typical gap</dt>
                      <dd className="tabular-nums text-ink">
                        {b.medianGapDays === null ? "not yet measurable" : `${b.medianGapDays}d`}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-ink-muted">From your agent</dt>
                      <dd className="tabular-nums text-ink">{b.agentAttributedOrderCount}</dd>
                    </div>
                  </dl>

                  <p className="mt-2 text-xs text-ink-faint">
                    {b.lastPaidOrderAt ? `Last paid ${formatDateTime(b.lastPaidOrderAt)}` : "No paid orders yet"}
                  </p>

                  <AttachedOpportunities opportunities={customer.opportunities} subjectId={customer.id} />
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}

      <p className="text-xs text-ink-faint">
        Showing {window.returned} of {window.total} customers.
      </p>
    </div>
  );
}
