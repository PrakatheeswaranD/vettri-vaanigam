import { useState } from "react";
import { Plus, X, Play, Pause, CheckCircle2, Megaphone, Target } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, ApiError } from "../../lib/api-client";
import { Card, CardBody, CardHeader, CardTitle } from "../ui/Card";
import { formatMoney } from "../../lib/format";

interface CampaignItem {
  id: string;
  name: string;
  actionType: "CROSS_SELL" | "UPSELL" | "BUNDLE" | "BOUNDED_OFFER" | "RECOVERY";
  status: "ACTIVE" | "PAUSED" | "COMPLETED";
  budgetMinor: number;
  spentMinor: number;
  incentiveMinorPerConversion: number;
  maxUsesPerSubject: number;
  controlPercentBps: number;
  startsAt: string;
  endsAt: string;
  createdAt: string;
}

export function CampaignManager() {
  const [openModal, setOpenModal] = useState(false);
  const [name, setName] = useState("");
  const [actionType, setActionType] = useState<"CROSS_SELL" | "UPSELL" | "BUNDLE" | "BOUNDED_OFFER" | "RECOVERY">("UPSELL");
  const [budgetInr, setBudgetInr] = useState("5000");
  const [incentiveInr, setIncentiveInr] = useState("100");
  const [controlPercent, setControlPercent] = useState("10");
  const [durationDays, setDurationDays] = useState("14");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<{ items: CampaignItem[] }>({
    queryKey: ["campaigns"],
    queryFn: () => apiGet<{ items: CampaignItem[] }>("/campaigns"),
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const budgetMinor = Math.round(parseFloat(budgetInr) * 100);
      const incentiveMinorPerConversion = Math.round(parseFloat(incentiveInr) * 100);
      const controlPercentBps = Math.round(parseFloat(controlPercent) * 100);
      const startsAt = new Date();
      const endsAt = new Date(Date.now() + parseInt(durationDays, 10) * 86400000);

      return apiPost("/campaigns", {
        name,
        actionType,
        budgetMinor,
        incentiveMinorPerConversion,
        controlPercentBps,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["campaigns"] });
      setOpenModal(false);
      setName("");
      setErrorMsg(null);
    },
    onError: (err: unknown) => {
      setErrorMsg(err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Failed to create campaign.");
    },
  });

  const statusMutation = useMutation({
    mutationFn: async ({ campaignId, status }: { campaignId: string; status: "ACTIVE" | "PAUSED" | "COMPLETED" }) => {
      return apiPost(`/campaigns/${campaignId}/status`, { status });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["campaigns"] });
    },
  });

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-4">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-950 dark:text-brand-400">
            <Megaphone size={18} />
          </div>
          <div>
          <CardTitle>Bounded growth campaigns</CardTitle>
            <p className="text-xs text-ink-muted">Offers run for eligible buyer checkouts within your budget; creating one does not spend money.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpenModal(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-brand-700 transition-colors"
        >
          <Plus size={14} />
          Create campaign
        </button>
      </CardHeader>

      <CardBody className="space-y-4 pt-4">
        {isLoading ? (
          <div className="space-y-2">
            <div className="h-16 animate-pulse rounded-lg bg-surface-subtle" />
            <div className="h-16 animate-pulse rounded-lg bg-surface-subtle" />
          </div>
        ) : !data?.items || data.items.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-6 text-center">
            <Target size={28} className="mx-auto text-ink-faint" />
            <p className="mt-2 text-sm font-medium text-ink">No active campaigns</p>
            <p className="text-xs text-ink-muted">Create a bounded budget campaign to incentivize autonomous agent checkouts.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {data.items.map((c) => {
              const spentPercent = c.budgetMinor > 0 ? Math.min(100, Math.round((c.spentMinor / c.budgetMinor) * 100)) : 0;
              return (
                <div
                  key={c.id}
                  className="flex flex-col gap-3 rounded-lg border border-border bg-surface-subtle p-3.5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-ink">{c.name}</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          c.status === "ACTIVE"
                            ? "bg-success-subtle text-success-text"
                            : c.status === "PAUSED"
                              ? "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300"
                              : "bg-surface text-ink-muted"
                        }`}
                      >
                        {c.status}
                      </span>
                      <span className="rounded bg-surface px-1.5 py-0.5 text-[10px] font-medium text-ink-muted">
                        {c.actionType}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted">
                      <span>
                        Budget: <strong className="text-ink">{formatMoney({ amountMinor: c.spentMinor, currency: "INR" })}</strong> / {formatMoney({ amountMinor: c.budgetMinor, currency: "INR" })} ({spentPercent}%)
                      </span>
                      <span>
                        Incentive: <strong className="text-ink">{formatMoney({ amountMinor: c.incentiveMinorPerConversion, currency: "INR" })}</strong> / order
                      </span>
                      <span>
                        Control: <strong className="text-ink">{(c.controlPercentBps / 100).toFixed(0)}%</strong>
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {c.status === "ACTIVE" ? (
                      <button
                        type="button"
                        onClick={() => statusMutation.mutate({ campaignId: c.id, status: "PAUSED" })}
                        className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface-subtle"
                      >
                        <Pause size={12} />
                        Pause
                      </button>
                    ) : c.status === "PAUSED" ? (
                      <button
                        type="button"
                        onClick={() => statusMutation.mutate({ campaignId: c.id, status: "ACTIVE" })}
                        className="inline-flex items-center gap-1 rounded-md bg-brand-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-700"
                      >
                        <Play size={12} />
                        Resume
                      </button>
                    ) : null}

                    {c.status !== "COMPLETED" && (
                      <button
                        type="button"
                        onClick={() => statusMutation.mutate({ campaignId: c.id, status: "COMPLETED" })}
                        className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-medium text-ink-muted hover:bg-surface-subtle hover:text-ink"
                      >
                        <CheckCircle2 size={12} />
                        End
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardBody>

      {openModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-xl border border-border bg-surface p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-border pb-4">
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-950 dark:text-brand-400">
                  <Megaphone size={20} />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-ink">Create bounded campaign</h3>
                  <p className="text-xs text-ink-muted">Define buyer eligibility and a maximum incentive budget. Spend occurs only on qualifying orders.</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpenModal(false)}
                className="rounded-lg p-1.5 text-ink-faint hover:bg-surface-subtle hover:text-ink"
              >
                <X size={18} />
              </button>
            </div>

            {errorMsg && (
              <div className="mt-4 rounded-lg bg-red-50 p-3 text-xs text-red-700 dark:bg-red-950/50 dark:text-red-300">
                {errorMsg}
              </div>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                createMutation.mutate();
              }}
              className="mt-4 space-y-4"
            >
              <div>
                <label className="block text-xs font-medium text-ink-muted">Campaign Name</label>
                <input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Running Shoes Agent Upsell Q3"
                  className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-brand-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-ink-muted">Action Type</label>
                  <select
                    value={actionType}
                    onChange={(e) => setActionType(e.target.value as CampaignItem["actionType"])}
                    className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink focus:border-brand-500 focus:outline-none"
                  >
                    <option value="UPSELL">Upsell (Volume / Tier)</option>
                    <option value="CROSS_SELL">Cross-sell (Complement)</option>
                    <option value="BUNDLE">Bundle (Multi-item)</option>
                    <option value="BOUNDED_OFFER">Bounded Offer</option>
                    <option value="RECOVERY">Payment Recovery</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-ink-muted">Duration (Days)</label>
                  <input
                    type="number"
                    min="1"
                    max="90"
                    value={durationDays}
                    onChange={(e) => setDurationDays(e.target.value)}
                    className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink focus:border-brand-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-ink-muted">Total Budget (₹)</label>
                  <input
                    required
                    type="number"
                    min="100"
                    value={budgetInr}
                    onChange={(e) => setBudgetInr(e.target.value)}
                    className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink focus:border-brand-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-ink-muted">Incentive / Order (₹)</label>
                  <input
                    required
                    type="number"
                    min="1"
                    value={incentiveInr}
                    onChange={(e) => setIncentiveInr(e.target.value)}
                    className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink focus:border-brand-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-ink-muted">Control Group (%)</label>
                  <input
                    required
                    type="number"
                    min="0"
                    max="50"
                    value={controlPercent}
                    onChange={(e) => setControlPercent(e.target.value)}
                    className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink focus:border-brand-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
                <button
                  type="button"
                  onClick={() => setOpenModal(false)}
                  className="rounded-md border border-border px-3.5 py-2 text-sm font-medium text-ink hover:bg-surface-subtle"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createMutation.isPending}
                  className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
                >
                  {createMutation.isPending ? "Creating..." : "Create and activate"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </Card>
  );
}
