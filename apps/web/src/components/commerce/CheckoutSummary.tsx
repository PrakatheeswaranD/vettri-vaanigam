/**
 * PART 06 §77-§83, §189 — the "READY FOR PAYMENT" order summary. Every
 * number here is exactly what `POST /commerce/checkout` returned —
 * server-computed, never recalculated in the browser. Makes the
 * PART 05 → PART 06 boundary visible: the authorization that gated this
 * checkout is shown as CONSUMED, and payment is explicitly NOT STARTED.
 */
import { Ban, CheckCircle2, KeyRound, ShieldCheck } from "lucide-react";
import type { CheckoutResponseDTO } from "@razorgrowth/contracts";
import { Card, CardBody, CardHeader, CardTitle } from "../ui/Card";
import { DemoDataBadge } from "../ui/DemoDataBadge";
import { formatDateTime, formatMoney } from "../../lib/format";
import { PaymentPanel } from "./PaymentPanel";

const SOURCE_LABEL: Record<string, string> = {
  DIRECT_BUYER: "Your selection",
  AI_CROSS_SELL: "AI cross-sell",
  AI_UPSELL: "AI upsell",
  AI_BUNDLE: "AI bundle",
  AI_BOUNDED_OFFER: "AI bounded offer",
  AI_RECOVERY: "AI recovery offer",
};

export function CheckoutSummary({
  checkout,
  context = "buyer",
}: {
  checkout: CheckoutResponseDTO;
  context?: "buyer" | "merchant-simulation";
}) {
  const isMerchantSimulation = context === "merchant-simulation";
  return (
    <div className="space-y-4">
      <Card className="border-success/40">
        <CardHeader className="flex flex-wrap items-center gap-2">
          <CardTitle>{isMerchantSimulation ? "Simulated buyer order" : "Order summary"}</CardTitle>
          <span className="rounded-full bg-success-subtle px-2 py-0.5 text-[11px] font-medium text-success-text">{checkout.status.replace(/_/g, " ")}</span>
          <DemoDataBadge />
        </CardHeader>
        <CardBody className="space-y-3">
          {isMerchantSimulation ? (
            <p className="rounded-card bg-info-subtle px-3 py-2 text-xs text-info-text">
              This test order demonstrates the buyer journey for the approved offer. It is not a merchant purchase and
              is not realized revenue.
            </p>
          ) : null}
          <ul className="divide-y divide-border">
            {checkout.items.map((item) => (
              <li key={item.variantId} className="flex items-center justify-between gap-3 py-2 text-sm">
                <div>
                  <p className="font-medium text-ink">
                    {item.productName} <span className="text-ink-faint">· {item.variantTitle}</span>
                  </p>
                  <p className="text-xs text-ink-faint">
                    {SOURCE_LABEL[item.source] ?? item.source} · qty {item.quantity} × {formatMoney({ amountMinor: item.unitPriceMinor, currency: item.currency })}
                  </p>
                </div>
                <div className="text-right">
                  {item.lineDiscountMinor > 0 ? (
                    <p className="text-xs text-ink-faint line-through">{formatMoney({ amountMinor: item.lineSubtotalMinor, currency: item.currency })}</p>
                  ) : null}
                  <p className="font-medium text-ink">{formatMoney({ amountMinor: item.lineTotalMinor, currency: item.currency })}</p>
                </div>
              </li>
            ))}
          </ul>

          <div className="space-y-1 border-t border-border pt-3 text-sm">
            <div className="flex justify-between text-ink-muted">
              <span>Subtotal</span>
              <span>{formatMoney({ amountMinor: checkout.totals.subtotalMinor, currency: checkout.totals.currency })}</span>
            </div>
            {checkout.totals.discountMinor > 0 ? (
              <div className="flex justify-between text-success-text">
                <span>Discount{checkout.appliedOffer ? ` (${SOURCE_LABEL[`AI_${checkout.appliedOffer.actionType}`] ?? "authorized offer"})` : ""}</span>
                <span>−{formatMoney({ amountMinor: checkout.totals.discountMinor, currency: checkout.totals.currency })}</span>
              </div>
            ) : null}
            <div className="flex justify-between text-base font-semibold text-ink">
              <span>Total</span>
              <span>{formatMoney({ amountMinor: checkout.totals.totalMinor, currency: checkout.totals.currency })}</span>
            </div>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Agentic Action &amp; Authority</CardTitle>
        </CardHeader>
        <CardBody className="grid gap-3 text-sm sm:grid-cols-2">
          <div className="flex items-center gap-2">
            <ShieldCheck size={14} className="text-success" />
            <span className="text-ink-muted">Execution authorization:</span>
            <span className="font-medium text-ink">{checkout.authorization.consumed ? "Consumed for this checkout" : "Active"}</span>
          </div>
          <div className="flex items-center gap-2">
            <KeyRound size={14} className="text-info" />
            <span className="text-ink-muted">Order fingerprint:</span>
            <span className="font-mono text-xs text-ink">{checkout.orderFingerprint.slice(0, 16)}…</span>
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle2 size={14} className="text-success" />
            <span className="text-ink-muted">Checkout expires:</span>
            <span className="font-medium text-ink">{formatDateTime(checkout.expiresAt)}</span>
          </div>
          <div className="flex items-center gap-2">
            <Ban size={14} className="text-danger" />
            <span className="text-ink-muted">Payment status:</span>
            <span className="font-medium text-ink">{isMerchantSimulation ? "TEST NOT STARTED" : "NOT STARTED"}</span>
          </div>
        </CardBody>
      </Card>

      <PaymentPanel checkoutId={checkout.checkoutId} context={context} />
    </div>
  );
}
