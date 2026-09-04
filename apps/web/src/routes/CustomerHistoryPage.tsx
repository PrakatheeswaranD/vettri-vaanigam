/**
 * A shopper's own record of what their agent did with their money.
 *
 * WHAT THIS REPLACED, AND WHY
 *
 * Three nav destinations — Orders, Payments, Activity — all rendered one
 * identical list. A navigation that promises three things and delivers
 * the same screen three times is a navigation that lies, and it made two
 * of the three items pure decoration.
 *
 * The list itself named no product. Every row read "Meridian Athletics ·
 * ₹5,802.00 · PROPOSED" over a raw UUID, with no date — a shopper could
 * not tell which purchase a row was, only that one had happened. It also
 * printed the proposal's ORIGINAL explanation next to its CURRENT status,
 * so a failed purchase was captioned "ready for authorization".
 *
 * So: one data source, three genuinely different lenses.
 *
 *   Orders    — what you actually bought. Purchases that reached an order,
 *               newest first, named and dated.
 *   Payments  — where the money is. Only purchases with payment evidence,
 *               with the debit/credit split and the checkout action.
 *   Activity  — everything, including what was refused and why. This is
 *               the transparency surface, so nothing is filtered out.
 *
 * Amounts, states and reasons are all still read from the server. Nothing
 * on this screen is computed from what the browser believes.
 */
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { PaymentDTO } from "@razorgrowth/contracts";
import { Activity, CheckCircle2, Clock3, Package, Receipt, RotateCw, ShieldX, ShoppingCart, WalletCards } from "lucide-react";
import { Link } from "react-router-dom";
import { apiGet } from "../lib/api-client";
import { formatDateTime, formatMoney, formatRelativeTime } from "../lib/format";
import { completeBuyerCheckout } from "../lib/buyer-checkout";
import { Card, CardBody, CardHeader, CardTitle } from "../components/ui/Card";
import { EmptyState, ErrorState, Skeleton } from "../components/ui/States";
import { PaymentStateBadge } from "../components/ui/StatusBadge";
import { PageHeader } from "../components/layout/PageHeader";

interface PurchaseItem {
  variantId: string;
  quantity: number;
  unitPriceMinor: number;
  lineDiscountMinor: number;
  productName: string | null;
  variantTitle: string | null;
  category: string | null;
}

interface Purchase {
  id: string;
  explanation: string;
  outcome: string;
  reasonCode: string | null;
  settlementStatus: string | null;
  computedTotalMinor: number | null;
  preNegotiationTotalMinor: number | null;
  negotiationStatus: string | null;
  negotiatedDiscountBps: number | null;
  currency: "INR" | "USD" | null;
  internalOrderId: string | null;
  internalPaymentId: string | null;
  createdAt: string;
  merchant: { name: string };
  items: PurchaseItem[];
}

type Lens = "cart" | "orders" | "payments";

const LENS_COPY: Record<Lens, { title: string; description: string; empty: string; emptyHint: string }> = {
  cart: {
    title: "Cart & negotiated offers",
    description: "Purchase proposals your Buyer Agent prepared for you. Review the basket, savings, and policy outcome before checkout.",
    empty: "No proposed baskets",
    emptyHint: "Ask your Buyer Agent what you want to buy. Matching recommendations and negotiated offers will appear here after a proposal is created.",
  },
  orders: {
    title: "Your orders",
    description: "Purchases your Buyer Agent carried through to a real order. An order is not proof of payment — open Payments for that.",
    empty: "No orders yet",
    emptyHint: "Ask the Buyer Agent to find something, then authorize the proposal it brings back.",
  },
  payments: {
    title: "Your payments",
    description: "Where the money actually is. Payment state comes from the provider, never from this page — refreshing reads it, it does not change it.",
    empty: "No payments yet",
    emptyHint: "A payment appears here once you authorize a purchase proposal.",
  },
};

/**
 * Human sentences for the machine states a shopper should never have to
 * read. `tone` is used for colour AND an icon, never colour alone.
 */
const STATUS_COPY: Record<string, { label: string; tone: "success" | "warning" | "danger" | "info" | "neutral"; detail: string }> = {
  PROPOSED: { label: "Awaiting your authorization", tone: "neutral", detail: "Nothing has been ordered or charged." },
  EXECUTING: { label: "Being placed", tone: "info", detail: "The order is being created. Do not start another purchase for this item." },
  PAYMENT_PENDING: { label: "Payment not completed", tone: "warning", detail: "The order exists and the payment has not been captured yet." },
  SETTLED: { label: "Paid", tone: "success", detail: "The provider confirmed this payment was captured." },
  FAILED: { label: "Did not go through", tone: "danger", detail: "Nothing was charged. You can safely try again." },
  UNKNOWN: { label: "Outcome unconfirmed", tone: "warning", detail: "The provider outcome could not be confirmed. Do not retry — read the payment evidence." },
};

