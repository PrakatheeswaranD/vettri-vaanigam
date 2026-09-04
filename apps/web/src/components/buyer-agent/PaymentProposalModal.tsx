import { useState } from "react";
import type { PaymentDTO, RecommendedProductDTO } from "@razorgrowth/contracts";
import { formatMoney } from "../../lib/format";
import { apiGet, apiPost } from "../../lib/api-client";
import { completeBuyerCheckout } from "../../lib/buyer-checkout";
import { NegotiationPanel } from "./NegotiationPanel";
import { useBuyerStanding } from "../../hooks/use-negotiation";

interface Proposal {
  id: string;
  amountMinor: number;
  currency: "INR" | "USD";
  outcome: "DECLINE" | "STEP_UP" | "AUTO_APPROVE";
  explanation: string;
  requiresApproval: boolean;
  expiresAt: string;
}

export function PaymentProposalModal({ recommendation, buyerBudgetMinor, onClose }: {
  recommendation: Pick<RecommendedProductDTO, "product" | "variantId">;
  buyerBudgetMinor?: number;
  onClose: () => void;
}) {
  const [proposal, setProposal] = useState<Proposal | null>(null);
  // Only fetched once there is a proposal to negotiate against — a shopper
  // browsing has no use for it and it would be a request per card.
  const standing = useBuyerStanding(recommendation.product.merchantId, Boolean(proposal));
  const [payment, setPayment] = useState<PaymentDTO | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Set while Razorpay's overlay is open, so a checkout that never became usable can still be closed. */
  const [cancelCheckout, setCancelCheckout] = useState<(() => void) | null>(null);

  async function perform(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try { await action(); } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The server could not confirm the request.");
    } finally { setBusy(false); }
  }

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4 backdrop-blur-sm">
    <section role="dialog" aria-modal="true" aria-labelledby="purchase-title" className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-surface p-6 shadow-2xl">
      <div className="flex items-center justify-between gap-3">
        <h2 id="purchase-title" className="text-lg font-bold">Governed purchase proposal</h2>
        <button onClick={onClose} aria-label="Close purchase proposal" className="rounded-lg border px-3 py-1">Close</button>
      </div>
      <p className="mt-4 font-semibold">{recommendation.product.identity.name}</p>
      <p className="mt-2 text-sm text-ink-muted">Prices, stock, categories, and spending limits are checked by the server. Creating an order does not confirm payment capture.</p>
      {!proposal && <button disabled={busy} onClick={() => void perform(async () => {
        setProposal(await apiPost<Proposal>("/buyer/purchase-proposals", { variantId: recommendation.variantId, quantity: 1, ...(buyerBudgetMinor === undefined ? {} : { budgetMinor: buyerBudgetMinor }) }));
      })} className="mt-5 rounded-lg bg-brand-600 px-4 py-3 text-white disabled:opacity-50">{busy ? "Checking policy…" : "Check saved spending policy"}</button>}
      {proposal && <div className="mt-5 space-y-3 rounded-xl border border-border p-4">
        <p className="font-bold">{formatMoney({ amountMinor: proposal.amountMinor, currency: proposal.currency })}</p>
        <p className="text-sm">Policy: {proposal.outcome}</p>
        <p className="text-sm">{proposal.explanation}</p>
        <p className="text-xs text-ink-muted">Authorization expires {new Date(proposal.expiresAt).toLocaleString()}.</p>

        {/* Only before authorization. Once the buyer has authorized a
            price, renegotiating it would mean charging something they
            never agreed to. */}
        {proposal.outcome !== "DECLINE" && !attempted ? (
          <NegotiationPanel
            proposalId={proposal.id}
            standing={standing.data}
            currency={proposal.currency}
            onApplied={(result) => {
              // The authorize step charges the SERVER's price; this keeps
              // what the shopper is looking at in step with it.
              setProposal({ ...proposal, amountMinor: result.finalTotalMinor });
            }}
          />
        ) : null}
        {proposal.outcome !== "DECLINE" && !attempted && <button disabled={busy} onClick={() => void perform(async () => {
          const authorizedPayment = await apiPost<PaymentDTO>(`/buyer/purchase-proposals/${proposal.id}/authorize`, {});
          setPayment(authorizedPayment);
          setAttempted(true);
        })} className="rounded-lg bg-brand-600 px-4 py-3 text-white disabled:opacity-50">Authorize this purchase</button>}
      </div>}
      {attempted && <div className="mt-5 space-y-3 rounded-xl border border-border p-4">
        <h3 className="font-semibold">{payment?.state === "CAPTURED" ? "Payment captured" : "Payment not confirmed as captured"}</h3>
        <p className="text-sm">State: {payment?.state ?? "Awaiting authoritative evidence"}</p>
        {payment?.provider === "RAZORPAY" && payment.state === "CREATED" ? <button disabled={busy} className="rounded-lg bg-brand-600 px-4 py-2 text-white disabled:opacity-50" onClick={() => void perform(async () => { const verified = await completeBuyerCheckout(proposal!.id, (cancel) => setCancelCheckout(() => cancel)); setCancelCheckout(null); if (verified) setPayment(verified); })}>Complete Razorpay Test checkout</button> : null}
        {/* Razorpay's overlay can fail to become usable and then fires
            neither callback — see `completeBuyerCheckout`. Without this the
            buyer is left under a backdrop with a disabled button and no way
            out but a reload. It asserts nothing about the payment. */}
        {busy && cancelCheckout ? <button className="ml-2 rounded-lg border border-border px-3 py-2 text-sm" onClick={() => { cancelCheckout(); setCancelCheckout(null); }}>Close the payment window</button> : null}
        {payment?.provider === "MOCK" ? <p className="text-sm text-ink-muted">Mock gateway order only. No real Razorpay payment has occurred.</p> : null}
        {payment && <>
          <p className="break-all text-xs">Order: {payment.orderId}</p>
          <p className="break-all text-xs">Payment: {payment.id}</p>
          <p className="text-sm">Customer debit: {payment.customerDebitStatus}</p>
          <p className="text-sm">Merchant credit: {payment.merchantCreditStatus}</p>
        </>}
        <p className="text-xs text-ink-muted">Do not submit another purchase while this attempt is unconfirmed. Payment completion requires provider evidence; refreshing only reads status.</p>
        <button disabled={busy} onClick={() => void perform(async () => {
          setPayment(await apiGet<PaymentDTO>(`/buyer/purchase-proposals/${proposal!.id}/payment`));
        })} className="rounded-lg border border-border px-4 py-2 disabled:opacity-50">Refresh payment evidence</button>
      </div>}
      {busy && <p role="status" className="mt-3 text-sm">Waiting for the server…</p>}
      {error && <p role="alert" className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{error}</p>}
    </section>
  </div>;
}
