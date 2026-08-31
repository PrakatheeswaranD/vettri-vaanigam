import { useEffect, useState } from "react";
import { CheckCircle2, ShieldCheck } from "lucide-react";
import { useBuyerSpendingPolicy, useUpdateBuyerSpendingPolicy } from "../hooks/use-api";
import { formatMoney } from "../lib/format";
import { ErrorState, Skeleton } from "../components/ui/States";

export default function CustomerPolicyPage() {
  const policy = useBuyerSpendingPolicy();
  const update = useUpdateBuyerSpendingPolicy();
  const [autonomous, setAutonomous] = useState(200000);
  const [daily, setDaily] = useState(1000000);
  const [categories, setCategories] = useState("Electronics/Laptop, Books, Accessories");
  useEffect(() => { if (policy.data) { setAutonomous(policy.data.autonomousPurchaseLimitMinor); setDaily(policy.data.dailyLimitMinor); setCategories(policy.data.allowedCategories.join(", ")); } }, [policy.data]);
  if (policy.isLoading) return <Skeleton className="h-80" />;
  if (policy.isError) return <ErrorState message="Could not load your spending policy." onRetry={() => policy.refetch()} />;
  return <div className="mx-auto max-w-3xl space-y-6"><header><p className="text-xs font-bold uppercase tracking-wider text-brand-600">Customer controls</p><h1 className="mt-1 text-2xl font-bold">Buyer Agent spending policy</h1><p className="mt-2 text-sm text-ink-muted">Bound what the agent may purchase autonomously. Purchases above the threshold require your explicit approval.</p></header>
    <form onSubmit={(event) => { event.preventDefault(); update.mutate({ autonomousPurchaseLimitMinor: autonomous, dailyLimitMinor: daily, allowedCategories: categories.split(",").map((value) => value.trim()).filter(Boolean), approvalRequiredAboveLimit: true }); }} className="space-y-5 rounded-card border border-border bg-surface p-6">
      <MoneyField label="Autonomous purchase limit" value={autonomous} setValue={setAutonomous} help={`Current limit: ${formatMoney({ amountMinor: autonomous, currency: "INR" })}`} />
      <MoneyField label="Daily limit" value={daily} setValue={setDaily} help={`Current limit: ${formatMoney({ amountMinor: daily, currency: "INR" })}`} />
      <label className="block"><span className="text-sm font-semibold">Allowed categories</span><input value={categories} onChange={(event) => setCategories(event.target.value)} className="mt-2 w-full rounded-md border border-border px-3 py-2 text-sm" /><span className="mt-1 block text-xs text-ink-faint">Comma-separated, matched deterministically.</span></label>
      <div className="flex items-start gap-2 rounded-md bg-brand-50 p-3 text-sm text-brand-700"><ShieldCheck size={17} className="mt-0.5 shrink-0" />Above the autonomous limit, the Buyer Agent must ask you to authorize the exact amount.</div>
      <button disabled={update.isPending || daily < autonomous} className="rounded-md bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{update.isPending ? "Saving…" : "Save spending policy"}</button>
      {update.isSuccess ? <span className="ml-3 inline-flex items-center gap-1 text-sm text-success-text"><CheckCircle2 size={14} /> Saved</span> : null}
    </form>
  </div>;
}
function MoneyField({ label, value, setValue, help }: { label: string; value: number; setValue: (value: number) => void; help: string }) { return <label className="block"><span className="text-sm font-semibold">{label}</span><input type="number" min={0} step={100} value={value} onChange={(event) => setValue(Number(event.target.value))} className="mt-2 w-full rounded-md border border-border px-3 py-2 text-sm" /><span className="mt-1 block text-xs text-ink-faint">{help} · stored in integer paise</span></label>; }
