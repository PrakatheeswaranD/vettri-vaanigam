/**
 * Growth outcome summary (Part 11 §22-§23).
 *
 * Every money figure carries an explicit OBSERVED / OPPORTUNITY tag, so
 * potential value can never be read as realized revenue. There is no
 * "uplift %" or ROI anywhere here — this build has no control group, so
 * such a number would be a causal claim the data cannot support.
 */
import { useGrowthSummary } from "../../hooks/use-api";
import { Card, CardBody, CardHeader, CardTitle } from "../ui/Card";
import { ValueTag } from "../ui/ValueTag";
import { ErrorState, Skeleton } from "../ui/States";
import { formatMoney } from "../../lib/format";

export function GrowthSummaryPanel() {
  const summary = useGrowthSummary();

  if (summary.isLoading) return <Skeleton className="h-40 w-full" />;
  if (summary.isError || !summary.data) {
    return <ErrorState message="Could not load the growth summary." onRetry={() => summary.refetch()} />;
  }

  const s = summary.data;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Growth activity</CardTitle>
        </CardHeader>
        <CardBody className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Metric label="Opportunities identified" value={s.growthOpportunities} />
          <Metric label="Cross-sells authorized" value={s.crossSellsAuthorized} />
          <Metric label="Upsells authorized" value={s.upsellsAuthorized} />
          <Metric label="Bundles authorized" value={s.bundlesAuthorized} />
          <Metric label="Recovered orders" value={s.recoveredOrders} />
          <Metric label="Blocked by governance" value={s.blockedByGovernance} tone="attention" />
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Value</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <div className="rounded-card bg-surface-subtle p-3">
            <div className="mb-1 flex items-center gap-2">
              <ValueTag classification="OPPORTUNITY" />
            </div>
            <p className="text-xl font-semibold text-ink">{formatMoney(s.opportunityValue)}</p>
            <p className="mt-0.5 text-xs text-ink-muted">
              Basket expansion the Merchant Agent has proposed on still-open opportunities. Not realized revenue.
            </p>
          </div>

          <div className="rounded-card bg-success-subtle p-3">
            <div className="mb-1 flex items-center gap-2">
              <ValueTag classification="OBSERVED" />
            </div>
            <p className="text-xl font-semibold text-success-text">{formatMoney(s.observedCapturedValue)}</p>
            <p className="mt-0.5 text-xs text-success-text/90">
              Provider-verified captured payments on orders traceable to an authorized agentic proposal. This is
              provenance, not an attribution claim — it is not a measurement of revenue the agent caused.
            </p>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone?: "attention" }) {
  return (
    <div className="rounded-card bg-surface-subtle px-3 py-2.5">
      <p className={tone === "attention" ? "text-xl font-semibold text-warning-text" : "text-xl font-semibold text-ink"}>
        {value}
      </p>
      <p className="text-xs text-ink-muted">{label}</p>
    </div>
  );
}
