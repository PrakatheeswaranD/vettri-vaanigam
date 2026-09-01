import { useState } from "react";
import { Link } from "react-router-dom";
import { FlaskConical, Loader2, ScanLine, TrendingUp } from "lucide-react";
import { useCatalog, useGrowthOpportunities } from "../hooks/use-api";
import { useProposeGrowthAction } from "../hooks/use-merchant-agent";
import { PageHeader } from "../components/layout/PageHeader";
import { Card, CardBody, CardHeader, CardTitle } from "../components/ui/Card";
import { EmptyState, ErrorState, Skeleton } from "../components/ui/States";
import { ValueTag } from "../components/ui/ValueTag";
import { DemoDataBadge } from "../components/ui/DemoDataBadge";
import { GrowthProposalPanel } from "../components/merchant-agent/GrowthProposalPanel";
import { GrowthSummaryPanel } from "../components/growth/GrowthSummaryPanel";
import { AgentDrivenGrowth } from "../components/growth/AgentDrivenGrowth";
import { CampaignManager } from "../components/growth/CampaignManager";
import { useGatewayPolicy } from "../hooks/use-agent-gateway";
import { formatMoney } from "../lib/format";
import { ApiError } from "../lib/api-client";

const CATEGORY_LABEL: Record<string, string> = {
  CROSS_SELL: "Cross-sell",
  UPSELL: "Upsell",
  CATALOG_GAP: "Catalog Gap",
  READINESS_GAP: "Readiness Gap",
  PAYMENT_RECOVERY: "Payment Recovery",
};

/**
 * A PREVIEW tool, and labelled as one.
 *
 * Real offers are made automatically on real agent baskets (see
 * `AgentDrivenGrowth`). This exists for the merchant who is configuring
 * their envelope BEFORE any agent traffic arrives and reasonably wants to
 * see what an offer would look like. Presenting it as "pick what a buyer
 * selected" — as an earlier version did — implied the merchant has to
 * guess what a customer is buying, which is precisely what the gateway
 * removes.
 */
function GrowthPreviewSection() {
  const { data: catalog } = useCatalog({ limit: 25 });
  const policy = useGatewayPolicy();
  const [selectedProductId, setSelectedProductId] = useState("");
  const proposeGrowthAction = useProposeGrowthAction();

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center gap-2">
        <FlaskConical size={16} className="text-ink-faint" />
        <CardTitle>Preview an offer</CardTitle>
        <span className="rounded-full bg-surface-subtle px-2 py-0.5 text-[11px] font-medium text-ink-muted">
          not live traffic
        </span>
      </CardHeader>
      <CardBody className="space-y-4">
        <p className="text-sm text-ink-muted">
          Try your envelope against any product to see what the Merchant Agent would propose. This is a dry run —
          nothing here came from a real buyer, and nothing is charged. Live offers are made automatically on the
          agent baskets above.
        </p>

        {policy.data ? (
          <div className="rounded-card border border-border bg-surface-subtle p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Envelope this preview runs under</p>
            <ul className="mt-2 space-y-1 text-xs text-ink-muted">
              <li>
                Discount ceiling <span className="font-medium text-ink">{(policy.data.maxNegotiationDiscountBps / 100).toFixed(1)}%</span> — a
                larger figure from the model is truncated in code before anyone sees it.
              </li>
              <li>
                Floor margin <span className="font-medium text-ink">{(policy.data.negotiatorFloorMarginBps / 100).toFixed(0)}%</span> — an offer
                that would go below it is refused outright, not reduced.
              </li>
              <li>
                Engages only on baskets under{" "}
                <span className="font-medium text-ink">{policy.data.negotiatorMinBundleItems} items</span> — a fuller basket
                is a sale in hand.
              </li>
            </ul>
            <Link to="/agent-gateway" className="mt-2 inline-block text-xs font-medium text-brand-600 hover:underline">
              Change these in the gateway policy →
            </Link>
          </div>
        ) : null}
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
            {proposeGrowthAction.isPending ? (
              <>
                <Loader2 size={14} className="animate-spin" aria-hidden />
                Proposing…
              </>
            ) : (
              "Propose Growth Action"
            )}
          </button>
        </div>

        {/* This call runs a live model and routinely takes ten seconds or
            more. With only a word changing inside the button, the wait read
            as a dead click — the result appears far below the control, and
            nothing between them moved. A placeholder where the answer will
            arrive is the part that makes the wait legible. */}
        {proposeGrowthAction.isPending ? (
          <div className="space-y-3" role="status" aria-live="polite">
            <p className="text-sm text-ink-muted">
              Asking the Merchant Agent for a proposal, then validating it against your envelope. This usually takes a few seconds.
            </p>
            <Skeleton className="h-48" />
          </div>
        ) : null}

        {proposeGrowthAction.isError ? (
          <ErrorState
            message={proposeGrowthAction.error instanceof ApiError ? proposeGrowthAction.error.message : "Could not generate a proposal."}
          />
        ) : null}

        {!proposeGrowthAction.isPending && proposeGrowthAction.data ? <GrowthProposalPanel proposal={proposeGrowthAction.data} /> : null}
      </CardBody>
    </Card>
  );
}

/**
 * Two nav items, two pages.
 *
 * "Growth" and "Opportunities & Offers" both rendered this one component,
 * so the sidebar offered a destination it did not have. They are also
 * genuinely different questions — "what did the negotiator do on real
 * agent baskets" is a report, and "what could we be doing" is a worklist —
 * and stacking both made a single page long enough that the opportunity
 * list sat below four other sections.
 *
 *   Growth   — what already happened: the summary, real agent baskets,
 *              and the campaigns running against them.
 *   Offers   — what could happen next: the identified opportunities, and
 *              the dry-run preview for trying the envelope against one.
 */
export default function GrowthPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Basket Growth"
        lead="What AI agents bought, and what the negotiator offered to make those baskets bigger — always inside the limits you set."
      />
      <GrowthSummaryPanel />
      <AgentDrivenGrowth />
      <CampaignManager />
    </div>
  );
}

export function OffersPage() {
  const { data, isLoading, isError, error, refetch } = useGrowthOpportunities();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Opportunities & Offers"
        lead="Basket expansion the Merchant Agent has found but nobody has acted on yet, and a dry run for trying your envelope against any product."
      />

      <GrowthPreviewSection />

      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-faint">Identified opportunities</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Derived from catalogue, order and payment signals. Nothing here has been offered to a buyer.
        </p>
      </div>

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
                  {opp.isSyntheticDemo ? (
                    <DemoDataBadge />
                  ) : (
                    // A positive marker, not just the absence of a demo
                    // badge: these rows were written by the Catalog scan on
                    // a real publish, and that is the whole point of the
                    // feed no longer being fifteen fixed rows.
                    <span className="inline-flex items-center gap-1 rounded-pill bg-success-subtle px-2 py-0.5 text-micro font-medium text-success-text">
                      <ScanLine size={10} />
                      Found by catalogue scan
                    </span>
                  )}
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
