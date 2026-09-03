/**
 * Growth → Results — what a real holdout says the offers caused.
 *
 * THE ONLY CAUSAL CLAIM IN THIS PRODUCT
 *
 * Everywhere else the console is careful to say *provenance, not
 * attribution*: an order carrying an authorized proposal is not proof the
 * proposal caused it, because nothing was held back for comparison.
 *
 * Campaigns are the exception. `cohortFor()` hash-buckets every subject
 * into CONTROL or TREATMENT before any offer is made — deterministically,
 * and before the outcome is known. That is a genuine holdout, and the
 * difference between the two cohorts is the one number here that survives
 * "how do you know the agent did that?".
 *
 * It was assigned, recorded, returned by the API, and rendered by nothing.
 *
 * WHAT THIS SCREEN REFUSES TO DO
 *
 * Show a lift figure from a sample too small to support one. A campaign
 * with four treated subjects gets an explicit "not enough yet" and the
 * reason, not a confident percentage built on noise. A campaign that lost
 * to its own holdout says so plainly, in the same weight of type as one
 * that won — that is the result most worth seeing and the easiest to bury.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { FlaskConical, TrendingDown, TrendingUp, Minus } from "lucide-react";
import type { CampaignLift } from "@razorgrowth/domain";
import { apiGet, ApiError } from "../lib/api-client";
import { PageHeader } from "../components/layout/PageHeader";
import { Card, CardBody, CardHeader, CardTitle } from "../components/ui/Card";
import { EmptyState, ErrorState, Skeleton } from "../components/ui/States";
import { ValueTag } from "../components/ui/ValueTag";
import { formatMoney } from "../lib/format";

interface CampaignRow {
  id: string;
  name: string;
  actionType: string;
  status: string;
  budgetMinor: number;
  spentMinor: number;
  controlPercentBps: number;
}

interface CohortResult {
  subjects: number;
  impressions: number;
  conversions: number;
  conversionRateBps: number;
  observedRevenueMinor: number;
}

interface CampaignMetrics {
  campaign: CampaignRow;
  treatment: CohortResult;
  control: CohortResult;
  lift: CampaignLift;
}

function pct(bps: number | null): string {
  if (bps === null) return "—";
  return `${(bps / 100).toFixed(1)}%`;
}

function CohortColumn({ label, cohort, note }: { label: string; cohort: CohortResult; note: string }) {
  return (
    <div className="rounded-card bg-surface-subtle px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">{label}</p>
      <p className="mt-2 text-2xl font-bold tabular-nums text-ink">{pct(cohort.conversionRateBps)}</p>
      <p className="mt-0.5 text-xs text-ink-muted">
        {cohort.conversions} of {cohort.impressions} · {cohort.subjects} subject{cohort.subjects === 1 ? "" : "s"}
      </p>
      <p className="mt-1.5 text-[11px] leading-snug text-ink-faint">{note}</p>
    </div>
  );
}

function CampaignResult({ campaignId }: { campaignId: string }) {
  const query = useQuery({
    queryKey: ["campaigns", campaignId, "metrics"],
    queryFn: () => apiGet<CampaignMetrics>(`/campaigns/${campaignId}/metrics`),
  });

  if (query.isPending) return <Skeleton className="h-48" />;
  if (query.isError || !query.data) {
    return (
      <Card>
        <ErrorState
          message={query.error instanceof ApiError ? query.error.message : "Could not read this campaign's results."}
          onRetry={() => void query.refetch()}
        />
      </Card>
    );
  }

  const { campaign, treatment, control, lift } = query.data;
  const measured = lift.basis === "MEASURED_AGAINST_HOLDOUT" && lift.liftBps !== null;
  const positive = measured && lift.liftBps! > 0;
  const negative = measured && lift.liftBps! < 0;

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <CardTitle>{campaign.name}</CardTitle>
          <p className="mt-0.5 text-xs text-ink-muted">
            {campaign.actionType.replaceAll("_", " ").toLowerCase()} · {campaign.status.toLowerCase()} ·{" "}
            {(campaign.controlPercentBps / 100).toFixed(0)}% held back
          </p>
        </div>
        {measured ? (
          <span
            className={`inline-flex items-center gap-1 rounded-pill px-2.5 py-1 text-sm font-semibold ${
              positive ? "bg-success-subtle text-success-text" : negative ? "bg-danger-subtle text-danger-text" : "bg-surface-sunken text-ink-muted"
            }`}
          >
            {positive ? <TrendingUp size={14} /> : negative ? <TrendingDown size={14} /> : <Minus size={14} />}
            {lift.liftBps! > 0 ? "+" : ""}
            {pct(lift.liftBps)}
          </span>
        ) : (
          <span className="rounded-pill bg-surface-sunken px-2.5 py-1 text-xs font-medium text-ink-muted">
            No lift reported
          </span>
        )}
      </CardHeader>

      <CardBody className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <CohortColumn label="Shown the offer" cohort={treatment} note="Treated subjects." />
          <CohortColumn label="Held back" cohort={control} note="Assigned before any offer was made." />
        </div>

        {/* The explanation is the product here. A percentage without the
            basis behind it is exactly what this screen exists not to be. */}
        <p className="text-sm leading-relaxed text-ink-muted">{lift.explanation}</p>

        {measured && lift.attributableRevenueMinor !== null ? (
          <div className="flex flex-wrap items-center gap-3 border-t border-border-hair pt-3">
            <ValueTag classification="VERIFIED" />
            <p className="text-sm text-ink">
              <span className="font-semibold tabular-nums">
                {formatMoney({ amountMinor: lift.attributableRevenueMinor, currency: "INR" })}
              </span>{" "}
              attributable to this offer
            </p>
            <p className="w-full text-[11px] leading-snug text-ink-faint">
              Treatment revenue minus what the held-back group's rate predicts it would have earned anyway. Not the
              campaign's total revenue — the part the holdout says would not have happened.
            </p>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

export default function GrowthResultsPage() {
  const campaigns = useQuery({
    queryKey: ["campaigns"],
    queryFn: () => apiGet<{ items: CampaignRow[] }>("/campaigns"),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Results"
        lead="What your offers actually caused, measured against the subjects deliberately held back from them. This is the only place in the product that makes a causal claim, because it is the only place with a control group."
      />

      {campaigns.isPending ? (
        <Skeleton className="h-48" />
      ) : campaigns.isError || !campaigns.data ? (
        <Card>
          <ErrorState message="Could not load campaigns." onRetry={() => void campaigns.refetch()} />
        </Card>
      ) : campaigns.data.items.length === 0 ? (
        <Card>
          <EmptyState
            icon={<FlaskConical size={18} />}
            title="No campaigns have run yet"
            description="A campaign holds a percentage of subjects back from the offer. Without one, revenue can be reported but never attributed — start one from the Offers tab."
          />
          <div className="pb-6 text-center">
            <Link to="/merchant/growth/offers" className="text-sm font-semibold text-brand-600 hover:underline">
              Open Offers →
            </Link>
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          {campaigns.data.items.map((campaign) => (
            <CampaignResult key={campaign.id} campaignId={campaign.id} />
          ))}
        </div>
      )}
    </div>
  );
}
