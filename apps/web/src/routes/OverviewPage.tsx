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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  AlertTriangle,
  ClipboardCheck,
  Send,
} from "lucide-react";
import type { CurrencyDTO, MerchantCommerceOverviewDTO } from "@razorgrowth/contracts";
import { useGrowthSummary } from "../hooks/use-api";
import { useRevenueOpportunities } from "../hooks/use-revenue-engine";
import { useAgentStatus, useGrowthConfig } from "../hooks/use-merchant-agent";
import { usePendingApprovals } from "../hooks/use-policy";
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
import { apiGet, apiPost, ApiError } from "../lib/api-client";

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

interface CampaignSummary {
  estimatedIncrementalRevenueMinor: number | null;
  estimatedIncrementalMarginMinor: number | null;
  measuredCampaigns: number;
  warnings: number;
  currency: CurrencyDTO;
}

interface GrowthPlanItemRow {
  id: string;
  title: string;
  confidence: number;
  priority: number;
  status: string;
}

interface GrowthPlanRow {
  id: string;
  status: string;
  summary: string;
  estimatedRevenueMinor: number;
  approvedBudgetMinor: number;
  approvedCustomerContacts: number;
  items: GrowthPlanItemRow[];
}

function MerchantTodayBriefing({
  influencedMinor,
  estimatedLiftMinor,
  actionsToday,
  approvals,
  failures,
  currency,
}: {
  influencedMinor: number;
  estimatedLiftMinor: number | null;
  actionsToday: number;
  approvals: number;
  failures: number;
  currency: CurrencyDTO;
}) {
  const items = [
    { label: "Revenue influenced", value: formatMoney({ amountMinor: influencedMinor, currency }), note: "Traceable to your agent; provenance, not causal lift." },
    { label: "Holdout lift estimate", value: estimatedLiftMinor === null ? "Not measured" : formatMoney({ amountMinor: estimatedLiftMinor, currency }), note: "Campaign comparison; not proof of causal impact." },
    { label: "Recent activity today", value: String(actionsToday), note: "From the latest five ledger entries; not a completed-action total." },
    { label: "Approvals waiting", value: String(approvals), note: "One decision each, no hidden release." },
    { label: "Blocked or failed", value: String(failures), note: "Recent policy refusals plus stalled or failed jobs." },
  ];
  return (
    <section aria-labelledby="today-briefing-title" className="space-y-3">
      <div><h2 id="today-briefing-title" className="text-base font-semibold text-ink">Today at a glance</h2><p className="mt-0.5 text-sm text-ink-muted">Five signals first: impact, proof, completed work, decisions and failures.</p></div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {items.map((item) => <Card key={item.label}><CardBody className="py-3"><p className="text-xs font-medium uppercase tracking-wide text-ink-faint">{item.label}</p><p className="mt-1 text-xl font-bold tabular-nums text-ink">{item.value}</p><p className="mt-1 text-[11px] leading-snug text-ink-muted">{item.note}</p></CardBody></Card>)}
      </div>
    </section>
  );
}