const TONE_CLASSES: Record<string, string> = {
  success: "bg-success-subtle text-success-text",
  warning: "bg-warning-subtle text-warning-text",
  danger: "bg-danger-subtle text-danger-text",
  info: "bg-info-subtle text-info-text",
  neutral: "bg-surface-sunken text-ink-muted",
};

/** A declined proposal's reason code, said in words a shopper can act on. */
const DECLINE_COPY: Record<string, string> = {
  CATEGORY_NOT_ALLOWED: "Your spending policy does not allow this product's category.",
  INSUFFICIENT_INVENTORY: "The merchant did not have enough stock.",
  DAILY_LIMIT_EXCEEDED: "This would pass your daily spending limit.",
  AUTONOMOUS_LIMIT_EXCEEDED: "This is above the amount your agent may spend without asking you.",
  BUYER_BUDGET_EXCEEDED: "This costs more than the budget you gave the agent.",
  POLICY_CURRENCY_MISMATCH: "The product is priced in a currency your policy does not cover.",
};

function purchaseTitle(purchase: Purchase): string {
  const named = purchase.items.filter((item) => item.productName);
  if (named.length === 0) return purchase.merchant.name;
  const first = named[0]!;
  const label = first.quantity > 1 ? `${first.productName} × ${first.quantity}` : first.productName!;
  return named.length > 1 ? `${label} + ${named.length - 1} more` : label;
}

/**
 * `embedded` renders the same lens as a SECTION rather than a page.
 *
 * The `cart` lens — proposals the agent prepared and nobody has
 * authorized yet — used to be its own nav destination, "Cart & Offers".
 * It is not a place a shopper goes; it is the output of the conversation
 * they are already having, so it belongs on the Buyer Agent screen where
 * they can act on it. Everything below is identical either way; only the
 * heading changes, because a section inside a page must not render a
 * second `<h1>`.
 */
