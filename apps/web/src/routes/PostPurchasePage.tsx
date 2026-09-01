/**
 * Post-purchase operations, made reachable.
 *
 * WHY THIS PAGE EXISTS
 *
 * Refunds, returns, fulfillment and disputes were fully implemented and
 * state-machine-tested on the server, and had no frontend caller at all.
 * A merchant could not refund a captured payment, approve a return,
 * attach a tracking number, or record a chargeback from the console —
 * every one of those was an API a person had to reach with curl.
 *
 * The order lifecycle does not end at capture. A gateway that can take
 * money and cannot give it back is not a payments product.
 *
 * REFUNDS ARE PRESENTED AS MONEY LEAVING
 *
 * A refund is the one action here that moves funds, so it does not share
 * the generic "create" affordance. It is scoped to a payment that is
 * actually CAPTURED, defaults to nothing, and states the amount in words
 * before it can be submitted — the amount field is the whole risk.
 */
import { useMemo, useState } from "react";
import { RotateCcw, PackageCheck, Truck, Gavel, Calculator, AlertTriangle } from "lucide-react";
import { PageHeader } from "../components/layout/PageHeader";
import { RupeeInput } from "../components/ui/RupeeInput";
import { Card, CardBody, CardHeader, CardTitle } from "../components/ui/Card";
import { ErrorState, Skeleton } from "../components/ui/States";
import { formatMoney } from "../lib/format";
import { useTransactions } from "../hooks/use-api";
import {
  useAdvanceDispute,
  useAdvanceFulfillment,
  useAdvanceReturn,
  useCalculateTax,
  useCreateDispute,
  useCreateRefund,
  useDisputes,
  useFulfillments,
  useRefunds,
  useReturns,
} from "../hooks/use-post-purchase";

const RETURN_FLOW = ["REQUESTED", "APPROVED", "RECEIVED", "COMPLETED"] as const;
const FULFILLMENT_FLOW = ["PENDING", "SHIPPED", "IN_TRANSIT", "DELIVERED"] as const;
const DISPUTE_FLOW = ["OPEN", "UNDER_REVIEW", "WON", "LOST"] as const;

/** The next legal state, or null at a terminal one. Mirrors the server's
 *  state machine so the console never offers a transition the API will
 *  refuse — an enabled button that always errors is worse than none. */
function nextStatus(flow: readonly string[], current: string): string | null {
  const index = flow.indexOf(current);
  if (index < 0 || index >= flow.length - 1) return null;
  return flow[index + 1] ?? null;
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "COMPLETED" || status === "DELIVERED" || status === "WON" || status === "SUCCEEDED" || status === "PROCESSED"
      ? "bg-success-subtle text-success-text ring-success-border"
      : status === "LOST" || status === "FAILED"
        ? "bg-danger-subtle text-danger-text ring-danger-border"
        : "bg-accent-subtle text-accent-text ring-accent-border";
  return <span className={`inline-flex items-center rounded-pill px-2 py-0.5 text-micro font-semibold ring-1 ring-inset ${tone}`}>{status}</span>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-card border border-dashed border-border bg-surface-subtle p-4 text-center text-sm text-ink-faint">{children}</p>;
}

