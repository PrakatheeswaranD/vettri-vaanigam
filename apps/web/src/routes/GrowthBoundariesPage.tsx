/**
 * Growth → Boundaries — the merchant's actual job.
 *
 * WHY THIS PAGE HAD TO EXIST
 *
 * The product's premise is that the merchant sets the limits and the agent
 * works inside them. The limits were read-only: `GET /merchant-agent/growth/config`
 * existed, no write path did, and the console could display an envelope
 * nobody could change. Half of the premise was not implemented.
 *
 * WHAT IS DELIBERATELY NOT HERE
 *
 * Anything that isn't a boundary. There is no "campaign wizard", no
 * targeting builder, no creative editor — the agent decides what to
 * propose and to whom, from the merchant's own data. The merchant decides
 * what it is *allowed* to propose, which is these nine fields and nothing
 * else.
 *
 * Every ceiling here authorises every future action beneath it, which is
 * why the write is OWNER-only and lands on the audit ledger. Raising a
 * discount ceiling is the same class of decision as changing spending
 * policy, and it is treated as one.
 */
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, ShieldCheck } from "lucide-react";
import type { MerchantGrowthConfigDTO, MerchantGrowthConfigUpdateDTO } from "@razorgrowth/contracts";
import { useGrowthConfig } from "../hooks/use-merchant-agent";
import { apiPatch, ApiError } from "../lib/api-client";
import { PageHeader } from "../components/layout/PageHeader";
import { Card, CardBody, CardHeader, CardTitle } from "../components/ui/Card";
import { ErrorState, Skeleton } from "../components/ui/States";

/** The switches, and what turning one off actually stops. Written as
 * consequences rather than field names — "cross-sell enabled" tells a
 * merchant nothing they did not already know from the label. */
const SWITCHES: Array<{ key: keyof MerchantGrowthConfigDTO; label: string; effect: string }> = [
  {
    key: "growthActionsEnabled",
    label: "Let the agent propose growth actions",
    effect: "The master switch. Off, the agent still detects opportunities and reports them, but proposes nothing and executes nothing.",
  },
  { key: "crossSellEnabled", label: "Cross-sell", effect: "Propose a complementary product alongside one a buyer already chose." },
  { key: "upsellEnabled", label: "Upsell", effect: "Propose a dearer variant of the product a buyer chose, within the uplift ceiling below." },
  { key: "bundleEnabled", label: "Bundles", effect: "Propose two or more products together at a bounded price." },
  { key: "boundedOffersEnabled", label: "Bounded offers", effect: "Propose a discount inside the ceiling below. Off, no offer opportunity is even detected." },
];

const CEILINGS: Array<{ key: keyof MerchantGrowthConfigDTO; label: string; unit: "bps" | "count"; help: string; max: number }> = [
  {
    key: "maxProposedDiscountBps",
    label: "Maximum discount the agent may propose",
    unit: "bps",
    max: 5_000,
    help: "The hard ceiling on any offer. The agent may propose less; it can never propose more, and the policy engine refuses anything above it.",
  },
  {
    key: "maxUpsellIncreaseBps",
    label: "Maximum upsell uplift",
    unit: "bps",
    max: 10_000,
    help: "How much dearer than the chosen product an upsell may be. Beyond this it is a different purchase, not an upgrade.",
  },
  { key: "maxCrossSellItems", label: "Most cross-sell items in one proposal", unit: "count", max: 10, help: "A longer list reads as a catalogue, not a recommendation." },
  { key: "maxBundleItems", label: "Most products in one bundle", unit: "count", max: 10, help: "" },
];