function CustomerHistoryPage({ lens, embedded = false }: { lens: Lens; embedded?: boolean }) {
  const copy = LENS_COPY[lens];
  const [selected, setSelected] = useState<string | null>(null);

  const history = useQuery({
    queryKey: ["buyer", "purchases"],
    queryFn: () => apiGet<{ items: Purchase[] }>("/buyer/purchase-proposals"),
  });
  const evidence = useQuery({
    queryKey: ["buyer", "payment", selected],
    queryFn: () => apiGet<PaymentDTO>(`/buyer/purchase-proposals/${selected}/payment`),
    enabled: Boolean(selected),
  });
  const checkout = useMutation({
    mutationFn: () => completeBuyerCheckout(selected!),
    onSuccess: () => { void evidence.refetch(); void history.refetch(); },
  });

  const all = history.data?.items ?? [];
  const visible = all.filter((purchase) =>
    lens === "cart" ? !purchase.internalOrderId && purchase.outcome !== "DECLINE"
      : lens === "orders" ? Boolean(purchase.internalOrderId)
      : lens === "payments" ? Boolean(purchase.internalPaymentId)
        : true,
  );

  const settled = all.filter((purchase) => purchase.settlementStatus === "SETTLED").length;
  const pendingPayments = all.filter((purchase) => purchase.settlementStatus === "PAYMENT_PENDING").length;
  const uncertainPayments = all.filter((purchase) => ["UNKNOWN", "FAILED"].includes(purchase.settlementStatus ?? "")).length;
  const declined = all.filter((purchase) => purchase.outcome === "DECLINE").length;
  const allowed = all.length - declined;

  const refreshButton = (
    <button
      type="button"
      onClick={() => { void history.refetch(); if (selected) void evidence.refetch(); }}
      disabled={history.isFetching}
      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-2 text-sm font-medium text-ink transition hover:bg-surface-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:opacity-60"
    >
      <RotateCw size={14} className={history.isFetching ? "animate-spin" : undefined} aria-hidden />
      {history.isFetching ? "Refreshing…" : "Refresh"}
    </button>
  );

  return (
    <div className="space-y-6">
      {embedded ? (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold tracking-tight text-ink">{copy.title}</h2>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-muted">{copy.description}</p>
          </div>
          {refreshButton}
        </div>
      ) : (
        <PageHeader title={copy.title} lead={copy.description} actions={refreshButton} />
      )}

      {!history.isPending && !history.isError ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {lens === "cart" ? (
            <>
              <SummaryMetric icon={<ShoppingCart size={16} />} label="Proposed baskets" value={visible.length} />
              <SummaryMetric icon={<CheckCircle2 size={16} />} label="Negotiated offers" value={visible.filter((p) => (p.negotiatedDiscountBps ?? 0) > 0).length} tone="success" />
              <SummaryMetric icon={<Clock3 size={16} />} label="Ready to review" value={visible.filter((p) => p.outcome !== "DECLINE").length} tone="warning" />
            </>
          ) : lens === "orders" ? (
            <>
              <SummaryMetric icon={<Package size={16} />} label="Orders created" value={visible.length} />
              <SummaryMetric icon={<CheckCircle2 size={16} />} label="Paid orders" value={settled} tone="success" />
              <SummaryMetric icon={<Clock3 size={16} />} label="Awaiting payment" value={pendingPayments} tone="warning" />
            </>
          ) : lens === "payments" ? (
            <>
              <SummaryMetric icon={<WalletCards size={16} />} label="Payment records" value={visible.length} />
              <SummaryMetric icon={<CheckCircle2 size={16} />} label="Provider-confirmed paid" value={settled} tone="success" />
              <SummaryMetric icon={<ShieldX size={16} />} label="Need attention" value={uncertainPayments} tone="danger" />
            </>
          ) : (
            <>
              <SummaryMetric icon={<Activity size={16} />} label="Agent proposals" value={all.length} />
              <SummaryMetric icon={<CheckCircle2 size={16} />} label="Allowed by policy" value={allowed} tone="success" />
              <SummaryMetric icon={<ShieldX size={16} />} label="Refused by policy" value={declined} tone="danger" />
            </>
          )}
        </div>
      ) : null}

      {history.isPending ? (
        <div className="space-y-3" role="status" aria-label="Loading your purchases">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      ) : history.isError ? (
        <Card><ErrorState message="Could not load your purchase history." onRetry={() => void history.refetch()} /></Card>
      ) : visible.length === 0 ? (
        <Card>
          <EmptyState
            title={copy.empty}
            description={copy.emptyHint}
            icon={lens === "cart" ? <ShoppingCart size={18} /> : lens === "orders" ? <Package size={18} /> : lens === "payments" ? <Receipt size={18} /> : <Activity size={18} />}
          />
          {lens === "cart" ? <div className="pb-6 text-center"><Link to="/customer/buyer-agent" className="text-sm font-semibold text-brand-600 hover:underline">Ask the Buyer Agent →</Link></div> : null}
        </Card>
      ) : (
        <ul className="space-y-3">
          {visible.map((purchase) => (
            <PurchaseRow
              key={purchase.id}
              purchase={purchase}
              lens={lens}
              expanded={selected === purchase.id}
              onToggle={() => setSelected(selected === purchase.id ? null : purchase.id)}
              evidence={selected === purchase.id ? evidence : null}
              checkout={selected === purchase.id ? checkout : null}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function PurchaseRow({
  purchase,
  lens,
  expanded,
  onToggle,
  evidence,
  checkout,
}: {
  purchase: Purchase;
  lens: Lens;
  expanded: boolean;
  onToggle: () => void;
  evidence: ReturnType<typeof useQuery<PaymentDTO>> | null;
  checkout: ReturnType<typeof useMutation<PaymentDTO | null, Error, void>> | null;
}) {
  const declined = purchase.outcome === "DECLINE";
  const status = STATUS_COPY[purchase.settlementStatus ?? "PROPOSED"];
  const savedMinor =
    purchase.preNegotiationTotalMinor !== null && purchase.computedTotalMinor !== null
      ? purchase.preNegotiationTotalMinor - purchase.computedTotalMinor
      : 0;

  return (
    <li>
      <Card>
        <CardHeader className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="truncate text-[15px]">{purchaseTitle(purchase)}</CardTitle>
            <p className="mt-1 text-xs text-ink-muted">
              {purchase.merchant.name} ·{" "}
              <time dateTime={purchase.createdAt} title={formatDateTime(purchase.createdAt)}>
                {formatRelativeTime(purchase.createdAt)}
              </time>
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <div className="text-right">
              <p className="text-[15px] font-semibold tabular-nums text-ink">
                {formatMoney({ amountMinor: purchase.computedTotalMinor ?? 0, currency: purchase.currency ?? "INR" })}
              </p>
              {savedMinor > 0 ? (
                <p className="text-xs tabular-nums text-success-text">
                  {formatMoney({ amountMinor: savedMinor, currency: purchase.currency ?? "INR" })} saved
                </p>
              ) : null}
            </div>
            {declined ? (
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${TONE_CLASSES.danger}`}>
                <ShieldX size={12} aria-hidden /> Refused
              </span>
            ) : (
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${TONE_CLASSES[status?.tone ?? "neutral"]}`}>
                {status?.label ?? purchase.settlementStatus ?? purchase.outcome}
              </span>
            )}
          </div>
        </CardHeader>

        <CardBody className="space-y-3">
          <p className="text-sm text-ink-muted">
            {declined
              ? DECLINE_COPY[purchase.reasonCode ?? ""] ?? purchase.explanation
              : status?.detail ?? purchase.explanation}
          </p>

          {(lens === "orders" || lens === "cart") && purchase.items.length > 0 ? (
            <ul className="space-y-1 border-t border-border-hair pt-3">
              {purchase.items.map((item) => (
                <li key={item.variantId} className="flex items-baseline justify-between gap-4 text-sm">
                  <span className="min-w-0 truncate text-ink">
                    {item.variantTitle ?? item.productName ?? "Product no longer in the catalogue"}
                    {item.quantity > 1 ? <span className="text-ink-faint"> × {item.quantity}</span> : null}
                  </span>
                  <span className="shrink-0 tabular-nums text-ink-muted">
                    {formatMoney({ amountMinor: item.unitPriceMinor * item.quantity - item.lineDiscountMinor, currency: purchase.currency ?? "INR" })}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}

          {lens !== "orders" && purchase.internalPaymentId ? (
            <div className="border-t border-border-hair pt-3">
              <button
                type="button"
                onClick={onToggle}
                aria-expanded={expanded}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-ink transition hover:bg-surface-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
              >
                {expanded ? "Hide payment evidence" : "Read authoritative payment status"}
              </button>

              {expanded ? (
                <div className="mt-3 rounded-md border border-border bg-surface-subtle p-4" aria-live="polite">
                  {evidence?.isPending ? (
                    <Skeleton className="h-16" />
                  ) : evidence?.isError ? (
                    <p className="text-sm text-ink-muted">
                      No payment evidence is available for this purchase yet. Do not repeat an uncertain purchase.
                    </p>
                  ) : evidence?.data ? (
                    <div className="space-y-3">
                      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-3">
                        <div>
                          <dt className="text-micro font-medium uppercase tracking-wide text-ink-faint">Provider state</dt>
                          <dd className="mt-1"><PaymentStateBadge state={evidence.data.state} /></dd>
                        </div>
                        <div>
                          <dt className="text-micro font-medium uppercase tracking-wide text-ink-faint">Money left you</dt>
                          <dd className="mt-1 text-sm text-ink">{evidence.data.customerDebitStatus}</dd>
                        </div>
                        <div>
                          <dt className="text-micro font-medium uppercase tracking-wide text-ink-faint">Merchant received</dt>
                          <dd className="mt-1 text-sm text-ink">{evidence.data.merchantCreditStatus}</dd>
                        </div>
                      </dl>
                      <p className="text-xs text-ink-faint">
                        {evidence.data.automaticRetryBlocked
                          ? "Automatic retry is blocked. Any further attempt needs a governed recovery decision."
                          : "A retry would require a separate governed recovery decision — it never happens automatically."}
                      </p>
                      {evidence.data.provider === "RAZORPAY" && evidence.data.state === "CREATED" && checkout ? (
                        <div>
                          <button
                            type="button"
                            disabled={checkout.isPending}
                            onClick={() => checkout.mutate()}
                            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:opacity-60"
                          >
                            {checkout.isPending ? "Opening checkout…" : "Complete Razorpay Test checkout"}
                          </button>
                          {checkout.isError ? (
                            <p role="alert" className="mt-2 text-sm text-danger-text">{checkout.error.message}</p>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </CardBody>
      </Card>
    </li>
  );
}

function SummaryMetric({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number; tone?: "success" | "warning" | "danger" }) {
  const toneClass = tone === "success" ? "text-success-text" : tone === "warning" ? "text-warning-text" : tone === "danger" ? "text-danger-text" : "text-brand-600";
  return <div className="rounded-card border border-border bg-surface px-4 py-3"><div className={toneClass}>{icon}</div><p className="mt-2 text-2xl font-bold tabular-nums text-ink">{value}</p><p className="text-xs text-ink-muted">{label}</p></div>;
}

export function CustomerOrdersPage() { return <CustomerHistoryPage lens="orders" />; }
export function CustomerPaymentsPage() { return <CustomerHistoryPage lens="payments" />; }
/** The agent's un-authorized proposals, rendered inside the Buyer Agent
 * screen. See the `embedded` note on `CustomerHistoryPage`. */
export function CustomerProposalsSection() { return <CustomerHistoryPage lens="cart" embedded />; }
export default CustomerOrdersPage;
