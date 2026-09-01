/**
 * "Can you do better on the price?" — answered by the shopper's own record.
 *
 * WHY THE DEFAULT ACTION NAMES NO NUMBER
 *
 * Nobody haggling in a shop thinks in basis points, and asking a shopper to
 * pick a percentage makes them guess at a line they cannot see. So the
 * primary button asks for what their history has already earned, and the
 * slider is there for the person who wants to push — which is the case
 * that goes to the merchant.
 *
 * WHY THE MERCHANT'S LINE IS SHOWN BEFORE THE ASK
 *
 * A shopper who can see the automatic ceiling knows, before pressing
 * anything, whether they are asking for something instant or something that
 * needs a human. Hiding it turns a clear system into a slot machine.
 *
 * NOTHING HERE DECIDES ANYTHING. The server prices the basket, reads the
 * history and answers; this renders that answer. A number typed here is a
 * request, and the component says so.
 */
import { useState } from "react";
import { Handshake, Check, Clock, Info, Loader2 } from "lucide-react";
import { formatMoney } from "../../lib/format";
import { apiPost } from "../../lib/api-client";
import type { BuyerStanding, NegotiationResult } from "../../hooks/use-negotiation";

const TIER_STYLE: Record<string, { cls: string; label: string }> = {
  VIP: { cls: "border-success-border bg-success-subtle text-success-text", label: "VIP" },
  LOYAL: { cls: "border-brand-200 bg-brand-50 text-brand-800", label: "Loyal" },
  RETURNING: { cls: "border-border-strong bg-surface-sunken text-ink-muted", label: "Returning" },
  NEW: { cls: "border-border-strong bg-surface-sunken text-ink-muted", label: "New here" },
};

function money(minor: number, currency: string) {
  return formatMoney({ amountMinor: minor, currency: currency === "USD" ? "USD" : "INR" });
}

