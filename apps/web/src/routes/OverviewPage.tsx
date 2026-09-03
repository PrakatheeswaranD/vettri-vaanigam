/**
 * 🚀 Overview — the autonomous merchant revenue command center.
 *
 * WHAT THIS REPLACED, AND WHY
 *
 * A conventional dashboard: nine cards of counts — products, orders,
 * captured payments, out-of-stock variants, active products, agent-ready
 * products — plus a readiness ring, a capability strip, a connected-systems
 * panel, and TWO separate feeds of the same ledger ("Recent Agent Actions"
 * and "Agent Activity") stacked on one page.
 *
 * Every number on it was true. None of it answered the question a merchant
 * running an autonomous revenue agent actually has, which is not "how many
 * products do I have" but:
 *
 *     What did my agent detect?
 *     What did it do about it, on its own?
 *     Why?
 *     What happened as a result?
 *     What should happen next?
 *
 * So the page is now that sequence, in that order:
 *
 *     OBSERVED BUSINESS STATE
 *       → AGENT-DETECTED OPPORTUNITIES
 *         → AUTOMATED ACTIONS
 *           → VERIFIED RESULTS
 *
 * THE ONE RULE
 *
 * Four value classes, never blended. OBSERVED is countable in the
 * merchant's own rows right now. ESTIMATED is a projection, and only where
 * their own history supports a rate. POTENTIAL is a ceiling. VERIFIED
 * means the payment provider confirmed money moved on an order that traces
 * back to an agent action — the only claim on this page that says the
 * agent caused something.
 *
 * There is deliberately no single blended "total value created" figure. It
 * would be the most impressive number on the screen and the least true
 * one, and every part of this engine was built to avoid printing it.
 *
 * WHAT THE COUNTS THAT LEFT WENT TO
 *
 * Product, order, payment and catalogue-health counts are the Commerce
 * section's own summary strip and its Products tab. The readiness ring is
 * Merchant Agent → Readiness, and its score appears here as the AI Buyer
 * Readiness panel. The capability strip and connected systems live on
 * Governance → Policies. The raw ledger feed is Governance → Ledger — this
 * page shows what the agent DID, grouped, not every event it wrote.
 */
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  BadgeIndianRupee,
  CheckCircle2,
  Radar,
  ShieldAlert,
  ShieldQuestion,
  Sparkles,
  TrendingUp,
  Workflow,
} from "lucide-react";
import type { CurrencyDTO } from "@razorgrowth/contracts";
import { useGrowthSummary } from "../hooks/use-api";
import { useRevenueOpportunities } from "../hooks/use-revenue-engine";
import { Card, CardBody, CardHeader, CardTitle } from "../components/ui/Card";
import { EmptyState, ErrorState, Skeleton } from "../components/ui/States";
import { ValueTag, type ValueClass } from "../components/ui/ValueTag";
import { PageHeader } from "../components/layout/PageHeader";
import { RevenueOpportunityCard } from "../components/growth/RevenueOpportunityCard";
import { opportunityAction } from "../components/growth/OpportunityAction";
import { CompositeScorePanel } from "../components/growth/CompositeScorePanel";
import { GatewayPulse } from "../components/gateway/GatewayPulse";
import { LatestWorkflowStrip } from "../features/trust-trace/LatestWorkflowStrip";
import { formatMoney, formatRelativeTime } from "../lib/format";
import { ApiError } from "../lib/api-client";

/** How many opportunity cards belong on a landing screen. The full ranked
 * list is one click away; a merchant who has to scroll past eleven cards
 * to reach "what happened" has been given a list, not a briefing. */
const TOP_OPPORTUNITIES = 3;

/**
 * Ledger action types, in a merchant's words.
 *
 * These are the events written with `actorType: MERCHANT_AGENT` — the
 * things the agent decided to do on its own. Anything not named here still
 * renders, de-underscored, rather than being hidden: a new agent behaviour
 * should show up on this page the day it ships, not the day someone
 * remembers to add a label for it.
 */
const AGENT_ACTION_LABEL: Record<string, string> = {
  GROWTH_OPPORTUNITY_SCAN: "Scanned your catalogue for opportunities",
  CROSS_SELL: "Proposed a cross-sell",
  UPSELL: "Proposed an upsell",
  BUNDLE: "Proposed a bundle",
  BOUNDED_OFFER: "Proposed a bounded offer",
  RECOVERY: "Proposed a payment recovery",
  NO_OPPORTUNITY: "Examined a basket and proposed nothing",
};

