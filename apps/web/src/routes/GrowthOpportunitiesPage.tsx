/**
 * Growth Opportunities — the merchant's command centre.
 *
 * WHAT THIS PAGE REPLACED
 *
 * A flat, unranked list of catalogue nits ("this product has no related
 * products"), every card the same weight, none carrying a value, none
 * carrying an action. A merchant reading it could not tell which line was
 * worth their next ten minutes, which is the only question the page
 * exists to answer.
 *
 * THE ONE RULE THIS PAGE FOLLOWS
 *
 * Three money totals, never added together. At-risk is OBSERVED, the
 * ceiling is an OPPORTUNITY bound, and the incremental figure is
 * ESTIMATED and present only where the merchant's own history supports a
 * rate. A single blended "total opportunity value" would be the most
 * impressive number on the screen and the least true one, so it is not
 * computed anywhere — not here, and not in the engine.
 */
import { AlertTriangle, RefreshCw, TrendingUp } from "lucide-react";
import { useRevenueOpportunities } from "../hooks/use-revenue-engine";
import { PageHeader } from "../components/layout/PageHeader";
import { Card, CardBody } from "../components/ui/Card";
import { EmptyState, ErrorState, Skeleton } from "../components/ui/States";
import { RevenueOpportunityCard } from "../components/growth/RevenueOpportunityCard";
import { opportunityAction } from "../components/growth/OpportunityAction";
import { CompositeScorePanel } from "../components/growth/CompositeScorePanel";
import { formatMoney, formatDateTime } from "../lib/format";
import { ApiError } from "../lib/api-client";


function TotalTile({
  label,
  amount,
  currency,
  classification,
  note,
}: {
  label: string;
  amount: number;
  currency: "INR" | "USD";
  classification: "OBSERVED" | "ESTIMATED" | "OPPORTUNITY";
  note: string;
}) {
  const tone =
    classification === "OBSERVED" ? "text-ink" : classification === "ESTIMATED" ? "text-info-text" : "text-ink-muted";
  const badge =
    classification === "OBSERVED"
      ? "bg-success-subtle text-success-text"
      : classification === "ESTIMATED"
        ? "bg-info-subtle text-info-text"
        : "bg-surface-sunken text-ink-muted";
  const badgeLabel =
    classification === "OBSERVED" ? "Observed" : classification === "ESTIMATED" ? "Estimated" : "Potential";

  return (
    <Card>
      <CardBody>
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">{label}</p>
          <span className={`rounded-pill px-2 py-0.5 text-[10px] font-semibold ${badge}`}>{badgeLabel}</span>
        </div>
        <p className={`mt-2 text-2xl font-bold tabular-nums ${tone}`}>{formatMoney({ amountMinor: amount, currency })}</p>
        <p className="mt-1.5 text-[11px] leading-snug text-ink-faint">{note}</p>
      </CardBody>
    </Card>
  );
}

