import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { PaymentDTO } from "@razorgrowth/contracts";
import { apiGet } from "../lib/api-client";
import { formatMoney } from "../lib/format";
import { completeBuyerCheckout } from "../lib/buyer-checkout";
import { useMutation } from "@tanstack/react-query";

interface Purchase {
  id: string; explanation: string; outcome: string; settlementStatus: string | null;
  computedTotalMinor: number | null; currency: "INR" | "USD" | null; internalOrderId: string | null;
  internalPaymentId: string | null; createdAt: string; merchant: { name: string };
}

export default function CustomerHistoryPage() {
  const [selected, setSelected] = useState<string | null>(null);
  const history = useQuery({ queryKey: ["buyer", "purchases"], queryFn: () => apiGet<{ items: Purchase[] }>("/buyer/purchase-proposals") });
  const evidence = useQuery({ queryKey: ["buyer", "payment", selected], queryFn: () => apiGet<PaymentDTO>(`/buyer/purchase-proposals/${selected}/payment`), enabled: Boolean(selected) });
  const checkout = useMutation({ mutationFn: () => completeBuyerCheckout(selected!), onSuccess: () => { void evidence.refetch(); } });
  return <div className="space-y-5">
    <h1 className="text-2xl font-bold">Your purchase history</h1>
    <p className="text-sm text-ink-muted">Proposals, orders, and payment evidence remain available after closing checkout. Pending is not captured.</p>
    <button className="rounded-lg border px-4 py-2" onClick={() => { void history.refetch(); if (selected) void evidence.refetch(); }}>Refresh evidence</button>
    {history.isPending ? <p role="status">Loading purchases…</p> : history.isError ? <p role="alert">Could not load your purchases.</p> : history.data.items.length === 0 ? <p>No purchase proposals yet.</p> : history.data.items.map((purchase) => <article key={purchase.id} className="space-y-2 rounded-card border border-border bg-surface p-4">
      <h2 className="font-semibold">{purchase.merchant.name}</h2>
      <p>{formatMoney({ amountMinor: purchase.computedTotalMinor ?? 0, currency: purchase.currency ?? "INR" })} · {purchase.settlementStatus ?? purchase.outcome}</p>
      <p className="text-sm text-ink-muted">{purchase.explanation}</p>
      <p className="break-all text-xs">Proposal: {purchase.id}</p>
      <button className="rounded-lg border px-3 py-2 text-sm" onClick={() => setSelected(purchase.id)}>Read authoritative payment status</button>
    </article>)}
    {selected ? <section className="space-y-2 rounded-card border border-border bg-surface p-5" aria-live="polite">
      <h2 className="font-semibold">Payment evidence</h2>
      {evidence.data?.provider === "RAZORPAY" && evidence.data.state === "CREATED" ? <button disabled={checkout.isPending} className="rounded-lg bg-brand-600 px-4 py-2 text-white" onClick={() => checkout.mutate()}>Complete existing Razorpay Test checkout</button> : null}
      {checkout.isError ? <p role="alert">{checkout.error.message}</p> : null}
      {evidence.isPending ? <p>Loading…</p> : evidence.isError ? <p>No payment evidence is available for this proposal yet. Do not repeat an uncertain purchase.</p> : evidence.data ? <><p>State: {evidence.data.state}</p><p>Customer debit: {evidence.data.customerDebitStatus}</p><p>Merchant credit: {evidence.data.merchantCreditStatus}</p><p>Automatic retry: {evidence.data.automaticRetryBlocked ? "Blocked" : "Requires a separate governed recovery decision"}</p></> : null}
    </section> : null}
  </div>;
}
