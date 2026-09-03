/**
 * 🛍 Commerce → Orders — order state, revenue, payment state, and who
 * brought the order in.
 *
 * TOTAL IS NOT REVENUE
 *
 * Every row shows both, and they are different claims. `totalAmountMinor`
 * is what the order came to; `capturedMinor` is what the provider has
 * actually confirmed arriving. An order can be PAID in status with money
 * still in flight, and presenting the intended total as received revenue
 * is the specific mistake that had two screens in this console stating
 * different revenue for the same merchant.
 *
 * ATTRIBUTION IS A COLUMN, NOT A GUESS
 *
 * "Your agent brought this in" is backed by `OrderItem.growthProposalId` —
 * written when a line enters a basket because an agent proposal put it
 * there — and by the order's own recorded `source`. Orders that arrived
 * through the agent gateway are labelled as an EXTERNAL buyer agent and
 * are not counted as this merchant's own agent's work, because they are
 * not.
 */
import { Package } from "lucide-react";
import { useCommerceOrders } from "../../hooks/use-commerce";
import { PageHeader } from "../../components/layout/PageHeader";
import { Card, CardBody, CardHeader, CardTitle } from "../../components/ui/Card";
import { EmptyState, ErrorState, Skeleton } from "../../components/ui/States";
import { AttachedOpportunities } from "../../components/commerce/AttachedOpportunities";
import { formatDateTime, formatMoney } from "../../lib/format";

export default function CommerceOrdersPage() {
  const query = useCommerceOrders();

  if (query.isPending) {
    return (
      <div className="space-y-3" role="status" aria-label="Loading orders">
        <Skeleton className="h-24" />
        <Skeleton className="h-56" />
      </div>
    );
  }
  if (query.isError || !query.data) {
    return (
      <Card>
        <ErrorState message="Could not load orders." onRetry={() => void query.refetch()} />
      </Card>
    );
  }

  const { orders, window, currency, totals } = query.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Orders"
        lead="Orders received from customers and from buyer agents, with what was actually captured against each."
      />

      <Card>
        <CardBody className="grid gap-4 py-3 sm:grid-cols-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">Paid orders</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-ink">{totals.paidOrderCount}</p>
            <p className="text-xs text-ink-muted">whole history</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">Your agent's orders</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-ink">{totals.agentAttributedOrderCount}</p>
            <p className="text-xs text-ink-muted">in any status</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">Captured on those</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-ink">
              {formatMoney({ amountMinor: totals.agentAttributedCapturedMinor, currency })}
            </p>
            {/* The distinction the whole page turns on. */}
            <p className="text-xs text-ink-muted">provider-confirmed, not order totals</p>
          </div>
        </CardBody>
      </Card>

      {orders.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Package size={18} />}
            title="No orders yet"
            description="Orders appear here as customers and buyer agents purchase from you."
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {orders.map((order) => (
            <Card key={order.id}>
              <CardHeader className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <CardTitle>{order.customer?.displayName ?? "Guest customer"}</CardTitle>
                  <p className="mt-1 text-xs text-ink-muted">
                    {formatDateTime(order.createdAt)} · {order.attribution.label}
                    {order.attribution.proposalId ? " · from an agent proposal" : ""}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-semibold tabular-nums text-ink">
                    {formatMoney({ amountMinor: order.totalAmountMinor, currency: order.currency })}
                  </p>
                  <p className="text-xs text-ink-muted">
                    {order.status}
                    {" · "}
                    {order.payment ? `payment ${order.payment.state.toLowerCase()}` : "no payment started"}
                  </p>
                  <p className="text-xs tabular-nums text-ink-faint">
                    {order.capturedMinor > 0
                      ? `${formatMoney({ amountMinor: order.capturedMinor, currency: order.currency })} captured`
                      : "nothing captured yet"}
                  </p>
                </div>
              </CardHeader>
              <CardBody>
                <ul className="space-y-1">
                  {order.items.map((item, index) => (
                    <li key={`${order.id}-${index}`} className="flex justify-between gap-4 text-sm">
                      <span className="truncate text-ink">
                        {item.productNameSnapshot} · {item.variantTitleSnapshot} × {item.quantity}
                      </span>
                      <span className="shrink-0 tabular-nums text-ink-muted">
                        {formatMoney({ amountMinor: item.lineTotalMinor, currency: order.currency })}
                      </span>
                    </li>
                  ))}
                </ul>
                <AttachedOpportunities opportunities={order.opportunities} subjectId={order.payment?.id ?? order.id} />
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      <p className="text-xs text-ink-faint">
        Showing the {window.returned} most recent of {window.total} orders.
      </p>
    </div>
  );
}
