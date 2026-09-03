import { useState } from "react";
import { Link } from "react-router-dom";
import { FlaskConical, Loader2 } from "lucide-react";
import { useCatalog } from "../hooks/use-api";
import { useProposeGrowthAction } from "../hooks/use-merchant-agent";
import { PageHeader } from "../components/layout/PageHeader";
import { Card, CardBody, CardHeader, CardTitle } from "../components/ui/Card";
import { ErrorState, Skeleton } from "../components/ui/States";
import { GrowthProposalPanel } from "../components/merchant-agent/GrowthProposalPanel";
import { GrowthSummaryPanel } from "../components/growth/GrowthSummaryPanel";
import { AgentDrivenGrowth } from "../components/growth/AgentDrivenGrowth";
import { CampaignManager } from "../components/growth/CampaignManager";
import { useGatewayPolicy } from "../hooks/use-agent-gateway";
import { ApiError } from "../lib/api-client";


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
            <Link to="/merchant/governance/decisions" className="mt-2 inline-block text-xs font-medium text-brand-600 hover:underline">
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
            "Generate preview proposal"
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
 * Offers & Actions — the execution surface.
 *
 * WHY THIS IS ONE PAGE AGAIN
 *
 * There used to be two: "Basket Growth" (what the negotiator did on real
 * agent baskets) and "Opportunities & Offers" (a flat catalogue-derived
 * worklist plus a dry-run tool). The worklist has since been replaced by
 * the Revenue Opportunity Engine on its own page, which is where a
 * merchant now decides WHAT to do. That left the two remaining halves
 * answering the same question — what have my bounded actions actually
 * done, and what would one do if I tried it — so they belong together.
 *
 * The split that survives is the one that matters:
 *
 *   Growth Opportunities  what is worth doing, ranked, with evidence.
 *   Offers & Actions      what has been offered, what it did, and a
 *                         dry run for trying the envelope safely.
 */
export default function OffersPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Offers & actions"
        lead="What your bounded growth actions have actually offered and earned, plus a dry run for testing your envelope before any buyer sees it."
      />

      <GrowthSummaryPanel />
      <AgentDrivenGrowth />
      <CampaignManager />
      <GrowthPreviewSection />
    </div>
  );
}
