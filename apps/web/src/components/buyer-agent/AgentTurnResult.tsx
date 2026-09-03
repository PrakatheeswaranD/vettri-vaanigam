/**
 * What the agent produced when the buyer asked it to DO something.
 *
 * Three turn outcomes that did not exist before Part 9, because the
 * conversation could not previously do anything except search: a factual
 * side-by-side, the merchant-authorized offers on what was recommended,
 * and a priced purchase proposal.
 *
 * WHY THIS IS NOT THE OTHER COMPARISON TABLE
 *
 * `ProductComparisonTable` renders on a SEARCH turn and compares match
 * quality — why each result was recommended, with reason codes and match
 * percentages. This renders on a COMPARE turn and compares catalogue
 * FACTS: price, stock, returns, the attributes the products record.
 * Different columns answering different questions, which is why both
 * exist rather than one pretending to do both jobs.
 *
 * EVERY VALUE HERE CAME FROM THE SERVER
 *
 * Nothing is computed in this file — not a discount, not a total, not
 * which row differs. `differs` is derived server-side from the values
 * themselves, and a client that recomputed it could disagree with the
 * table it is rendering.
 */
import { AlertTriangle, BadgePercent, CheckCircle2, CreditCard, ShieldCheck } from "lucide-react";
import type { BuyerAgentResponseDTO } from "@razorgrowth/contracts";
import { formatMoney } from "../../lib/format";
import { Card, CardBody, CardHeader, CardTitle } from "../ui/Card";

function Money({ minor, currency }: { minor: number; currency: string }) {
  return <>{formatMoney({ amountMinor: minor, currency: currency as "INR" | "USD" })}</>;
}

/* ── COMPARISON ────────────────────────────────────────────────────── */