function humanise(actionType: string): string {
  return AGENT_ACTION_LABEL[actionType] ?? actionType.replaceAll("_", " ").toLowerCase();
}

/* ---------------------------------------------------------------- pieces */

function StageHeading({ step, title, lead }: { step: number; title: string; lead: string }) {
  return (
    <div className="flex gap-3">
      <span
        aria-hidden
        className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white"
      >
        {step}
      </span>
      <div className="min-w-0">
        <h2 className="text-base font-semibold tracking-tight text-ink">{title}</h2>
        <p className="mt-0.5 max-w-3xl text-sm leading-relaxed text-ink-muted">{lead}</p>
      </div>
    </div>
  );
}

function ValueTile({
  label,
  amount,
  currency,
  classification,
  note,
  icon,
}: {
  label: string;
  amount: number;
  currency: CurrencyDTO;
  classification: ValueClass;
  note: string;
  icon: ReactNode;
}) {
  return (
    <Card>
      <CardBody>
        <div className="flex items-start justify-between gap-2">
          <span className="text-brand-600">{icon}</span>
          <ValueTag classification={classification} />
        </div>
        <p className="mt-3 text-2xl font-bold tabular-nums text-ink">{formatMoney({ amountMinor: amount, currency })}</p>
        <p className="mt-0.5 text-sm font-medium text-ink">{label}</p>
        <p className="mt-1.5 text-[11px] leading-snug text-ink-faint">{note}</p>
      </CardBody>
    </Card>
  );
}

function CountTile({ label, value, note, icon, attention }: { label: string; value: number; note: string; icon: ReactNode; attention?: boolean }) {
  return (
    <Card>
      <CardBody>
        <span className={attention && value > 0 ? "text-warning-text" : "text-brand-600"}>{icon}</span>
        <p className="mt-3 text-2xl font-bold tabular-nums text-ink">{value}</p>
        <p className="mt-0.5 text-sm font-medium text-ink">{label}</p>
        <p className="mt-1.5 text-[11px] leading-snug text-ink-faint">{note}</p>
      </CardBody>
    </Card>
  );
}

/* ------------------------------------------------------------------ page */

