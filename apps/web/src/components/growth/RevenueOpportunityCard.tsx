/**
 * One revenue opportunity, told end to end.
 *
 * The card's job is to make an engine output arguable. A merchant should
 * be able to read it and either act or push back with a specific
 * objection — "that customer cancelled", "we do not want to chase that" —
 * rather than either trusting or ignoring a number. So the whole chain is
 * on the card, in order:
 *
 *   why detected -> proposed action -> expected effect -> evidence ->
 *   risk -> policy -> what happens next
 *
 * THE PART THAT MATTERS MOST
 *
 * The money block never renders a bare figure. Each amount carries its
 * classification, and when the engine withheld an estimate the card says
 * so in words, in the place where a forecast would otherwise sit. A blank
 * space there would read as zero; the absence has to be explicit, because
 * "we cannot responsibly tell you this yet" is a real answer and the one
 * thing a merchant must not mistake for a small number.
 */
import { useState } from "react";
import { clsx } from "clsx";
import {
  AlertTriangle,
  ChevronDown,
  CircleSlash,
  FileSearch,
  Gauge,
  ShieldCheck,
  ShieldQuestion,
  Wrench,
} from "lucide-react";
import type { RevenueOpportunityDTO } from "@razorgrowth/contracts";
import { Card, CardBody } from "../ui/Card";
import { formatMoney } from "../../lib/format";

const TYPE_LABEL: Record<RevenueOpportunityDTO["type"], string> = {
  FAILED_PAYMENT_RECOVERY: "Payment recovery",
  UNVERIFIED_PAYMENT: "Unverified payment",
  ABANDONED_CHECKOUT_RECOVERY: "Checkout recovery",
  REPEAT_PURCHASE: "Repeat purchase",
  CUSTOMER_REACTIVATION: "Reactivation",
  CROSS_SELL: "Cross-sell",
  UPSELL: "Upsell",
  UNDERPERFORMING_PRODUCT: "Conversion",
  AI_BUYER_READINESS: "AI readiness",
  PRODUCT_DISCOVERY: "Discoverability",
  ELIGIBLE_OFFER: "Eligible offer",
};

const EFFORT_LABEL: Record<RevenueOpportunityDTO["effort"], string> = {
  AGENT_AUTOMATIC: "Agent handles it",
  ONE_APPROVAL: "One approval",
  MERCHANT_WORK: "Merchant work",
};

const POLICY_PRESENTATION: Record<
  RevenueOpportunityDTO["policy"]["outcome"],
  { label: string; className: string; icon: typeof ShieldCheck }
> = {
  ELIGIBLE: { label: "Within your bounds", className: "bg-success-subtle text-success-text", icon: ShieldCheck },
  REQUIRES_APPROVAL: { label: "Needs your approval", className: "bg-warning-subtle text-warning-text", icon: ShieldQuestion },
  BLOCKED: { label: "Blocked by your policy", className: "bg-surface-sunken text-ink-muted", icon: CircleSlash },
};

/** Priority bands. Named rather than numeric on the card face: "68" means
 * nothing to a merchant, and the number is still available in the score
 * breakdown for anyone who wants to check the arithmetic. */
function priorityBand(priority: number): { label: string; className: string } {
  if (priority >= 65) return { label: "Act first", className: "bg-danger-subtle text-danger" };
  if (priority >= 45) return { label: "Worth doing", className: "bg-warning-subtle text-warning-text" };
  return { label: "When there is time", className: "bg-surface-sunken text-ink-muted" };
}

function MoneyLine({
  label,
  amount,
  currency,
  classification,
  hint,
}: {
  label: string;
  amount: number;
  currency: "INR" | "USD";
  classification: "OBSERVED" | "ESTIMATED" | "OPPORTUNITY";
  hint: string;
}) {
  const tone =
    classification === "OBSERVED"
      ? "text-ink"
      : classification === "ESTIMATED"
        ? "text-info-text"
        : "text-ink-muted";
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">{label}</p>
      <p className={clsx("mt-0.5 text-lg font-bold tabular-nums", tone)}>{formatMoney({ amountMinor: amount, currency })}</p>
      <p className="mt-0.5 text-[11px] leading-snug text-ink-faint">{hint}</p>
    </div>
  );
}