export function NegotiationPanel({
  proposalId,
  standing,
  currency,
  onApplied,
}: {
  proposalId: string;
  standing: BuyerStanding | undefined;
  currency: string;
  /** Fired when the price actually moved, so the parent can re-read it. */
  onApplied: (result: NegotiationResult) => void;
}) {
  const [result, setResult] = useState<NegotiationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [askMore, setAskMore] = useState(false);
  const [requestedPct, setRequestedPct] = useState(10);

  async function send(discountBps: number | null) {
    setBusy(true);
    setError(null);
    try {
      const next = await apiPost<NegotiationResult>(`/buyer/purchase-proposals/${proposalId}/negotiate`, {
        discountBps,
      });
      setResult(next);
      if (next.outcome === "AUTO_APPLIED") onApplied(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The server could not answer that request.");
    } finally {
      setBusy(false);
    }
  }

  const tier = standing ? (TIER_STYLE[standing.tier] ?? TIER_STYLE.NEW!) : null;
  const maxPct = standing ? standing.maxNegotiableDiscountBps / 100 : 15;
  const autoPct = standing ? standing.autoApplyCeilingBps / 100 : 5;

  // Already answered — the panel becomes the receipt.
  if (result) {
    const applied = result.outcome === "AUTO_APPLIED";
    const pending = result.outcome === "PROPOSED_TO_MERCHANT";
    const Icon = applied ? Check : pending ? Clock : Info;

    return (
      <div
        className={`rounded-card border px-4 py-3.5 ${
          applied
            ? "border-success-border bg-success-subtle"
            : pending
              ? "border-warning-border bg-warning-subtle"
              : "border-border bg-surface-subtle"
        }`}
      >
        <div className="flex gap-2.5">
          <Icon
            className={`mt-0.5 h-4 w-4 shrink-0 ${
              applied ? "text-success" : pending ? "text-warning" : "text-ink-faint"
            }`}
            aria-hidden
          />
          <div className="min-w-0">
            <p
              className={`text-[13px] font-semibold ${
                applied ? "text-success-text" : pending ? "text-warning-text" : "text-ink"
              }`}
            >
              {applied
                ? `${money(result.appliedDiscountMinor, result.currency)} off, applied`
                : pending
                  ? "Sent to the merchant"
                  : "No discount applied"}
            </p>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">{result.explanation}</p>

            {applied ? (
              <p className="mt-2 text-micro tabular-nums text-ink-muted">
                <span className="line-through decoration-ink-faint">
                  {money(result.originalTotalMinor, result.currency)}
                </span>{" "}
                <span className="font-semibold text-ink">{money(result.finalTotalMinor, result.currency)}</span>
              </p>
            ) : null}

            {/* A refusal that hides the alternative is a worse answer than
                the alternative. */}
            {!applied && result.counterOfferMinor > 0 ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setResult(null);
                  void send(result.counterOfferBps);
                }}
                className="mt-2.5 inline-flex items-center gap-1.5 rounded-pill bg-ink px-3 py-1.5 text-micro font-semibold text-ink-inverse transition hover:bg-ink-muted disabled:opacity-50"
              >
                Take {money(result.counterOfferMinor, result.currency)} off now instead
              </button>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-card border border-border bg-surface-subtle px-4 py-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="inline-flex items-center gap-2 text-[13px] font-semibold text-ink">
          <Handshake className="h-4 w-4 text-brand-600" aria-hidden />
          Ask for a better price
        </p>
        {tier ? (
          <span className={`rounded-pill border px-2 py-0.5 text-micro font-semibold ${tier.cls}`}>{tier.label}</span>
        ) : null}
      </div>

      {standing ? (
        <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">{standing.explanation}</p>
      ) : null}

      {standing ? (
        <p className="mt-1.5 text-micro leading-relaxed text-ink-faint">
          Up to {autoPct}% — and at most {money(standing.maxAutoApplyDiscountMinor, currency)} — is applied
          straight away. More than that, the merchant decides.
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void send(null)}
          className="inline-flex items-center gap-1.5 rounded-pill bg-brand-600 px-4 py-2 text-[13px] font-semibold text-white shadow-card transition hover:bg-brand-700 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
          {standing && standing.earnedDiscountBps > 0
            ? `Apply my ${standing.earnedDiscountBps / 100}%`
            : "See what I qualify for"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setAskMore((v) => !v)}
          className="rounded-pill border border-border-strong bg-surface px-4 py-2 text-[13px] font-medium text-ink transition hover:border-ink-faint disabled:opacity-50"
        >
          Ask for more
        </button>
      </div>

      {askMore ? (
        <div className="mt-3 border-t border-border-hair pt-3">
          <label className="block text-micro font-medium text-ink-muted" htmlFor="discount-ask">
            Ask the merchant for{" "}
            <span className="font-semibold tabular-nums text-ink">{requestedPct}%</span> off
          </label>
          <input
            id="discount-ask"
            type="range"
            min={1}
            max={maxPct}
            step={1}
            value={requestedPct}
            onChange={(e) => setRequestedPct(Number(e.target.value))}
            className="mt-2 w-full accent-brand-600"
          />
          <div className="flex justify-between text-micro tabular-nums text-ink-faint">
            <span>1%</span>
            <span>{autoPct}% instant</span>
            <span>{maxPct}% max</span>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => void send(Math.round(requestedPct * 100))}
            className="mt-3 inline-flex items-center gap-1.5 rounded-pill bg-ink px-4 py-2 text-[13px] font-semibold text-ink-inverse transition hover:bg-ink-muted disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
            Request {requestedPct}% off
          </button>
          <p className="mt-2 text-micro leading-relaxed text-ink-faint">
            Above {autoPct}% this goes to the merchant rather than applying. You can still take what you have
            earned right away instead of waiting.
          </p>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="mt-3 rounded-card border border-danger-border bg-danger-subtle px-3 py-2 text-micro text-danger-text">
          {error}
        </p>
      ) : null}
    </div>
  );
}