export default function OverviewPage() {
  const engine = useRevenueOpportunities();
  const summary = useGrowthSummary();

  return (
    <div className="space-y-8">
      <PageHeader
        title="Revenue command center"
        lead="What your Merchant Agent found in your own data, what it did about it without being asked, and what the payment provider confirmed came of it."
      />

      {engine.isPending ? (
        <div className="space-y-4" role="status" aria-label="Loading your revenue command center">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32" />)}
          </div>
          <Skeleton className="h-64" />
        </div>
      ) : engine.isError || !engine.data ? (
        <Card>
          <ErrorState
            message={engine.error instanceof ApiError ? engine.error.message : "Could not read your revenue evidence."}
            onRetry={() => void engine.refetch()}
          />
        </Card>
      ) : (
        (() => {
          const { observed, totals, opportunities, growthScore, aiBuyerScore } = engine.data;
          const currency = observed.currency;
          const top = opportunities.slice(0, TOP_OPPORTUNITIES);

          return (
            <>
              {/* ─────────────────────────── 1. OBSERVED BUSINESS STATE */}
              <section className="space-y-4">
                <StageHeading
                  step={1}
                  title="Observed business state"
                  lead="Countable right now in your own orders and payments. Nothing here is a projection, and nothing is derived from an industry average."
                />

                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <ValueTile
                    icon={<BadgeIndianRupee size={16} />}
                    label="Captured revenue"
                    amount={observed.capturedRevenueMinor}
                    currency={currency}
                    classification="OBSERVED"
                    note={`Across ${observed.paidOrderCount} paid order${observed.paidOrderCount === 1 ? "" : "s"}, provider-confirmed.`}
                  />
                  <ValueTile
                    icon={<ShieldAlert size={16} />}
                    label="Revenue at risk"
                    amount={totals.totalAtRiskMinor}
                    currency={totals.currency}
                    classification="OBSERVED"
                    note={
                      totals.totalAtRiskMinor > 0
                        ? `${observed.failedPaymentCount} failed payment${observed.failedPaymentCount === 1 ? "" : "s"} and stalled checkouts that exist right now.`
                        : "No failed payment or stalled checkout is currently uncaptured."
                    }
                  />
                  <CountTile
                    icon={<CheckCircle2 size={16} />}
                    label="Customers"
                    value={observed.customerCount}
                    note={`${observed.repeatCustomerCount} have bought more than once.`}
                  />
                  <CountTile
                    icon={<Sparkles size={16} />}
                    label="Agent-buyable products"
                    value={observed.transactableProductCount}
                    note={`Of ${observed.agentVisibleProductCount} an AI buyer can see at all.`}
                  />
                </div>

                {/* Inbound AI-buyer demand is observed business state too —
                    and under this product's thesis it is the half a
                    conventional dashboard leaves out entirely. */}
                <GatewayPulse />
              </section>

              {/* ─────────────────────── 2. AGENT-DETECTED OPPORTUNITIES */}
              <section className="space-y-4">
                <StageHeading
                  step={2}
                  title="What your agent detected"
                  lead="Ranked by what is worth doing first. Each card states the fact that triggered it, what it proposes, what could go wrong, and what your policy says about it."
                />

                <div className="grid gap-4 sm:grid-cols-3">
                  <CountTile
                    icon={<Radar size={16} />}
                    label="Active opportunities"
                    value={totals.opportunityCount}
                    note={totals.blockedCount > 0 ? `${totals.blockedCount} blocked by your own policy.` : "None blocked by policy."}
                  />
                  <ValueTile
                    icon={<TrendingUp size={16} />}
                    label="Addressable ceiling"
                    amount={totals.totalAddressableMinor}
                    currency={totals.currency}
                    classification="OPPORTUNITY"
                    note="What these opportunities could be worth if every one landed perfectly. They will not all land."
                  />
                  <ValueTile
                    icon={<TrendingUp size={16} />}
                    label="Expected incremental"
                    amount={totals.totalExpectedIncrementalMinor}
                    currency={totals.currency}
                    classification="ESTIMATED"
                    note={
                      totals.withheldEstimateCount > 0
                        ? `${totals.withheldEstimateCount} opportunit${totals.withheldEstimateCount === 1 ? "y" : "ies"} withheld an estimate — your history does not yet support a rate for them.`
                        : "Every opportunity here has an observed rate behind its estimate."
                    }
                  />
                </div>

                {top.length === 0 ? (
                  <Card>
                    <EmptyState
                      icon={<CheckCircle2 size={18} />}
                      title="Nothing needs your attention"
                      description="No failed payments, no stalled checkouts, no overdue customers and no catalogue gaps. This is the good empty state — the scan ran and found nothing wrong."
                    />
                  </Card>
                ) : (
                  <div className="space-y-4">
                    {top.map((opportunity, index) => (
                      <RevenueOpportunityCard
                        key={opportunity.id}
                        opportunity={opportunity}
                        rank={index + 1}
                        action={opportunityAction(opportunity)}
                      />
                    ))}
                    {opportunities.length > TOP_OPPORTUNITIES ? (
                      <Link
                        to="/merchant/growth"
                        className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:underline"
                      >
                        See all {opportunities.length} ranked opportunities <ArrowRight size={14} />
                      </Link>
                    ) : null}
                  </div>
                )}
              </section>

              {/* ─────────────────────────────── 3. AUTOMATED ACTIONS */}
              <AutomatedActions summary={summary} />

              {/* ─────────────────────────────── 4. VERIFIED RESULTS */}
              <VerifiedResults summary={summary} />

              {/* ─────────────────────────────────────────── SCORES */}
              <section className="space-y-4">
                <StageHeading
                  step={5}
                  title="Where you stand"
                  lead="Both scores are built only from facts in your data. Neither awards points for a feature existing."
                />
                <div className="grid gap-4 lg:grid-cols-2">
                  <CompositeScorePanel
                    title="Merchant Growth Score"
                    lead="How much of your own revenue machinery is actually working — capture, recovery, repeat purchase, catalogue depth."
                    score={growthScore}
                  />
                  <CompositeScorePanel
                    title="AI Buyer Readiness"
                    lead="Whether an AI buyer that has never met you can find, price, and complete a purchase without a human intervening."
                    score={aiBuyerScore}
                  />
                </div>
              </section>
            </>
          );
        })()
      )}
    </div>
  );
}

/* ------------------------------------------------------- stages 3 and 4 */

type SummaryQuery = ReturnType<typeof useGrowthSummary>;