const PORTFOLIO_LIMITS: Array<{ key: keyof MerchantGrowthConfigDTO; label: string; unit: "money" | "count" | "bps" | "hours"; help: string; max: number }> = [
  { key: "dailyDiscountBudgetMinor", label: "Daily discount budget", unit: "money", max: 10_000_000, help: "Total discount value the agent may commit across all actions in one UTC day." },
  { key: "weeklyCampaignBudgetMinor", label: "Weekly campaign budget", unit: "money", max: 50_000_000, help: "A portfolio ceiling across campaigns, not a per-customer allowance." },
  { key: "maxCustomersContactedPerDay", label: "Customers contacted per day", unit: "count", max: 100_000, help: "Stops a large detected cohort becoming an uncontrolled broadcast." },
  { key: "maxContactsPerCustomerPerWeek", label: "Contacts per customer per week", unit: "count", max: 50, help: "Protects customers from contact fatigue across every channel." },
  { key: "minCampaignMarginBps", label: "Minimum margin after campaign costs", unit: "bps", max: 10_000, help: "Includes product cost, incentive and known transaction costs before an action is eligible." },
  { key: "campaignCooldownHours", label: "Campaign cooldown", unit: "hours", max: 8_760, help: "The agent will not target the same customer again until this window has passed." },
  { key: "automaticStopLossBps", label: "Automatic stop-loss", unit: "bps", max: 10_000, help: "Automatically pauses a campaign when measured loss crosses this share of its budget." },
  { key: "defaultShippingCostMinor", label: "Default shipping cost", unit: "money", max: 10_000_000, help: "Used in profit checks when a campaign has no more specific shipping quote." },
  { key: "paymentFeeBps", label: "Payment fee", unit: "bps", max: 10_000, help: "Deducted from campaign revenue before contribution is reported." },
  { key: "expectedReturnRateBps", label: "Expected return rate", unit: "bps", max: 10_000, help: "A conservative expected cost applied before an incentive is considered profitable." },
];

const CHANNELS = [
  ["BUYER_AGENT", "Buyer Agent"],
  ["EMAIL", "Email"],
  ["WHATSAPP", "WhatsApp"],
  ["SMS", "SMS"],
  ["PUSH", "Push notification"],
] as const;

function parseIds(value: string): string[] {
  return [...new Set(value.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean))];
}

function parseCategoryLimits(value: string): Record<string, number> | null {
  const result: Record<string, number> = {};
  for (const line of value.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("=").map((part) => part.trim());
    const [category, percent] = parts;
    const amount = Number(percent);
    if (parts.length !== 2 || !category || !percent || !Number.isFinite(amount) || amount < 0 || amount > 50 || Object.hasOwn(result, category) || ["__proto__", "constructor", "prototype"].includes(category)) return null;
    result[category] = Math.round(amount * 100);
  }
  return result;
}