export function RevenueOpportunityCard({
  opportunity,
  rank,
  action,
}: {
  opportunity: RevenueOpportunityDTO;
  rank: number;
  /** The real CTA for this opportunity, supplied by the page that knows
   * which route can execute it. Absent means there is no wired action
   * yet, and the card says so rather than rendering a dead button. */
  action?: React.ReactNode;
}) {
  const [showWorking, setShowWorking] = useState(false);
  const { expectedEffect: effect, score, policy } = opportunity;
  const band = priorityBand(score.priority);
  const policyPresentation = POLICY_PRESENTATION[policy.outcome];
  const PolicyIcon = policyPresentation.icon;

  return (
    <Card className={clsx(policy.outcome === "BLOCKED" && "opacity-75")}>
      <CardBody className="space-y-4">
        {/* Header: what this is, and how hard it is to act on. */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span
              aria-hidden
              className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-xs font-bold tabular-nums text-ink-muted"
            >
              {rank}
            </span>
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-ink">{opportunity.title}</h3>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <span className="rounded-pill bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700">
                  {TYPE_LABEL[opportunity.type]}
                </span>
                <span className={clsx("rounded-pill px-2 py-0.5 text-[11px] font-semibold", band.className)}>{band.label}</span>
                <span className="inline-flex items-center gap-1 rounded-pill bg-surface-sunken px-2 py-0.5 text-[11px] font-medium text-ink-muted">
                  <Wrench size={10} aria-hidden />
                  {EFFORT_LABEL[opportunity.effort]}
                </span>
                {opportunity.customersAffected > 0 ? (
                  <span className="rounded-pill bg-surface-sunken px-2 py-0.5 text-[11px] font-medium text-ink-muted">
                    {opportunity.customersAffected} customer{opportunity.customersAffected === 1 ? "" : "s"}
                  </span>
                ) : null}
              </div>
            </div>
          </div>
          <span
            className={clsx(
              "inline-flex shrink-0 items-center gap-1 rounded-pill px-2.5 py-1 text-[11px] font-medium",
              policyPresentation.className,
            )}
          >
            <PolicyIcon size={12} aria-hidden />
            {policyPresentation.label}
          </span>
        </div>

        {/* WHY DETECTED */}
        <div className="rounded-card border border-border-hair bg-surface-subtle p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Why this was detected</p>
          <p className="mt-1 text-sm leading-relaxed text-ink">{opportunity.whyDetected}</p>
        </div>

        {/* EXPECTED EFFECT — three classifications, never merged. */}
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Expected effect</p>
          <div className="mt-2 grid gap-4 sm:grid-cols-3">
            {effect.atRiskValue ? (
              <MoneyLine
                label="At risk now"
                amount={effect.atRiskValue.amountMinor}
                currency={effect.atRiskValue.currency}
                classification="OBSERVED"
                hint="Observed — the sum of real rows, not a forecast."
              />
            ) : null}
            {effect.addressableValue ? (
              <MoneyLine
                label="Ceiling if all succeed"
                amount={effect.addressableValue.amountMinor}
                currency={effect.addressableValue.currency}
                classification="OPPORTUNITY"
                hint="Potential opportunity — an upper bound, not an expectation."
              />
            ) : null}

            {/* The load-bearing case: an absent estimate is stated, never
                left as an empty cell that would read as zero. */}
            {effect.expectedIncrementalValue ? (
              <MoneyLine
                label="Expected incremental"
                amount={effect.expectedIncrementalValue.amountMinor}
                currency={effect.expectedIncrementalValue.currency}
                classification="ESTIMATED"
                hint={`Estimated from ${effect.sampleSize} of your own observations.`}
              />
            ) : (
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">Expected incremental</p>
                <p className="mt-0.5 inline-flex items-center gap-1.5 text-sm font-semibold text-warning-text">
                  <AlertTriangle size={13} aria-hidden />
                  Not estimated
                </p>
                <p className="mt-0.5 text-[11px] leading-snug text-ink-faint">
                  Insufficient evidence. We will not invent a figure.
                </p>
              </div>
            )}
          </div>

          <p className="mt-3 border-l-2 border-border pl-3 text-xs leading-relaxed text-ink-muted">
            <span className="font-medium text-ink">How this was worked out: </span>
            {effect.method}
          </p>
        </div>

        {/* PROPOSED ACTION + the real CTA. */}
        <div className="rounded-card border border-brand-100 bg-brand-50/50 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-700">Proposed action</p>
          <p className="mt-1 text-sm font-medium text-ink">{opportunity.actionLabel}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {action ?? (
              <p className="text-xs text-ink-muted">
                This one is merchant work — there is no button that can do it for you. Open the linked records and make the
                change.
              </p>
            )}
          </div>
        </div>

        {/* RISK — always visible, never behind a disclosure. */}
        <div className="flex gap-2 text-xs leading-relaxed text-ink-muted">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warning-text" aria-hidden />
          <p>
            <span className="font-medium text-ink">Risk: </span>
            {opportunity.risk}
          </p>
        </div>

        {/* EVIDENCE + SCORE — collapsed by default. The claim is above;
            this is for the merchant who wants to check it. */}
        <div className="border-t border-border-hair pt-3">
          <button
            type="button"
            onClick={() => setShowWorking((open) => !open)}
            aria-expanded={showWorking}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-600 hover:underline"
          >
            <FileSearch size={13} aria-hidden />
            {showWorking ? "Hide" : "Show"} the evidence and how this was ranked
            <ChevronDown size={13} className={clsx("transition-transform", showWorking && "rotate-180")} aria-hidden />
          </button>

          {showWorking ? (
            <div className="mt-3 grid gap-4 lg:grid-cols-2">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Evidence</p>
                <dl className="mt-2 space-y-2">
                  {opportunity.evidence.map((item) => (
                    <div key={`${item.label}-${item.value}`} className="text-xs">
                      <div className="flex justify-between gap-3">
                        <dt className="text-ink-muted">{item.label}</dt>
                        <dd className="shrink-0 font-semibold tabular-nums text-ink">
                          {item.money ? formatMoney(item.money) : item.value}
                        </dd>
                      </div>
                      <p className="mt-0.5 text-[11px] text-ink-faint">Source: {item.source}</p>
                    </div>
                  ))}
                </dl>
              </div>

              <div>
                <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                  <Gauge size={12} aria-hidden />
                  Priority {score.priority}/100
                </p>
                <p className="mt-1 text-[11px] leading-snug text-ink-faint">
                  A fixed weighted sum of the six components below. No learned weights, no randomness — the same facts always
                  produce the same ranking.
                </p>
                <ul className="mt-2 space-y-1.5">
                  {(
                    [
                      ["Value vs your average order", score.value],
                      ["Confidence the opportunity is real", score.confidence],
                      ["Urgency", score.urgency],
                      ["Customer reach", score.customerImpact],
                      ["Ease of acting", score.effort],
                      ["Policy headroom", score.policy],
                    ] as const
                  ).map(([label, value]) => (
                    <li key={label} className="flex items-center gap-2 text-[11px]">
                      <span className="w-44 shrink-0 text-ink-muted">{label}</span>
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-sunken">
                        <span className="block h-full rounded-full bg-brand-500" style={{ width: `${value}%` }} />
                      </span>
                      <span className="w-7 shrink-0 text-right font-semibold tabular-nums text-ink">{value}</span>
                    </li>
                  ))}
                </ul>
                {policy.reasons.length > 0 ? (
                  <p className="mt-2 text-[11px] text-ink-faint">Policy reason: {policy.reasons.join(", ")}</p>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </CardBody>
    </Card>
  );
}
