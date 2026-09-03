/**
 * 🛍 Commerce — everything that is a real transaction, in one place.
 *
 * WHAT MOVED HERE AND WHY
 *
 * Products, Orders, Customers, Payments and Post-Purchase were five
 * sidebar entries spread across two unrelated nav groups, so a merchant
 * chasing one order's story — what was bought, who bought it, whether the
 * money arrived, whether it was returned — walked the sidebar four times.
 * They are one subject and they are now one place.
 *
 * "Sales Analytics" was a sixth entry that rendered nothing but five
 * numbers already derived from this section's own data. It is the summary
 * strip above these tabs now rather than a destination of its own, which
 * is what it always was.
 *
 * Every figure in that strip is PAID-only and whole-history — see
 * `commerce-overview-service.ts` for why that distinction is the whole
 * point of the endpoint.
 */
import { Outlet } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { MerchantCommerceOverviewDTO } from "@razorgrowth/contracts";
import { apiGet } from "../../lib/api-client";
import { formatMoney } from "../../lib/format";
import { SectionTabs } from "../../components/layout/SectionTabs";
import { Card, CardBody } from "../../components/ui/Card";
import { Skeleton } from "../../components/ui/States";

/**
 * The four operational subsections, in the order a merchant reasons about
 * them: what you sell, who buys it, what they ordered, whether the money
 * arrived.
 *
 * Post-Purchase sits at the end rather than as a fifth peer. Refunds,
 * returns and disputes are what happens AFTER the four states above are
 * settled, and they are reached from the order they belong to — but the
 * page is real, tested and the only way to refund a captured payment from
 * the console, so it stays reachable rather than being removed to make a
 * list of four look tidy.
 */
const TABS = [
  { to: "/merchant/commerce/products", label: "Products" },
  { to: "/merchant/commerce/customers", label: "Customers" },
  { to: "/merchant/commerce/orders", label: "Orders" },
  { to: "/merchant/commerce/payments", label: "Payments" },
  { to: "/merchant/commerce/post-purchase", label: "Post-Purchase" },
] as const;

function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <Card>
      <CardBody className="py-3">
        <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">{label}</p>
        <p className="mt-1 text-xl font-bold tabular-nums text-ink">{value}</p>
        {note ? <p className="mt-0.5 text-xs text-ink-muted">{note}</p> : null}
      </CardBody>
    </Card>
  );
}

function CommerceSummary() {
  const query = useQuery({
    queryKey: ["merchant", "commerce-overview"],
    queryFn: () => apiGet<MerchantCommerceOverviewDTO>("/merchant/commerce-overview"),
  });

  if (query.isPending) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
      </div>
    );
  }
  // A summary strip that cannot load is not worth an error card above every
  // tab in the section — the tab below states its own failure.
  if (query.isError || !query.data) return null;

  const { analytics } = query.data;
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Metric label="Captured revenue" value={formatMoney({ amountMinor: analytics.receivedRevenueMinor, currency: analytics.currency })} note={`${analytics.capturedPaymentCount} captured payment${analytics.capturedPaymentCount === 1 ? "" : "s"}`} />
      <Metric label="Orders received" value={String(analytics.orderCount)} note={`${analytics.paidOrderCount} paid`} />
      <Metric
        label="Average paid order"
        value={formatMoney({ amountMinor: analytics.averageOrderValueMinor, currency: analytics.currency })}
        note={analytics.paidOrderCount === 0 ? "No paid orders yet" : `Across ${analytics.paidOrderCount} paid order${analytics.paidOrderCount === 1 ? "" : "s"}`}
      />
      <Metric label="Customers" value={String(analytics.customerCount)} />
    </div>
  );
}

export default function CommerceSection() {
  return (
    <div className="space-y-6">
      <CommerceSummary />
      <SectionTabs tabs={TABS} />
      <Outlet />
    </div>
  );
}