function AutomatedActions({ summary }: { summary: SummaryQuery }) {
  return (
    <section className="space-y-4">
      <StageHeading
        step={3}
        title="What your agent did about it"
        lead="Actions the Merchant Agent took on its own initiative, and the ones it refused to take alone. Every row is a real ledger entry written by the agent — nothing here is a projection of what it would do."
      />

      {summary.isPending ? (
        <Skeleton className="h-40" />
      ) : summary.isError || !summary.data ? (
        <Card>
          <ErrorState message="Could not read what the agent has been doing." onRetry={() => void summary.refetch()} />
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <CountTile
              icon={<Sparkles size={16} />}
              label="Proposals produced"
              value={summary.data.growthOpportunities}
              note={`${summary.data.crossSellsAuthorized + summary.data.upsellsAuthorized + summary.data.bundlesAuthorized} reached authorization.`}
            />
            <CountTile
              icon={<ShieldQuestion size={16} />}
              label="Waiting on you"
              value={summary.data.pendingApprovals}
              note="Proposals the policy engine will not release without a human."
              attention
            />
            <CountTile
              icon={<ShieldAlert size={16} />}
              label="Blocked by governance"
              value={summary.data.blockedByGovernance}
              note="Refused by deterministic validation or your policy. Shown so this never reads as 'the AI succeeded every time'."
              attention
            />
          </div>

          {summary.data.pendingApprovals > 0 ? (
            <Link
              to="/merchant/governance/approvals"
              className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700"
            >
              Decide {summary.data.pendingApprovals} pending approval{summary.data.pendingApprovals === 1 ? "" : "s"}
              <ArrowRight size={14} />
            </Link>
          ) : null}

          <Card>
            <CardHeader className="flex items-center justify-between gap-2">
              <CardTitle>Acting without being asked</CardTitle>
              <Link to="/merchant/governance/ledger" className="text-xs font-medium text-brand-600 hover:underline">
                Full audit trail
              </Link>
            </CardHeader>
            <CardBody>
              {summary.data.automatedActions.length === 0 ? (
                <EmptyState
                  icon={<Sparkles size={18} />}
                  title="Your agent has not acted yet"
                  description="It writes a ledger entry every time it scans your catalogue or proposes an action. Publishing a catalogue is what triggers its first scan."
                />
              ) : (
                <ul className="divide-y divide-border-hair">
                  {summary.data.automatedActions.map((action) => (
                    <li key={action.actionType} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5 first:pt-0 last:pb-0">
                      <span className="text-sm text-ink">{humanise(action.actionType)}</span>
                      <span className="text-xs text-ink-faint">
                        <span className="font-semibold tabular-nums text-ink">{action.count}×</span>
                        {" · last "}
                        {formatRelativeTime(action.lastAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </>
      )}
    </section>
  );
}

function VerifiedResults({ summary }: { summary: SummaryQuery }) {
  return (
    <section className="space-y-4">
      <StageHeading
        step={4}
        title="What actually came of it"
        lead="Money the payment provider confirmed moved, on orders that trace back to an agent proposal. This is the only claim on this page that says the agent caused something — and it is deliberately the hardest one to earn."
      />

      {summary.isPending ? (
        <Skeleton className="h-32" />
      ) : summary.isError || !summary.data ? (
        <Card>
          <ErrorState message="Could not read verified results." onRetry={() => void summary.refetch()} />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <ValueTile
            icon={<CheckCircle2 size={16} />}
            label="Captured on agent-proposed orders"
            amount={summary.data.observedCapturedValue.amountMinor}
            currency={summary.data.observedCapturedValue.currency}
            classification="VERIFIED"
            note="Provenance, not attribution: these orders carry an authorized proposal. There is no control group, so this is not a claim about uplift."
          />
          <ValueTile
            icon={<CheckCircle2 size={16} />}
            label="Recovered after a failed attempt"
            amount={summary.data.recoveredValue.amountMinor}
            currency={summary.data.recoveredValue.currency}
            classification="VERIFIED"
            note={`${summary.data.recoveredOrders} order${summary.data.recoveredOrders === 1 ? "" : "s"} whose money only arrived on a later bounded retry.`}
          />
        </div>
      )}

      <Card>
        <CardHeader className="flex items-center gap-2">
          <Workflow size={16} className="text-ink-faint" />
          <CardTitle>Follow one order end to end</CardTitle>
        </CardHeader>
        <CardBody>
          <LatestWorkflowStrip />
        </CardBody>
      </Card>
    </section>
  );
}