export default function PostPurchasePage() {
  const refunds = useRefunds();
  const returns = useReturns();
  const fulfillments = useFulfillments();
  const disputes = useDisputes();
  // A wide page deliberately: refundable payments are a minority of the
  // feed and sort by recency, so the default page can contain none of
  // them and the refund form would render "nothing to refund" while
  // captured payments sit one page over.
  const transactions = useTransactions({ limit: 100 });

  const createRefund = useCreateRefund();
  const createDispute = useCreateDispute();
  const advanceReturn = useAdvanceReturn();
  const advanceFulfillment = useAdvanceFulfillment();
  const advanceDispute = useAdvanceDispute();
  const calculateTax = useCalculateTax();

  const [refundPaymentId, setRefundPaymentId] = useState("");
  const [refundAmount, setRefundAmount] = useState(0);
  const [refundReason, setRefundReason] = useState("");

  const [disputePaymentId, setDisputePaymentId] = useState("");
  const [disputeAmount, setDisputeAmount] = useState(0);
  const [disputeReason, setDisputeReason] = useState("");

  const [taxAmount, setTaxAmount] = useState(100000);
  const [taxRateBps, setTaxRateBps] = useState(1800);
  const [merchantState, setMerchantState] = useState("KA");
  const [buyerState, setBuyerState] = useState("KA");

  /** Only a CAPTURED payment can be refunded or disputed. Offering the
   *  others would produce a guaranteed server rejection. */
  const refundable = useMemo(
    () => (transactions.data?.items ?? []).filter((t) => t.state === "CAPTURED" && t.paymentId !== null),
    [transactions.data],
  );

  const selectedPayment = refundable.find((t) => t.paymentId === refundPaymentId);
  const overRefund = Boolean(selectedPayment && refundAmount > selectedPayment.amount.amountMinor);

  if (transactions.isLoading) return <Skeleton className="h-96" />;
  if (transactions.isError) return <ErrorState message="Could not load payments." onRetry={() => transactions.refetch()} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Post-Purchase Operations"
        lead="The order lifecycle after capture — refunds, returns, shipping and chargebacks. Every transition here is the same state machine the API enforces; nothing is advanced client-side."
      />

      {/* ── Refunds ─────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="flex items-center gap-2">
          <RotateCcw size={16} className="text-brand-600" />
          <CardTitle>Refunds</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          {refundable.length === 0 ? (
            <Empty>No captured payment to refund yet. A payment must reach CAPTURED before money can be sent back.</Empty>
          ) : (
            <div className="space-y-3 rounded-card border border-border p-4">
              <label className="block">
                <span className="text-sm font-semibold">Captured payment</span>
                <select
                  value={refundPaymentId}
                  onChange={(event) => {
                    setRefundPaymentId(event.target.value);
                    setRefundAmount(0);
                  }}
                  className="mt-1.5 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
                >
                  <option value="">Select a payment…</option>
                  {refundable.map((t) => (
                    <option key={t.paymentId} value={t.paymentId ?? ""}>
                      {formatMoney(t.amount)} · {t.customerName} · {t.paymentId?.slice(0, 8)}
                    </option>
                  ))}
                </select>
              </label>

              <RupeeInput
                label="Amount to refund"
                valueMinor={refundAmount}
                onChangeMinor={setRefundAmount}
                max={selectedPayment?.amount.amountMinor}
                help={
                  selectedPayment
                    ? `Partial refunds are allowed, up to ${formatMoney(selectedPayment.amount)}.`
                    : "Partial refunds are allowed."
                }
              />

              <label className="block">
                <span className="text-sm font-semibold">Reason</span>
                <input
                  value={refundReason}
                  onChange={(event) => setRefundReason(event.target.value)}
                  placeholder="Why this money is going back"
                  className="mt-1.5 w-full rounded-md border border-border px-3 py-2 text-sm"
                />
              </label>

              {overRefund ? (
                <div className="flex items-start gap-2 rounded-md border border-danger-border bg-danger-subtle p-3 text-sm text-danger-text">
                  <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                  That is more than the payment captured. The server will refuse it.
                </div>
              ) : null}

              {refundPaymentId && refundAmount > 0 && !overRefund ? (
                <p className="rounded-md bg-brand-50 p-3 text-sm text-brand-700">
                  This sends <strong>{formatMoney({ amountMinor: refundAmount, currency: selectedPayment?.amount.currency ?? "INR" })}</strong> back to the
                  customer and restocks the reserved inventory.
                </p>
              ) : null}

              <button
                onClick={() => createRefund.mutate({ paymentId: refundPaymentId, amountMinor: refundAmount, reason: refundReason })}
                disabled={createRefund.isPending || !refundPaymentId || refundAmount <= 0 || !refundReason.trim() || overRefund}
                className="rounded-md bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                {createRefund.isPending ? "Refunding…" : "Issue refund"}
              </button>
              {createRefund.isError ? <p className="text-sm text-danger-text">Refund refused by the server. The payment state may have changed.</p> : null}
            </div>
          )}

          {refunds.isLoading ? <Skeleton className="h-16" /> : (refunds.data?.items.length ?? 0) === 0 ? (
            <Empty>No refunds issued.</Empty>
          ) : (
            <div className="space-y-1.5">
              {refunds.data?.items.map((r) => (
                <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-card border border-border-subtle bg-surface-subtle p-2.5">
                  <StatusPill status={r.status} />
                  <span className="text-sm font-medium">{formatMoney({ amountMinor: r.amountMinor, currency: r.currency })}</span>
                  <code className="font-mono text-micro text-ink-faint">{r.paymentId.slice(0, 8)}</code>
                  <span className="ml-auto text-micro text-ink-faint">{r.reason}</span>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      {/* ── Returns ─────────────────────────────────────────────── */}
      <LifecycleCard
        icon={<PackageCheck size={16} className="text-brand-600" />}
        title="Returns"
        query={returns}
        emptyText="No return requests. A buyer-initiated return appears here and moves REQUESTED → APPROVED → RECEIVED → COMPLETED."
        renderRow={(r) => {
          const next = nextStatus(RETURN_FLOW, r.status);
          return (
            <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-card border border-border-subtle bg-surface-subtle p-2.5">
              <StatusPill status={r.status} />
              <code className="font-mono text-micro text-ink-faint">order {r.orderId.slice(0, 8)}</code>
              <span className="text-micro text-ink-muted">{r.items.length} item(s)</span>
              <span className="text-micro text-ink-faint">{r.reason}</span>
              {next ? (
                <button
                  onClick={() => advanceReturn.mutate({ returnId: r.id, status: next })}
                  disabled={advanceReturn.isPending}
                  className="ml-auto rounded-md border border-border px-2.5 py-1 text-micro font-semibold hover:bg-surface disabled:opacity-50"
                >
                  Mark {next}
                </button>
              ) : (
                <span className="ml-auto text-micro text-ink-faint">Terminal state</span>
              )}
            </div>
          );
        }}
      />

      {/* ── Fulfillment ─────────────────────────────────────────── */}
      <LifecycleCard
        icon={<Truck size={16} className="text-brand-600" />}
        title="Fulfillment"
        query={fulfillments}
        emptyText="No shipments recorded. A shipment carries a carrier and tracking number and moves PENDING → SHIPPED → IN_TRANSIT → DELIVERED."
        renderRow={(f) => {
          const next = nextStatus(FULFILLMENT_FLOW, f.status);
          return (
            <div key={f.id} className="flex flex-wrap items-center gap-2 rounded-card border border-border-subtle bg-surface-subtle p-2.5">
              <StatusPill status={f.status} />
              <span className="text-sm font-medium">{f.carrier}</span>
              <code className="font-mono text-micro text-ink-faint">{f.trackingNumber}</code>
              {next ? (
                <button
                  onClick={() => advanceFulfillment.mutate({ fulfillmentId: f.id, status: next })}
                  disabled={advanceFulfillment.isPending}
                  className="ml-auto rounded-md border border-border px-2.5 py-1 text-micro font-semibold hover:bg-surface disabled:opacity-50"
                >
                  Mark {next}
                </button>
              ) : (
                <span className="ml-auto text-micro text-ink-faint">Delivered</span>
              )}
            </div>
          );
        }}
      />

      {/* ── Disputes ────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="flex items-center gap-2">
          <Gavel size={16} className="text-brand-600" />
          <CardTitle>Disputes &amp; chargebacks</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          {refundable.length > 0 ? (
            <div className="grid gap-3 rounded-card border border-border p-4 sm:grid-cols-3">
              <label className="block sm:col-span-1">
                <span className="text-sm font-semibold">Payment</span>
                <select value={disputePaymentId} onChange={(e) => setDisputePaymentId(e.target.value)} className="mt-1.5 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm">
                  <option value="">Select…</option>
                  {refundable.map((t) => (
                    <option key={t.paymentId} value={t.paymentId ?? ""}>{t.paymentId?.slice(0, 8)}</option>
                  ))}
                </select>
              </label>
              <RupeeInput label="Disputed amount" valueMinor={disputeAmount} onChangeMinor={setDisputeAmount} />
              <label className="block">
                <span className="text-sm font-semibold">Reason</span>
                <input value={disputeReason} onChange={(e) => setDisputeReason(e.target.value)} className="mt-1.5 w-full rounded-md border border-border px-3 py-2 text-sm" />
              </label>
              <div className="sm:col-span-3">
                <button
                  onClick={() => createDispute.mutate({ paymentId: disputePaymentId, amountMinor: disputeAmount, reason: disputeReason })}
                  disabled={createDispute.isPending || !disputePaymentId || disputeAmount <= 0 || !disputeReason.trim()}
                  className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {createDispute.isPending ? "Recording…" : "Record dispute"}
                </button>
              </div>
            </div>
          ) : null}

          {disputes.isLoading ? <Skeleton className="h-16" /> : (disputes.data?.items.length ?? 0) === 0 ? (
            <Empty>No disputes. A chargeback moves OPEN → UNDER_REVIEW → WON or LOST.</Empty>
          ) : (
            <div className="space-y-1.5">
              {disputes.data?.items.map((d) => {
                const next = nextStatus(DISPUTE_FLOW, d.status);
                return (
                  <div key={d.id} className="flex flex-wrap items-center gap-2 rounded-card border border-border-subtle bg-surface-subtle p-2.5">
                    <StatusPill status={d.status} />
                    <span className="text-sm font-medium">{formatMoney({ amountMinor: d.amountMinor, currency: d.currency })}</span>
                    <code className="font-mono text-micro text-ink-faint">{d.paymentId.slice(0, 8)}</code>
                    <span className="text-micro text-ink-faint">{d.reason}</span>
                    {d.status === "UNDER_REVIEW" ? (
                      <span className="ml-auto flex gap-1.5">
                        <button onClick={() => advanceDispute.mutate({ disputeId: d.id, status: "WON" })} className="rounded-md border border-border px-2.5 py-1 text-micro font-semibold hover:bg-surface">Mark WON</button>
                        <button onClick={() => advanceDispute.mutate({ disputeId: d.id, status: "LOST" })} className="rounded-md border border-border px-2.5 py-1 text-micro font-semibold hover:bg-surface">Mark LOST</button>
                      </span>
                    ) : next ? (
                      <button onClick={() => advanceDispute.mutate({ disputeId: d.id, status: next })} className="ml-auto rounded-md border border-border px-2.5 py-1 text-micro font-semibold hover:bg-surface">Mark {next}</button>
                    ) : (
                      <span className="ml-auto text-micro text-ink-faint">Closed</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardBody>
      </Card>

      {/* ── GST ─────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="flex items-center gap-2">
          <Calculator size={16} className="text-brand-600" />
          <CardTitle>Indian GST calculation</CardTitle>
        </CardHeader>
        <CardBody className="space-y-3">
          <p className="text-sm text-ink-muted">
            Same state is CGST + SGST; different states is IGST. Computed server-side in integer paise — the console never does the arithmetic.
          </p>
          <div className="grid gap-3 sm:grid-cols-4">
            <RupeeInput label="Taxable amount" valueMinor={taxAmount} onChangeMinor={setTaxAmount} />
            <label className="block"><span className="text-sm font-semibold">Rate (bps)</span>
              <input type="number" min={0} value={taxRateBps} onChange={(e) => setTaxRateBps(Number(e.target.value))} className="mt-1.5 w-full rounded-md border border-border px-3 py-2 text-sm" /></label>
            <label className="block"><span className="text-sm font-semibold">Merchant state</span>
              <input value={merchantState} onChange={(e) => setMerchantState(e.target.value.toUpperCase())} maxLength={10} className="mt-1.5 w-full rounded-md border border-border px-3 py-2 text-sm" /></label>
            <label className="block"><span className="text-sm font-semibold">Buyer state</span>
              <input value={buyerState} onChange={(e) => setBuyerState(e.target.value.toUpperCase())} maxLength={10} className="mt-1.5 w-full rounded-md border border-border px-3 py-2 text-sm" /></label>
          </div>
          <button
            onClick={() => calculateTax.mutate({ amountMinor: taxAmount, taxRateBps, merchantStateCode: merchantState, buyerStateCode: buyerState })}
            disabled={calculateTax.isPending}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {calculateTax.isPending ? "Calculating…" : "Calculate GST"}
          </button>
          {calculateTax.data ? (
            <div className="grid gap-2 rounded-card border border-border bg-surface-subtle p-3 sm:grid-cols-4">
              <Figure label={calculateTax.data.isInterState ? "IGST" : "CGST"} minor={calculateTax.data.isInterState ? calculateTax.data.totalIgstMinor : calculateTax.data.totalCgstMinor} />
              {!calculateTax.data.isInterState ? <Figure label="SGST" minor={calculateTax.data.totalSgstMinor} /> : null}
              <Figure label="Total tax" minor={calculateTax.data.totalTaxAmountMinor} />
              <div>
                <p className="text-micro uppercase tracking-wide text-ink-faint">Treatment</p>
                <p className="mt-0.5 text-sm font-semibold">{calculateTax.data.isInterState ? "Inter-state" : "Intra-state"}</p>
              </div>
            </div>
          ) : null}
          {calculateTax.isError ? <p className="text-sm text-danger-text">Could not calculate. Check the state codes.</p> : null}
        </CardBody>
      </Card>
    </div>
  );
}

function Figure({ label, minor }: { label: string; minor: number }) {
  return (
    <div>
      <p className="text-micro uppercase tracking-wide text-ink-faint">{label}</p>
      <p className="mt-0.5 text-sm font-semibold">{formatMoney({ amountMinor: minor, currency: "INR" })}</p>
    </div>
  );
}

function LifecycleCard<T>({
  icon,
  title,
  query,
  emptyText,
  renderRow,
}: {
  icon: React.ReactNode;
  title: string;
  query: { isLoading: boolean; isError: boolean; data?: { items: T[] }; refetch: () => unknown };
  emptyText: string;
  renderRow: (row: T) => React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex items-center gap-2">
        {icon}
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardBody>
        {query.isLoading ? (
          <Skeleton className="h-16" />
        ) : query.isError ? (
          <ErrorState message={`Could not load ${title.toLowerCase()}.`} onRetry={() => query.refetch()} />
        ) : (query.data?.items.length ?? 0) === 0 ? (
          <Empty>{emptyText}</Empty>
        ) : (
          <div className="space-y-1.5">{query.data?.items.map(renderRow)}</div>
        )}
      </CardBody>
    </Card>
  );
}
