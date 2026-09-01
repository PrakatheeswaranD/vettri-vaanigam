/**
 * Discount requests that came to the merchant.
 *
 * WHY THIS LIST IS USUALLY EMPTY, AND THAT IS THE POINT
 *
 * Everything a customer's own record already entitled them to was applied
 * without appearing here. What reaches this queue is only what the
 * automation deliberately declined to decide: past the merchant's
 * percentage, past the rupee cap, or on a basket whose cost is unknown so
 * no margin could be checked.
 *
 * A queue full of routine loyalty discounts would be a queue nobody reads,
 * and a merchant who stops reading their approval queue is a merchant with
 * no guardrail at all.
 *
 * WHY EVERY ROW LEADS WITH RUPEES
 *
 * "12% off" is not a decision anyone can make. "₹4,320 off a ₹36,000
 * order, leaving ₹31,680" is. The percentage is shown too, but it is not
 * what the eye lands on.
 */
import { Handshake, Check, X, Loader2 } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "../ui/Card";
import { usePendingNegotiations, useDecideNegotiation } from "../../hooks/use-negotiation";
import { formatMoney } from "../../lib/format";

const TIER_STYLE: Record<string, string> = {
  VIP: "border-success-border bg-success-subtle text-success-text",
  LOYAL: "border-brand-200 bg-brand-50 text-brand-800",
  RETURNING: "border-border-strong bg-surface-sunken text-ink-muted",
  NEW: "border-border-strong bg-surface-sunken text-ink-muted",
};

function money(minor: number, currency: string | null) {
  return formatMoney({ amountMinor: minor, currency: currency === "USD" ? "USD" : "INR" });
}

export function NegotiationQueue() {
  const pending = usePendingNegotiations();
  const decide = useDecideNegotiation();
  const rows = pending.data?.items ?? [];

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Discount requests for you</CardTitle>
            <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-ink-muted">
              Only what the automation would not decide on its own — past your percentage, past your rupee cap,
              or on a basket with no recorded cost to check a margin against. Everything a customer had already
              earned was applied without reaching you.
            </p>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-pill border border-border bg-surface-subtle px-2.5 py-1 text-micro font-medium text-ink-muted">
            <Handshake className="h-3.5 w-3.5" aria-hidden />
            {rows.length} waiting
          </span>
        </div>
      </CardHeader>

      {pending.isLoading ? (
        <CardBody>
          <p className="text-sm text-ink-muted">Loading requests…</p>
        </CardBody>
      ) : rows.length === 0 ? (
        <CardBody>
          <p className="text-sm text-ink-muted">
            Nothing is waiting on you. Customers are being given what their own order history has earned, and
            nothing beyond it.
          </p>
        </CardBody>
      ) : (
        <ul className="divide-y divide-border-hair">
          {rows.map((row) => (
            <li key={row.id} className="px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Rupees first: a percentage is not what leaves an account. */}
                    <span className="text-base font-semibold tabular-nums text-ink">
                      {money(row.requestedDiscountMinor, row.currency)} off
                    </span>
                    <span className="text-micro tabular-nums text-ink-faint">
                      ({row.requestedDiscountBps / 100}%)
                    </span>
                    {row.customerTier ? (
                      <span
                        className={`rounded-pill border px-2 py-0.5 text-micro font-semibold ${
                          TIER_STYLE[row.customerTier] ?? TIER_STYLE.NEW!
                        }`}
                      >
                        {row.customerTier.charAt(0) + row.customerTier.slice(1).toLowerCase()}
                      </span>
                    ) : null}
                  </div>

                  <p className="mt-1.5 text-[13px] tabular-nums text-ink-muted">
                    <span className="line-through decoration-ink-faint">
                      {money(row.originalTotalMinor, row.currency)}
                    </span>{" "}
                    → <span className="font-semibold text-ink">{money(row.wouldBecomeMinor, row.currency)}</span>
                  </p>

                  {row.explanation ? (
                    <p className="mt-1.5 max-w-2xl text-micro leading-relaxed text-ink-faint">{row.explanation}</p>
                  ) : null}
                </div>

                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    disabled={decide.isPending}
                    onClick={() => decide.mutate({ id: row.id, approve: true })}
                    className="inline-flex items-center gap-1.5 rounded-pill bg-ink px-3.5 py-1.5 text-micro font-semibold text-ink-inverse transition hover:bg-ink-muted disabled:opacity-50"
                  >
                    {decide.isPending ? (
                      <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                    ) : (
                      <Check className="h-3 w-3" aria-hidden />
                    )}
                    Approve
                  </button>
                  <button
                    type="button"
                    disabled={decide.isPending}
                    onClick={() => decide.mutate({ id: row.id, approve: false })}
                    className="inline-flex items-center gap-1.5 rounded-pill border border-border-strong bg-surface px-3.5 py-1.5 text-micro font-semibold text-ink transition hover:border-ink-faint disabled:opacity-50"
                  >
                    <X className="h-3 w-3" aria-hidden />
                    Keep price
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {decide.isError ? (
        <CardBody className="pt-0">
          <p className="rounded-card border border-danger-border bg-danger-subtle px-3 py-2 text-[13px] text-danger-text">
            That decision could not be recorded. Nothing was changed.
          </p>
        </CardBody>
      ) : null}
    </Card>
  );
}
