import { useState } from "react";
import { Bot, TrendingUp } from "lucide-react";
import { useCatalog, useGrowthOpportunities } from "../hooks/use-api";
import { useProposeGrowthAction } from "../hooks/use-merchant-agent";
import { Card, CardBody, CardHeader, CardTitle } from "../components/ui/Card";
import { EmptyState, ErrorState, Skeleton } from "../components/ui/States";
import { ValueTag } from "../components/ui/ValueTag";
import { DemoDataBadge } from "../components/ui/DemoDataBadge";
import { GrowthProposalPanel } from "../components/merchant-agent/GrowthProposalPanel";
import { formatMoney } from "../lib/format";
import { ApiError } from "../lib/api-client";

const CATEGORY_LABEL: Record<string, string> = {
  CROSS_SELL: "Cross-sell",
  UPSELL: "Upsell",
  CATALOG_GAP: "Catalog Gap",
  READINESS_GAP: "Readiness Gap",
  PAYMENT_RECOVERY: "Payment Recovery",
};

function MerchantAgentSection() {
  const { data: catalog } = useCatalog({ limit: 25 });
  const [selectedProductId, setSelectedProductId] = useState("");
  const proposeGrowthAction = useProposeGrowthAction();

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center gap-2">
        <Bot size={16} className="text-brand-600" />
        <CardTitle>Merchant Agent — Growth Proposals</CardTitle>
      </CardHeader>
      <CardBody className="space-y-4">
        <p className="text-sm text-ink-muted">
          Pick a product a buyer has selected. The Merchant Agent proposes a bounded cross-sell, upsell, or
          bundle from real catalog relationships — it can propose, but it cannot authorize a discount, change a
          price, or execute anything.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={selectedProductId}
            onChange={(e) => setSelectedProductId(e.target.value)}
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink focus:border-brand-500"
          >
            <option value="">Select a product…</option>
            {catalog?.items.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!selectedProductId || proposeGrowthAction.isPending}
            onClick={() => proposeGrowthAction.mutate(selectedProductId)}
            className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {proposeGrowthAction.isPending ? "Proposing…" : "Propose Growth Action"}
          </button>
        </div>

        {proposeGrowthAction.isError ? (
          <ErrorState
            message={proposeGrowthAction.error instanceof ApiError ? proposeGrowthAction.error.message : "Could not generate a proposal."}
          />
        ) : null}

        {proposeGrowthAction.data ? <GrowthProposalPanel proposal={proposeGrowthAction.data} /> : null}
      </CardBody>
    </Card>
  );
}

export default function GrowthPage() {
  const { data, isLoading, isError, error, refetch } = useGrowthOpportunities();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Growth Opportunities</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-muted">
          Signals identified from real catalog and order data, each with a recommendation and a value estimate
          that is always labeled by classification — never presented as confirmed revenue.
        </p>
      </div>

      <MerchantAgentSection />

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : isError ? (
        <Card>
          <ErrorState
            message={error instanceof ApiError ? error.message : "Could not load growth opportunities."}
            onRetry={() => refetch()}
          />
        </Card>
      ) : !data || data.items.length === 0 ? (
        <Card>
          <EmptyState
            icon={<TrendingUp size={18} />}
            title="No growth opportunities identified yet"
            description="Opportunities are derived from catalog, order, and payment signals as they accumulate."
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {data.items.map((opp) => (
            <Card key={opp.id}>
              <CardBody className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700">
                    {CATEGORY_LABEL[opp.category] ?? opp.category}
                  </span>
                  <ValueTag classification={opp.valueClassification} />
                  {opp.isSyntheticDemo ? <DemoDataBadge /> : null}
                  <span className="ml-auto text-xs text-ink-faint">{opp.status.replace("_", " ")}</span>
                </div>
                <p className="text-sm text-ink-muted">
                  <span className="font-medium text-ink">Signal: </span>
                  {opp.signal}
                </p>
                <p className="text-sm text-ink-muted">
                  <span className="font-medium text-ink">Recommendation: </span>
                  {opp.recommendation}
                </p>
                {opp.estimatedValue ? (
                  <p className="text-sm font-semibold text-ink">{formatMoney(opp.estimatedValue)}</p>
                ) : null}
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