function AttentionInbox({ approvals, failures, campaignWarnings, opportunities }: { approvals: number; failures: number; campaignWarnings: number; opportunities: Array<{ type: string; title: string }> }) {
  const unverified = opportunities.find((item) => item.type === "UNVERIFIED_PAYMENT");
  const catalogue = opportunities.find((item) => ["AI_BUYER_READINESS", "PRODUCT_DISCOVERY", "UNDERPERFORMING_PRODUCT"].includes(item.type));
  const items = [
    ...(approvals > 0 ? [{ key: "approval", label: `${approvals} approval${approvals === 1 ? "" : "s"} waiting`, detail: "A policy boundary requires your decision.", action: "Approve or reject", to: "/merchant/governance/approvals" }] : []),
    ...(unverified ? [{ key: "payment", label: unverified.title, detail: "Ask the provider before retrying to avoid a duplicate charge.", action: "Review payment", to: "/merchant/commerce/payments" }] : []),
    ...(catalogue ? [{ key: "catalogue", label: catalogue.title, detail: "Catalogue evidence is blocking safe agent execution.", action: "Fix product", to: "/merchant/readiness" }] : []),
    ...(failures > 0 ? [{ key: "failure", label: `${failures} stopped action${failures === 1 ? "" : "s"}`, detail: "The agent failed closed; review the reason before retrying.", action: "Review failures", to: "/merchant/agent" }] : []),
    ...(campaignWarnings > 0 ? [{ key: "campaign", label: `${campaignWarnings} campaign warning${campaignWarnings === 1 ? "" : "s"}`, detail: "The measured holdout is not beating business as usual.", action: "Review campaign", to: "/merchant/growth/results" }] : []),
  ];
  return (
    <Card>
      <CardHeader className="flex items-center justify-between gap-3"><div><CardTitle className="text-base">Needs your attention</CardTitle><p className="mt-1 text-xs text-ink-muted">Every human decision, one primary action.</p></div><AlertTriangle size={18} className={items.length > 0 ? "text-warning-text" : "text-success-text"} /></CardHeader>
      <CardBody>{items.length === 0 ? <p className="text-sm text-ink-muted">Nothing is waiting on you. The agent can continue inside your boundaries.</p> : <ul className="divide-y divide-border-hair">{items.map((item) => <li key={item.key} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"><div><p className="text-sm font-medium text-ink">{item.label}</p><p className="mt-0.5 text-xs text-ink-muted">{item.detail}</p></div><Link to={item.to} className="rounded-md bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700">{item.action}</Link></li>)}</ul>}</CardBody>
    </Card>
  );
}

function WeeklyPlanCard({ plan, weeklyBudgetMinor, maxContacts }: { plan: GrowthPlanRow | null | undefined; weeklyBudgetMinor: number; maxContacts: number }) {
  const queryClient = useQueryClient();
  const refresh = () => { void queryClient.invalidateQueries({ queryKey: ["growth-plans", "current"] }); void queryClient.invalidateQueries({ queryKey: ["ledger"] }); };
  const generate = useMutation({ mutationFn: () => apiPost<GrowthPlanRow>("/growth-plans/generate"), onSuccess: refresh });
  const approve = useMutation({ mutationFn: (id: string) => apiPost<GrowthPlanRow>(`/growth-plans/${id}/approve`, { budgetMinor: weeklyBudgetMinor, maxCustomerContacts: maxContacts }), onSuccess: refresh });
  const run = useMutation({ mutationFn: (id: string) => apiPost(`/growth-plans/${id}/run`), onSuccess: refresh });
  const busy = generate.isPending || approve.isPending || run.isPending;
  return (
    <Card>
      <CardHeader className="flex items-center justify-between gap-3"><div><CardTitle className="text-base">This week&rsquo;s growth plan</CardTitle><p className="mt-1 text-xs text-ink-muted">Approve the portfolio once; every item keeps its own policy, job and ledger evidence.</p></div><ClipboardCheck size={18} className="text-brand-600" /></CardHeader>
      <CardBody>
        {(generate.isError || approve.isError || run.isError) && <p role="alert" className="mb-3 text-sm text-red-700">{(generate.error ?? approve.error ?? run.error)?.message ?? "The plan could not be updated. Please retry."}</p>}
        {!plan ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-ink-muted">Turn the ranked opportunity list into one bounded weekly plan.</p>
            <button type="button" disabled={busy} onClick={() => generate.mutate()} className="rounded-md bg-brand-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Generate weekly plan</button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm leading-relaxed text-ink">{plan.summary}</p>
            <p className="text-xs text-ink-muted">{plan.items.length} items · {plan.status.toLowerCase().replaceAll("_", " ")} · {formatMoney({ amountMinor: plan.estimatedRevenueMinor, currency: "INR" })} estimated, not earned</p>
            {plan.status === "PENDING_APPROVAL" && <p className="text-sm text-ink">Approving permits up to {formatMoney({ amountMinor: weeklyBudgetMinor, currency: "INR" })} and {maxContacts} contact attempts this week, subject to current daily and customer limits. No money is spent by this approval.</p>}
            <p className="text-xs text-ink-muted">Message delivery awaits a provider integration. Unsupported actions remain blocked; queued drafts are not completed work.</p>
            <div className="flex flex-wrap gap-2">
              {plan.status === "PENDING_APPROVAL" && <button type="button" disabled={busy} onClick={() => approve.mutate(plan.id)} className="rounded-md bg-brand-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Approve these limits</button>}
              {["APPROVED", "EXECUTING"].includes(plan.status) && <button type="button" disabled={busy} onClick={() => run.mutate(plan.id)} className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"><Send size={14} /> Prepare approved work</button>}
              <Link to="/merchant/growth/boundaries" className="rounded-md border border-border px-3 py-2 text-sm font-medium text-ink">Review boundaries</Link>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function AttributionSnapshot({ data }: { data: MerchantCommerceOverviewDTO | undefined }) {
  if (!data?.analytics || !data.agentAttribution) return null;
  const a = data.agentAttribution;
  const currency = data.analytics.currency;
  return <section className="space-y-3"><div><h2 className="text-base font-semibold text-ink">Who created the business result</h2><p className="mt-0.5 text-sm text-ink-muted">Total business performance stays separate from this agent and external buyer agents.</p></div><div className="grid gap-3 sm:grid-cols-3"><ValueTile icon={<BadgeIndianRupee size={16} />} label="Business performance" amount={data.analytics.receivedRevenueMinor} currency={currency} classification="OBSERVED" note="All provider-confirmed paid revenue." /><ValueTile icon={<Sparkles size={16} />} label="Your Merchant Agent" amount={a.ownAgentPaidRevenueMinor} currency={currency} classification="VERIFIED" note={`${a.ownAgentPaidOrderCount} paid orders originated by your agent.`} /><ValueTile icon={<Radar size={16} />} label="External Buyer Agents" amount={a.externalAgentPaidRevenueMinor} currency={currency} classification="VERIFIED" note={`${a.externalAgentPaidOrderCount} paid orders placed by other agents.`} /></div></section>;
}

function SetupChecklist({ connected, published, ready, boundaries, communication, autonomous, firstCycle }: { connected: boolean; published: boolean; ready: boolean; boundaries: boolean; communication: boolean; autonomous: boolean; firstCycle: boolean }) {
  const steps = [
    ["Connect Razorpay", connected, "/merchant/protocols", "Lets the agent verify payments instead of guessing."],
    ["Import or publish products", published, "/merchant/commerce/products", "Creates the catalogue the agent can sell."],
    ["Fix catalogue readiness", ready, "/merchant/readiness", "Makes products discoverable and safely transactable."],
    ["Set discount boundaries", boundaries, "/merchant/growth/boundaries", "Protects margin and portfolio spend."],
    ["Configure customer communication", communication, "/merchant/growth/boundaries", "Adds consent, channels, quiet hours and frequency caps."],
    ["Enable autonomous actions", autonomous, "/merchant/growth/boundaries", "Allows unattended cycles inside the same limits."],
    ["Run the first supervised cycle", firstCycle, "/merchant/agent", "Proves the end-to-end workflow before autonomy."],
  ] as const;
  const completed = steps.filter((step) => step[1]).length;
  if (completed === steps.length) return null;
  return <Card><CardHeader className="flex items-center justify-between gap-3"><div><CardTitle className="text-base">Finish setup</CardTitle><p className="mt-1 text-xs text-ink-muted">{completed} of {steps.length} complete</p></div><span className="text-sm font-bold text-brand-600">{Math.round(completed * 100 / steps.length)}%</span></CardHeader><CardBody><ol className="grid gap-2 lg:grid-cols-2">{steps.map(([label, done, to, why]) => <li key={label} className="flex items-start gap-2 rounded-md border border-border-hair p-3"><CheckCircle2 size={16} className={done ? "mt-0.5 text-success-text" : "mt-0.5 text-ink-faint"} /><div><Link to={to} className="text-sm font-medium text-ink hover:text-brand-600">{label}</Link><p className="mt-0.5 text-xs text-ink-muted">{why}</p></div></li>)}</ol></CardBody></Card>;
}

/* ------------------------------------------------------------------ page */

export default function OverviewPage() {
  const engine = useRevenueOpportunities();
  const summary = useGrowthSummary();
  const agent = useAgentStatus();
  const approvals = usePendingApprovals();
  const config = useGrowthConfig();
  const commerce = useQuery({ queryKey: ["merchant", "commerce-overview"], queryFn: () => apiGet<MerchantCommerceOverviewDTO>("/merchant/commerce-overview") });
  const campaignSummary = useQuery({ queryKey: ["campaigns", "summary"], queryFn: () => apiGet<CampaignSummary>("/campaigns-summary") });
  const planQuery = useQuery({ queryKey: ["growth-plans", "current"], queryFn: () => apiGet<GrowthPlanRow | null>("/growth-plans/current") });
  const today = new Date().toDateString();
  const actionsToday = agent.data?.autonomousActions?.filter((action) => new Date(action.at).toDateString() === today).length ?? 0;
  const approvalCount = approvals.data?.items?.length ?? summary.data?.pendingApprovals ?? 0;
  const failureCount = (agent.data?.failures?.length ?? 0) + (agent.data?.operations?.deadLetterJobs ?? 0) + (agent.data?.operations?.stalledJobs ?? 0);
  const growthConfig = config.data;
  const validPlan = planQuery.data && Array.isArray(planQuery.data.items) ? planQuery.data : null;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Merchant Today"
        lead="How your business is doing, what needs your attention, and what your Merchant Agent did for you—without making you operate an engineering console."
      />

      <MerchantTodayBriefing
        influencedMinor={summary.data?.observedCapturedValue?.amountMinor ?? 0}
        estimatedLiftMinor={campaignSummary.data?.estimatedIncrementalRevenueMinor ?? null}
        actionsToday={actionsToday}
        approvals={approvalCount}
        failures={failureCount}
        currency={summary.data?.observedCapturedValue?.currency ?? "INR"}
      />

      <div className="grid gap-4 xl:grid-cols-2">
        <AttentionInbox approvals={approvalCount} failures={failureCount} campaignWarnings={campaignSummary.data?.warnings ?? 0} opportunities={engine.data?.opportunities ?? []} />
        <WeeklyPlanCard plan={validPlan} weeklyBudgetMinor={growthConfig?.weeklyCampaignBudgetMinor ?? 0} maxContacts={(growthConfig?.maxCustomersContactedPerDay ?? 0) * 7} />
      </div>

      <SetupChecklist
        connected={(engine.data?.observed.ordersWithPaymentAttempt ?? 0) > 0}
        published={(engine.data?.observed.agentVisibleProductCount ?? 0) > 0}
        ready={(engine.data?.observed.transactableProductCount ?? 0) > 0}
        boundaries={Boolean(growthConfig)}
        communication={(growthConfig?.outboundChannels?.length ?? 0) > 0}
        autonomous={growthConfig?.autonomousRunsEnabled ?? false}
        firstCycle={Boolean(agent.data?.lastRun)}
      />

      <AttributionSnapshot data={commerce.data} />

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
          // Exactly the cards `totals.totalAtRiskMinor` was summed from —
          // see the note on the "Revenue at risk" tile below.
          const atRiskOpportunityCount = opportunities.filter((o) => o.expectedEffect.atRiskValue !== null).length;

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
                  {/* THE COUNT AND THE AMOUNT MUST COME FROM THE SAME SET.
                      This paired `totals.totalAtRiskMinor` — summed from the
                      opportunity cards below — with `observed.failedPayment
                      Count`, which counts failed payments on a different
                      endpoint over a different population. The two disagreed
                      by ₹11,783 against real seeded data while the caption
                      read as though the count explained the amount, on a tile
                      headed "countable right now in your own orders and
                      payments". Counting the cards the amount was actually
                      summed from is the only version a merchant can
                      reconcile. */}
                  <ValueTile
                    icon={<ShieldAlert size={16} />}
                    label="Revenue at risk"
                    amount={totals.totalAtRiskMinor}
                    currency={totals.currency}
                    classification="OBSERVED"
                    note={
                      totals.totalAtRiskMinor > 0
                        ? `Across ${atRiskOpportunityCount} uncaptured ${atRiskOpportunityCount === 1 ? "opportunity" : "opportunities"} — failed payments and stalled checkouts that exist right now.`
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
