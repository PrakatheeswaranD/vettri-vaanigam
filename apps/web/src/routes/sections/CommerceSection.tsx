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

/**
 * PART 18 — Commerce now opens with how much of this was agentic.
 *
 * The section led with captured revenue, order count, average order and
 * customer count: four figures any storefront dashboard shows, none of
 * which say whether an agent did anything. A merchant evaluating an
 * AI-native commerce system had to go to a different section to find out.
 *
 * Every number here is PAID-only and whole-history, the same basis as the
 * strip below, and the merchant's own agent is kept separate from
 * external buyer agents throughout — see the DTO for why they are never
 * summed into a single "AI revenue" headline.
 */
function AgentAttribution({
  attribution,
  money,
  sharePercent,
  attributableMinor,
}: {
  attribution: MerchantCommerceOverviewDTO["agentAttribution"];
  money: (amountMinor: number) => string;
  sharePercent: number | null;
  attributableMinor: number;
}) {
  const { ownAgentPaidOrderCount, ownAgentPaidRevenueMinor, externalAgentPaidOrderCount, externalAgentPaidRevenueMinor, humanPaidRevenueMinor } = attribution;

  // Nothing settled yet. An empty bar and "0%" would read as a verdict on
  // the agent rather than as an absence of data.
  if (attributableMinor === 0) {
    return (
      <Card>
        <CardBody className="py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">Agent-attributed revenue</p>
          <p className="mt-1 text-sm text-ink-muted">
            No paid orders yet, so there is nothing to attribute. This fills in from settled orders, never from projections.
          </p>
        </CardBody>
      </Card>
    );
  }

  const pct = (minor: number) => (minor / attributableMinor) * 100;
  // Two shades of the brand ramp for the two agentic buckets, and a
  // neutral for direct. Deliberately NOT `accent`: the palette reserves
  // amber for "a human needs to decide this", and attribution is a
  // reading, not a decision waiting on someone.
  const segments = [
    { key: "own", minor: ownAgentPaidRevenueMinor, className: "bg-brand-600" },
    { key: "external", minor: externalAgentPaidRevenueMinor, className: "bg-brand-300" },
    { key: "human", minor: humanPaidRevenueMinor, className: "bg-border-strong" },
  ].filter((segment) => segment.minor > 0);

  return (
    <Card>
      <CardBody className="py-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">Agent-attributed revenue</p>
          <p className="text-xs text-ink-muted">
            {sharePercent}% of {money(attributableMinor)} settled
          </p>
        </div>

        <div className="mt-2 flex h-2 w-full overflow-hidden rounded-full bg-surface-sunken" role="presentation">
          {segments.map((segment) => (
            <div key={segment.key} className={segment.className} style={{ width: `${pct(segment.minor)}%` }} />
          ))}
        </div>

        <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-3">
          <div>
            <dt className="text-xs text-ink-muted">This merchant&rsquo;s agent</dt>
            <dd className="text-sm font-semibold tabular-nums text-ink">
              {money(ownAgentPaidRevenueMinor)}{" "}
              <span className="font-normal text-ink-muted">
                · {ownAgentPaidOrderCount} order{ownAgentPaidOrderCount === 1 ? "" : "s"}
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink-muted">External buyer agents</dt>
            <dd className="text-sm font-semibold tabular-nums text-ink">
              {money(externalAgentPaidRevenueMinor)}{" "}
              <span className="font-normal text-ink-muted">
                · {externalAgentPaidOrderCount} order{externalAgentPaidOrderCount === 1 ? "" : "s"}
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink-muted">Direct</dt>
            <dd className="text-sm font-semibold tabular-nums text-ink">{money(humanPaidRevenueMinor)}</dd>
          </div>
        </dl>

        <p className="mt-2 text-xs text-ink-faint">
          Paid orders only, whole history. An order placed by another party&rsquo;s buyer agent is counted separately —
          it is real agentic commerce, but not this merchant&rsquo;s agent&rsquo;s work.
        </p>
      </CardBody>
    </Card>
  );
}

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

  const { analytics, agentAttribution } = query.data;
  const money = (amountMinor: number) => formatMoney({ amountMinor, currency: analytics.currency });

  // The denominator is settled revenue the console can attribute, which is
  // the sum of the three buckets — not `receivedRevenueMinor`. Those are
  // different bases (captured PAYMENTS versus PAID ORDER totals), and
  // dividing one by the other would produce a share that is quietly wrong.
  const attributableMinor =
    agentAttribution.ownAgentPaidRevenueMinor +
    agentAttribution.externalAgentPaidRevenueMinor +
    agentAttribution.humanPaidRevenueMinor;
  const agentMinor = agentAttribution.ownAgentPaidRevenueMinor + agentAttribution.externalAgentPaidRevenueMinor;
  const agentSharePercent = attributableMinor === 0 ? null : Math.round((agentMinor / attributableMinor) * 100);

  return (
    <div className="space-y-3">
      <AgentAttribution
        attribution={agentAttribution}
        money={money}
        sharePercent={agentSharePercent}
        attributableMinor={attributableMinor}
      />
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
