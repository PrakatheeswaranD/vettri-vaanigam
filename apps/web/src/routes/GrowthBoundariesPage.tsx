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

export default function GrowthBoundariesPage() {
  const config = useGrowthConfig();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<MerchantGrowthConfigDTO | null>(null);

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
      void queryClient.invalidateQueries({ queryKey: ["merchant-agent", "growth-config"] });
      // The envelope decides what the engine may even detect, so its
      // output is stale the moment this changes.
      void queryClient.invalidateQueries({ queryKey: ["growth", "revenue-opportunities"] });
      void queryClient.invalidateQueries({ queryKey: ["merchant-agent", "status"] });
    },
  });

  if (config.isPending || draft === null) {
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

  const dirty = config.data ? JSON.stringify(draft) !== JSON.stringify(config.data) : false;

  function changed(): MerchantGrowthConfigUpdateDTO {
    const body: Record<string, unknown> = {};
    if (!config.data || !draft) return body;
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
            disabled={!dirty || save.isPending}
            onClick={() => save.mutate(changed())}
            className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {save.isPending ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <ShieldCheck size={14} aria-hidden />}
            {save.isPending ? "Saving…" : dirty ? "Save boundaries" : "Saved"}
          </button>
        }
      />

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

      <p className="text-xs leading-relaxed text-ink-faint">
        Changing a ceiling authorises every future action beneath it, so this is OWNER-only and every change is written to
        the audit ledger with what it was and what it became.
      </p>
    </div>
  );
}