function ComparisonTable({ comparison }: { comparison: NonNullable<BuyerAgentResponseDTO["comparison"]> }) {
  const differing = comparison.rows.filter((row) => row.differs);
  const offerFor = (index: number) => comparison.offers.find((offer) => offer.productIndex === index) ?? null;

  return (
    <Card className="mt-3">
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>Side by side</CardTitle>
        <span className="text-xs text-ink-muted">
          {differing.length} of {comparison.rows.length} fields actually differ
        </span>
      </CardHeader>
      <CardBody>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-left text-xs">
            <tbody className="divide-y divide-border-hair">
              {comparison.rows.map((row) => (
                <tr key={row.label} className={row.differs ? "" : "text-ink-muted"}>
                  <th scope="row" className="py-2 pr-4 align-top font-medium capitalize text-ink-faint">
                    {row.label}
                    {row.differs ? <span className="ml-1.5 text-brand-600" aria-label="differs">•</span> : null}
                  </th>
                  {row.values.map((value, index) => (
                    <td key={index} className="py-2 pr-4 align-top tabular-nums">
                      {/* A field a product does not record shows as "not
                          recorded", never as a plausible default — "no
                          rating" and "rated 0" are opposite claims. */}
                      {value ?? <span className="italic text-ink-faint">not recorded</span>}
                      {/* The one ranked row. It says which is CHEAPER —
                          a fact with an order to it — and never which is
                          better, which the catalogue cannot answer. */}
                      {row.lowestIndex === index ? (
                        <span className="ml-1.5 rounded-full bg-success-subtle px-1.5 py-0.5 text-micro font-medium text-success-text">
                          lowest
                        </span>
                      ) : null}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* FIT — how each product measures against what the BUYER asked
            for, not against the other product. Computed from the
            conversation's own normalized intent, so every line restates a
            requirement they really stated. */}
        {comparison.fit.some((f) => f.meets.length > 0 || f.misses.length > 0) ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {comparison.fit.map((fit, index) => {
              const offer = offerFor(index);
              return (
                <div key={index} className="rounded-md border border-border-hair px-3 py-2">
                  <p className="text-xs font-semibold text-ink">
                    {comparison.productNames[index] ?? `Product ${index + 1}`}
                  </p>

                  {fit.meets.length > 0 ? (
                    <ul className="mt-1.5 space-y-0.5">
                      {fit.meets.map((item) => (
                        <li key={item} className="flex items-start gap-1.5 text-xs text-success-text">
                          <CheckCircle2 size={12} className="mt-0.5 shrink-0" aria-hidden />
                          {item}
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  {/* Misses are shown, never omitted. A near-match
                      presented as a match is how a buyer ends up with the
                      wrong thing. */}
                  {fit.misses.length > 0 ? (
                    <ul className="mt-1 space-y-0.5">
                      {fit.misses.map((item) => (
                        <li key={item} className="flex items-start gap-1.5 text-xs text-warning-text">
                          <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden />
                          {item}
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  {offer ? (
                    <p className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-success-text">
                      <BadgePercent size={12} className="shrink-0" aria-hidden />
                      {offer.percentageBps !== null
                        ? `${(offer.percentageBps / 100).toFixed(offer.percentageBps % 100 === 0 ? 0 : 1)}% off`
                        : "Offer available"}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}

        <p className="mt-3 text-xs leading-relaxed text-ink-faint">
          Every value is a published catalogue field, and “lowest” marks the cheaper price — the only column where one
          option is factually ahead. There is deliberately no “which is better” row: the agent already made its
          recommendation, and a second opinion dressed as a table would hide that it is an opinion.
        </p>
      </CardBody>
    </Card>
  );
}

/* ── OFFERS ────────────────────────────────────────────────────────── */

function Offers({ offers }: { offers: BuyerAgentResponseDTO["offers"] }) {
  if (offers.length === 0) return null;
  return (
    <Card className="mt-3">
      <CardHeader>
        <CardTitle>
          <span className="inline-flex items-center gap-1.5">
            <BadgePercent size={14} className="text-success-text" aria-hidden />
            Offers the merchant has authorized
          </span>
        </CardTitle>
      </CardHeader>
      <CardBody className="space-y-3">
        {offers.map((offer) => (
          <div key={offer.proposalId} className="rounded-md border border-border-hair px-3 py-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-sm font-semibold text-ink">
                {offer.percentageBps !== null ? `${(offer.percentageBps / 100).toFixed(offer.percentageBps % 100 === 0 ? 0 : 1)}% off` : "Offer"}
              </span>
              {offer.discountMinor !== null && offer.currency ? (
                <span className="text-sm tabular-nums text-success-text">
                  &minus;<Money minor={offer.discountMinor} currency={offer.currency} />
                </span>
              ) : null}
            </div>
            {offer.baseAmountMinor !== null && offer.currency ? (
              <p className="mt-0.5 text-xs tabular-nums text-ink-muted">
                on <Money minor={offer.baseAmountMinor} currency={offer.currency} />
              </p>
            ) : null}
            {/* Provenance, not marketing. This is not "a deal we found" —
                it is one this merchant's own policy engine authorized. */}
            <p className="mt-1 text-xs leading-snug text-ink-faint">{offer.provenance}</p>
          </div>
        ))}
      </CardBody>
    </Card>
  );
}

/* ── PURCHASE ──────────────────────────────────────────────────────── */

function Purchase({ purchase }: { purchase: NonNullable<BuyerAgentResponseDTO["purchase"]> }) {
  const declined = purchase.outcome === "DECLINE";
  return (
    <Card className="mt-3">
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>
          <span className="inline-flex items-center gap-1.5">
            {declined ? (
              <AlertTriangle size={14} className="text-danger-text" aria-hidden />
            ) : (
              <ShieldCheck size={14} className="text-brand-600" aria-hidden />
            )}
            {declined ? "Your spending policy declined this" : "Priced and proposed"}
          </span>
        </CardTitle>
        <span className="text-sm font-semibold tabular-nums text-ink">
          <Money minor={purchase.amountMinor} currency={purchase.currency} />
        </span>
      </CardHeader>
      <CardBody className="space-y-3">
        {/* WHAT, not just how much. A buyer cannot check a lone total. */}
        <div>
          <p className="text-sm font-medium text-ink">{purchase.productName}</p>
          <p className="text-xs text-ink-muted">
            {purchase.variantTitle} · quantity {purchase.quantity}
          </p>
        </div>

        {/* The arithmetic, shown as arithmetic. Every figure is the
            server's own integer minor-unit value — nothing is recomputed
            in this file, so what is displayed is what will be charged. */}
        <dl className="space-y-1 border-t border-border-hair pt-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-ink-muted">
              {purchase.quantity} × <Money minor={purchase.unitPriceMinor} currency={purchase.currency} />
            </dt>
            <dd className="tabular-nums text-ink">
              <Money minor={purchase.listTotalMinor} currency={purchase.currency} />
            </dd>
          </div>

          {purchase.discountMinor > 0 ? (
            <div className="flex justify-between gap-4">
              <dt className="inline-flex items-center gap-1.5 text-success-text">
                <BadgePercent size={13} aria-hidden />
                {purchase.appliedOffer?.percentageBps
                  ? `Merchant offer, ${(purchase.appliedOffer.percentageBps / 100).toFixed(
                      purchase.appliedOffer.percentageBps % 100 === 0 ? 0 : 1,
                    )}% off`
                  : "Merchant offer"}
              </dt>
              <dd className="tabular-nums text-success-text">
                &minus;<Money minor={purchase.discountMinor} currency={purchase.currency} />
              </dd>
            </div>
          ) : null}

          <div className="flex justify-between gap-4 border-t border-border-hair pt-1.5 font-semibold">
            <dt className="text-ink">Total</dt>
            <dd className="tabular-nums text-ink">
              <Money minor={purchase.amountMinor} currency={purchase.currency} />
            </dd>
          </div>
        </dl>

        {/* Provenance for the discount, if there is one. Not marketing —
            the merchant's own authorization. */}
        {purchase.appliedOffer ? (
          <p className="text-xs leading-snug text-ink-faint">{purchase.appliedOffer.provenance}</p>
        ) : null}

        {/* The policy's own words, carried verbatim. A softened decline is
            a decline the buyer might not notice. */}
        <p className="text-sm leading-relaxed text-ink">{purchase.explanation}</p>

        {!declined ? (
          <p className="inline-flex items-center gap-1.5 rounded-md bg-surface-muted px-2.5 py-1.5 text-xs text-ink-muted">
            <CheckCircle2 size={13} className="shrink-0 text-brand-600" aria-hidden />
            <span>
              <strong className="font-semibold text-ink">Nothing has been charged.</strong> The agent priced this from
              the catalogue and your own policy decided; money moves only when you authorize it.
            </span>
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}

/* ── CHECKOUT ──────────────────────────────────────────────────────── */

/**
 * Where the payment actually is, as the server reports it.
 *
 * NOTHING HERE IS INFERRED. `paid` is set by the server only after it has
 * verified a provider-confirmed capture; this component never decides that
 * a purchase completed, because a browser cannot observe a charge. A UI
 * that concluded otherwise would show a buyer an order that may not exist.
 */
function Checkout({ checkout }: { checkout: NonNullable<BuyerAgentResponseDTO["checkout"]> }) {
  return (
    <Card className="mt-3">
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>
          <span className="inline-flex items-center gap-1.5">
            <CreditCard size={14} className="text-brand-600" aria-hidden />
            {checkout.paid ? "Payment confirmed" : "Ready for payment"}
          </span>
        </CardTitle>
        <span className="text-sm font-semibold tabular-nums text-ink">
          <Money minor={checkout.amountMinor} currency={checkout.currency} />
        </span>
      </CardHeader>
      <CardBody className="space-y-2">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <dt className="text-ink-faint">Payment state</dt>
          <dd className="font-medium tabular-nums text-ink">{checkout.state}</dd>
          {checkout.providerOrderId ? (
            <>
              <dt className="text-ink-faint">Provider order</dt>
              <dd className="truncate font-mono text-ink-muted">{checkout.providerOrderId}</dd>
            </>
          ) : null}
        </dl>

        {checkout.paid ? (
          <p className="inline-flex items-center gap-1.5 rounded-md bg-success-subtle px-2.5 py-1.5 text-xs text-success-text">
            <CheckCircle2 size={13} className="shrink-0" aria-hidden />
            <span>The provider confirmed this capture and the server verified it.</span>
          </p>
        ) : (
          <p className="inline-flex items-center gap-1.5 rounded-md bg-surface-muted px-2.5 py-1.5 text-xs text-ink-muted">
            <ShieldCheck size={13} className="shrink-0 text-brand-600" aria-hidden />
            <span>
              <strong className="font-semibold text-ink">Still not charged.</strong> The payment order exists; completing
              payment is a separate step, and the result comes back from the provider rather than from this page.
            </span>
          </p>
        )}
      </CardBody>
    </Card>
  );
}

/* ── The turn ──────────────────────────────────────────────────────── */

export function AgentTurnResult({ response }: { response: BuyerAgentResponseDTO }) {
  // Offers ride along on any turn that produced them, because a buyer
  // comparing or buying wants to know about a discount just as much as
  // one searching does.
  return (
    <>
      {response.comparison ? <ComparisonTable comparison={response.comparison} /> : null}
      {response.purchase ? <Purchase purchase={response.purchase} /> : null}
      {response.checkout ? <Checkout checkout={response.checkout} /> : null}
      <Offers offers={response.offers} />
    </>
  );
}