export default function GrowthOpportunitiesPage() {
  const query = useRevenueOpportunities();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Growth opportunities"
        lead="Everything in your own data that is currently costing you revenue or could earn more, ranked by what is worth doing first."
        actions={
          <button
            type="button"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-ink hover:bg-surface-subtle disabled:opacity-50"
          >
            <RefreshCw size={14} className={query.isFetching ? "animate-spin" : undefined} aria-hidden />
            Rescan
          </button>
        }
      />

      {query.isPending ? (
        <div className="space-y-4" role="status" aria-label="Loading revenue opportunities">
          <div className="grid gap-4 sm:grid-cols-3">
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
          </div>
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      ) : query.isError ? (
        <Card>
          <ErrorState
            message={query.error instanceof ApiError ? query.error.message : "Could not run the revenue opportunity scan."}
            onRetry={() => void query.refetch()}
          />
        </Card>
      ) : (
        (() => {
          const { opportunities, totals, growthScore, aiBuyerScore, observed, generatedAt } = query.data;

          return (
            <>
              {/* Three totals, three classifications, never summed. */}
              <div className="grid gap-4 sm:grid-cols-3">
                <TotalTile
                  label="Revenue at risk now"
                  amount={totals.totalAtRiskMinor}
                  currency={totals.currency}
                  classification="OBSERVED"
                  note="Money in failed and stalled payments. This is a sum of real rows, not a projection."
                />
                <TotalTile
                  label="Addressable ceiling"
                  amount={totals.totalAddressableMinor}
                  currency={totals.currency}
                  classification="OPPORTUNITY"
                  note="What every opportunity below would be worth if all of them succeeded. An upper bound, not a target."
                />
                <TotalTile
                  label="Expected incremental"
                  amount={totals.totalExpectedIncrementalMinor}
                  currency={totals.currency}
                  classification="ESTIMATED"
                  note={
                    totals.withheldEstimateCount > 0
                      ? `Only from opportunities your own history can support a rate for. ${totals.withheldEstimateCount} of ${totals.opportunityCount} withheld an estimate rather than guess.`
                      : "Derived from rates observed in your own order history."
                  }
                />
              </div>

              {totals.withheldEstimateCount > 0 ? (
                <Card className="border-warning-border bg-warning-subtle">
                  <CardBody className="flex items-start gap-3">
                    <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warning-text" aria-hidden />
                    <div className="text-sm leading-relaxed text-warning-text">
                      <span className="font-semibold">
                        {totals.withheldEstimateCount} of {totals.opportunityCount} opportunities cannot yet be given a rupee
                        forecast.
                      </span>{" "}
                      Forecasting needs a rate observed in your own history — a recovery rate, an attach rate, a response
                      rate — and you have not run those actions enough times yet. The "at risk" and "ceiling" figures on
                      those cards are still real. Each card states exactly which number is missing and why.
                    </div>
                  </CardBody>
                </Card>
              ) : null}

              <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
                <div className="space-y-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-faint">
                      Ranked worklist ({opportunities.length})
                    </h2>
                    <p className="text-[11px] text-ink-faint">Scanned {formatDateTime(generatedAt)}</p>
                  </div>

                  {opportunities.length === 0 ? (
                    <Card>
                      <EmptyState
                        icon={<TrendingUp size={18} />}
                        title="Nothing needs your attention"
                        description="No failed payments, no stalled checkouts, no overdue customers and no catalogue gaps. This is the good empty state — it means the scan ran and found nothing wrong."
                      />
                    </Card>
                  ) : (
                    opportunities.map((opportunity, index) => (
                      <RevenueOpportunityCard
                        key={opportunity.id}
                        opportunity={opportunity}
                        rank={index + 1}
                        action={opportunityAction(opportunity)}
                      />
                    ))
                  )}
                </div>

                <aside className="space-y-4">
                  <CompositeScorePanel
                    title="Revenue Growth Score"
                    lead="How much of your own revenue machinery is actually working. Every point comes from a fact in your data — none from a feature being built."
                    score={growthScore}
                  />
                  <CompositeScorePanel
                    title="AI Buyer Capability Score"
                    lead="What AI buyers have actually done here, not what the system could do. A capability scores only once the data shows it ran."
                    score={aiBuyerScore}
                  />

                  <Card>
                    <CardBody className="space-y-2">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                        What the scan reasoned over
                      </p>
                      <dl className="space-y-1 text-xs">
                        {(
                          [
                            ["Captured revenue", formatMoney({ amountMinor: observed.capturedRevenueMinor, currency: observed.currency })],
                            ["Average paid order", formatMoney({ amountMinor: observed.averageOrderValueMinor, currency: observed.currency })],
                            ["Paid orders", `${observed.paidOrderCount} of ${observed.ordersWithPaymentAttempt} attempted`],
                            ["Failed payments", `${observed.failedPaymentCount}, ${observed.recoveredPaymentCount} recovered`],
                            ["Customers", `${observed.customerCount}, ${observed.repeatCustomerCount} repeat`],
                            ["Agent-ready products", `${observed.transactableProductCount} of ${observed.agentVisibleProductCount}`],
                          ] as const
                        ).map(([label, value]) => (
                          <div key={label} className="flex justify-between gap-3">
                            <dt className="text-ink-muted">{label}</dt>
                            <dd className="shrink-0 font-medium tabular-nums text-ink">{value}</dd>
                          </div>
                        ))}
                      </dl>
                      <p className="pt-1 text-[11px] leading-snug text-ink-faint">
                        Every figure above is countable in your own orders and payments. The engine derives nothing from
                        industry averages.
                      </p>
                    </CardBody>
                  </Card>
                </aside>
              </div>
            </>
          );
        })()
      )}

    </div>
  );
}