export default function GrowthBoundariesPage() {
  const config = useGrowthConfig();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<MerchantGrowthConfigDTO | null>(null);
  const [categoryText, setCategoryText] = useState<string | null>(null);
  const [productIdsText, setProductIdsText] = useState<string | null>(null);
  const [customerIdsText, setCustomerIdsText] = useState<string | null>(null);

  // Seed the form from the server exactly once per load. A merchant
  // half-way through editing must not have their input replaced by a
  // background refetch of what they are in the middle of changing.
  useEffect(() => {
    if (config.data && draft === null) setDraft(config.data);
  }, [config.data, draft]);

  const save = useMutation({
    mutationFn: (body: MerchantGrowthConfigUpdateDTO) =>
      apiPatch<MerchantGrowthConfigDTO>("/merchant-agent/growth/config", body),
    onSuccess: (saved) => {
      setDraft(saved);
      setCategoryText(null);
      setProductIdsText(null);
      setCustomerIdsText(null);
      void queryClient.invalidateQueries({ queryKey: ["merchant-agent", "growth-config"] });
      // The envelope decides what the engine may even detect, so its
      // output is stale the moment this changes.
      void queryClient.invalidateQueries({ queryKey: ["growth", "revenue-opportunities"] });
      void queryClient.invalidateQueries({ queryKey: ["merchant-agent", "status"] });
    },
  });

  if (!config.isError && (config.isPending || draft === null)) {
    return (
      <div className="space-y-4" role="status" aria-label="Loading your growth boundaries">
        <Skeleton className="h-32" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (config.isError) {
    return (
      <Card>
        <ErrorState message="Could not load your growth boundaries." onRetry={() => void config.refetch()} />
      </Card>
    );
  }
  if (!draft) return null;

  const dirty = categoryText !== null || productIdsText !== null || customerIdsText !== null || (config.data ? JSON.stringify(draft) !== JSON.stringify(config.data) : false);
  const invalidCategories = categoryText !== null && parseCategoryLimits(categoryText) === null;

  function changed(): MerchantGrowthConfigUpdateDTO {
    const body: Record<string, unknown> = {};
    if (!config.data || !draft) return body;
    if (categoryText !== null) body.categoryDiscountLimits = parseCategoryLimits(categoryText);
    if (productIdsText !== null) body.excludedProductIds = parseIds(productIdsText);
    if (customerIdsText !== null) body.excludedCustomerIds = parseIds(customerIdsText);
    for (const key of Object.keys(draft) as Array<keyof MerchantGrowthConfigDTO>) {
      // `currency` is the merchant's own, not an agent boundary — the
      // update contract does not accept it.
      if (key === "currency") continue;
      if (draft[key] !== config.data[key]) body[key] = draft[key];
    }
    return body as MerchantGrowthConfigUpdateDTO;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Boundaries"
        lead="What your agent is allowed to do. It decides what to propose and to whom from your own data; you decide the limits it may never cross."
        actions={
          <button
            type="button"
            disabled={!dirty || save.isPending || invalidCategories}
            onClick={() => save.mutate(changed())}
            className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {save.isPending ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <ShieldCheck size={14} aria-hidden />}
            {save.isPending ? "Saving…" : dirty ? "Save boundaries" : "Saved"}
          </button>
        }
      />

      {invalidCategories && <p role="alert" className="text-sm text-red-700">Use one unique category per line, followed by = and a percentage from 0 to 50. Invalid entries will not be saved.</p>}
      {save.isError ? (
        <Card>
          <ErrorState
            message={
              save.error instanceof ApiError
                ? save.error.message
                : "Could not save. Only an OWNER may change what the agent is allowed to do."
            }
          />
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>What the agent may propose</CardTitle>
        </CardHeader>
        <CardBody className="divide-y divide-border-hair">
          {SWITCHES.map((row) => (
            <label key={row.key} className="flex cursor-pointer items-start gap-3 py-3 first:pt-0 last:pb-0">
              <input
                type="checkbox"
                checked={Boolean(draft[row.key])}
                onChange={(event) => setDraft({ ...draft, [row.key]: event.target.checked })}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-border text-brand-600"
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-ink">{row.label}</span>
                <span className="mt-0.5 block text-xs leading-snug text-ink-muted">{row.effect}</span>
              </span>
            </label>
          ))}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>When the agent may act</CardTitle>
        </CardHeader>
        <CardBody>
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={Boolean(draft.autonomousRunsEnabled)}
              onChange={(event) => setDraft({ ...draft, autonomousRunsEnabled: event.target.checked })}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-border text-brand-600"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-ink">Let the agent run cycles without me</span>
              <span className="mt-0.5 block text-xs leading-snug text-ink-muted">
                Off, the agent only runs when you press <em>Run a cycle</em>. On, it also runs on a schedule while you are
                not watching. It does nothing extra either way — the same boundaries above, the same policy checks, the
                same approvals for anything outside them. What changes is only whether you have to be present.
              </span>
            </span>
          </label>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Limits it may never cross</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          {CEILINGS.map((row) => {
            const raw = Number(draft[row.key] ?? 0);
            return (
              <div key={row.key}>
                <label className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium text-ink">{row.label}</span>
                  <span className="flex items-center gap-1.5">
                    <input
                      type="number"
                      min={row.unit === "bps" ? 0 : 1}
                      max={row.max}
                      value={row.unit === "bps" ? raw / 100 : raw}
                      onChange={(event) => {
                        const entered = Number(event.target.value);
                        if (Number.isNaN(entered)) return;
                        setDraft({ ...draft, [row.key]: row.unit === "bps" ? Math.round(entered * 100) : Math.round(entered) });
                      }}
                      className="w-24 rounded-md border border-border-hair bg-surface px-2 py-1.5 text-right text-sm tabular-nums text-ink"
                    />
                    <span className="text-sm text-ink-muted">{row.unit === "bps" ? "%" : "items"}</span>
                  </span>
                </label>
                {row.help ? <p className="mt-1 text-xs leading-snug text-ink-faint">{row.help}</p> : null}
              </div>
            );
          })}
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>Customer communication</CardTitle></CardHeader>
        <CardBody className="space-y-5">
          <div>
            <p className="text-sm font-medium text-ink">Channels the agent may use</p>
            <p className="mt-1 text-xs text-ink-muted">A configured delivery provider is still required. Enabling a channel never invents consent or bypasses quiet hours.</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {CHANNELS.map(([value, label]) => (
                <label key={value} className="flex items-center gap-2 rounded-md border border-border-hair px-3 py-2 text-sm text-ink">
                  <input type="checkbox" checked={draft.outboundChannels.includes(value)} onChange={(event) => setDraft({ ...draft, outboundChannels: event.target.checked ? [...draft.outboundChannels, value] : draft.outboundChannels.filter((channel) => channel !== value) })} className="h-4 w-4 rounded border-border text-brand-600" />
                  {label}
                </label>
              ))}
            </div>
          </div>
          <label className="flex items-start gap-3">
            <input type="checkbox" checked={draft.consentRequired} onChange={(event) => setDraft({ ...draft, consentRequired: event.target.checked })} className="mt-0.5 h-4 w-4 rounded border-border text-brand-600" />
            <span><span className="block text-sm font-medium text-ink">Require recorded consent</span><span className="mt-0.5 block text-xs text-ink-muted">No outbound message may be queued unless the selected customer has consent for that channel.</span></span>
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium text-ink">Quiet hours begin<input type="number" min={0} max={23} value={draft.quietHoursStart} onChange={(event) => setDraft({ ...draft, quietHoursStart: Number(event.target.value) })} className="mt-1 block w-full rounded-md border border-border-hair bg-surface px-3 py-2" /></label>
            <label className="text-sm font-medium text-ink">Quiet hours end<input type="number" min={0} max={23} value={draft.quietHoursEnd} onChange={(event) => setDraft({ ...draft, quietHoursEnd: Number(event.target.value) })} className="mt-1 block w-full rounded-md border border-border-hair bg-surface px-3 py-2" /></label>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>Portfolio budgets and stop rules</CardTitle></CardHeader>
        <CardBody className="space-y-4">
          {PORTFOLIO_LIMITS.map((row) => {
            const raw = Number(draft[row.key] ?? 0);
            const displayed = row.unit === "money" || row.unit === "bps" ? raw / 100 : raw;
            const suffix = row.unit === "money" ? "₹" : row.unit === "bps" ? "%" : row.unit === "hours" ? "hours" : "people";
            return <div key={row.key}>
              <label className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-medium text-ink">{row.label}</span><span className="flex items-center gap-1.5"><input type="number" min={0} max={row.max} value={displayed} onChange={(event) => { const entered = Number(event.target.value); if (!Number.isNaN(entered)) setDraft({ ...draft, [row.key]: row.unit === "money" || row.unit === "bps" ? Math.round(entered * 100) : Math.round(entered) }); }} className="w-28 rounded-md border border-border-hair bg-surface px-2 py-1.5 text-right text-sm tabular-nums text-ink" /><span className="text-sm text-ink-muted">{suffix}</span></span></label>
              <p className="mt-1 text-xs text-ink-faint">{row.help}</p>
            </div>;
          })}
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>Category limits and exclusions</CardTitle></CardHeader>
        <CardBody className="space-y-4">
          <p className="text-xs leading-relaxed text-ink-muted">These are hard portfolio exclusions. The agent may still explain the opportunity, but it cannot target an excluded product or customer.</p>
          <label className="block text-sm font-medium text-ink">
            Maximum discount by category
            <span className="mt-0.5 block text-xs font-normal text-ink-faint">One per line, for example <code>Electronics=5</code> for 5%.</span>
            <textarea rows={3} value={categoryText ?? Object.entries(draft.categoryDiscountLimits).map(([category, bps]) => `${category}=${bps / 100}`).join("\n")} onChange={(event) => setCategoryText(event.target.value)} className="mt-2 block w-full rounded-md border border-border-hair bg-surface px-3 py-2 font-mono text-sm" />
          </label>
          <details className="rounded-md border border-border-hair px-4 py-3">
            <summary className="cursor-pointer text-sm font-medium text-ink">Advanced exclusions</summary>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <label className="text-sm font-medium text-ink">Excluded product IDs<textarea rows={4} value={productIdsText ?? draft.excludedProductIds.join("\n")} onChange={(event) => setProductIdsText(event.target.value)} className="mt-1 block w-full rounded-md border border-border-hair bg-surface px-3 py-2 font-mono text-xs" /></label>
              <label className="text-sm font-medium text-ink">Excluded customer IDs<textarea rows={4} value={customerIdsText ?? draft.excludedCustomerIds.join("\n")} onChange={(event) => setCustomerIdsText(event.target.value)} className="mt-1 block w-full rounded-md border border-border-hair bg-surface px-3 py-2 font-mono text-xs" /></label>
            </div>
          </details>
        </CardBody>
      </Card>

      <p className="text-xs leading-relaxed text-ink-faint">
        Changing a ceiling authorises every future action beneath it, so this is OWNER-only and every change is written to
        the audit ledger with what it was and what it became.
      </p>
    </div>
  );
}
