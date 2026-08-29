/**
 * PART 03 §76-§79 — every displayed fact (price, availability, variant)
 * comes from `recommendation.product`, the catalog-hydrated authoritative
 * data, never from AI-generated prose (§119). Near matches are always
 * visually distinct from exact matches (§78) — never disguised.
 */
import { Link } from "react-router-dom";
import { CheckCircle2, AlertTriangle } from "lucide-react";
import type { RecommendedProductDTO } from "@razorgrowth/contracts";
import { Card, CardBody } from "../ui/Card";
import { ProductReadinessBadge } from "../readiness/ProductReadinessBadge";
import { formatMoney } from "../../lib/format";
import { REASON_CODE_TEXT } from "./reason-code-text";

/** Read-only on purpose. There is no purchase affordance here: a buyer
 * agent buys through the gateway, not by clicking a merchant console. */
export function RecommendationCard({ recommendation }: { recommendation: RecommendedProductDTO }) {
  const variant = recommendation.product.variants.find((v) => v.variantId === recommendation.variantId);
  const isNearMatch = recommendation.matchType === "NEAR_MATCH";
  const budgetViolation = recommendation.violations.find((v) => v.type === "BUDGET_MAX");

  return (
    <Card className={isNearMatch ? "border-warning/40" : undefined}>
      <CardBody className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <span className="text-xs font-medium text-brand-600">{recommendation.product.identity.category}</span>
            <p className="text-sm font-semibold text-ink">{recommendation.product.identity.name}</p>
          </div>
          <span
            className={
              isNearMatch
                ? "inline-flex items-center gap-1 rounded-full bg-warning-subtle px-2 py-0.5 text-[11px] font-medium text-warning-text"
                : "inline-flex items-center gap-1 rounded-full bg-success-subtle px-2 py-0.5 text-[11px] font-medium text-success-text"
            }
          >
            {isNearMatch ? <AlertTriangle size={11} /> : <CheckCircle2 size={11} />}
            {isNearMatch ? "Near match" : "Exact match"}
          </span>
        </div>

        {variant ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="font-semibold text-ink">{formatMoney(variant.price)}</span>
            <span className={variant.availability.state === "IN_STOCK" || variant.availability.state === "LOW_STOCK" ? "text-xs text-success-text" : "text-xs text-ink-muted"}>
              {variant.availability.state === "UNKNOWN" ? "Availability unknown" : variant.availability.state.replace(/_/g, " ").toLowerCase()}
            </span>
            {Object.entries(variant.attributes).map(([k, v]) => (
              <span key={k} className="text-xs text-ink-faint">
                {k}: {v}
              </span>
            ))}
          </div>
        ) : null}

        {isNearMatch && budgetViolation ? (
          <p className="rounded-md bg-warning-subtle px-3 py-2 text-xs text-warning-text">
            {formatMoney({ amountMinor: budgetViolation.differenceMinor ?? 0, currency: variant?.price.currency ?? "INR" })} above your stated budget.
          </p>
        ) : null}

        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-faint">Why this matches</p>
          <ul className="space-y-1">
            {recommendation.reasonCodes.map((code) => (
              <li key={code} className="flex items-start gap-1.5 text-xs text-ink-muted">
                <CheckCircle2 size={12} className="mt-0.5 shrink-0 text-success" />
                {REASON_CODE_TEXT[code]}
              </li>
            ))}
          </ul>
        </div>

        <div className="flex items-center justify-between border-t border-border pt-3">
          <ProductReadinessBadge state={recommendation.product.readiness.state} />
          <Link to={`/catalog/${recommendation.productId}`} className="text-xs font-medium text-brand-600 hover:underline">
            View details
          </Link>
        </div>

      </CardBody>
    </Card>
  );
}
