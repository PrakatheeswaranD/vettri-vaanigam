/**
 * The answer to "why not just use filters?"
 *
 * A human with Flipkart's filter sidebar does not need natural language —
 * filters are faster and more precise, and pretending otherwise would be
 * dishonest. Language is not what an AI buyer is for.
 *
 * The difference is that a filter UI serves someone who can SEE a screen.
 * An autonomous agent has no screen: it reads structured data and decides
 * without a human present. So the merchant's real question is not "can a
 * shopper find this?" but **"can a machine buy this without asking anyone
 * anything?"** — and that is what this panel answers.
 *
 * The gap it surfaces is the whole point: a product a human would happily
 * buy from a filtered list can be completely untransactable by an agent
 * because it has no recorded price, no recorded stock, or no structured
 * attributes to match on. A filter sidebar will never tell a merchant
 * that. This does, per matched product, with the specific blocker.
 */
import { CheckCircle2, AlertTriangle, Bot } from "lucide-react";
import type { RecommendedProductDTO } from "@razorgrowth/contracts";

interface Blocker {
  productName: string;
  reasons: string[];
}

/**
 * What an agent needs before it can transact, checked against the
 * authoritative catalogue data — never against the prose description.
 */
export function blockersFor(rec: RecommendedProductDTO): string[] {
  const variant = rec.product.variants.find((v) => v.variantId === rec.variantId) ?? rec.product.variants[0];
  const reasons: string[] = [];

  if (!variant) {
    reasons.push("no purchasable variant");
    return reasons;
  }
  if (!variant.price || variant.price.amountMinor <= 0) reasons.push("no recorded price");
  // UNKNOWN is a real state, not a synonym for out of stock: nobody ever
  // recorded the inventory. An agent cannot responsibly commit to it.
  if (variant.availability.state === "UNKNOWN") reasons.push("stock never recorded");
  if (variant.availability.state === "OUT_OF_STOCK" || variant.availability.state === "UNAVAILABLE") {
    reasons.push("not purchasable right now");
  }
  if (Object.keys(variant.attributes ?? {}).length === 0) reasons.push("no structured attributes to match on");

  return reasons;
}

export function AgentBuyabilityVerdict({ recommendations }: { recommendations: RecommendedProductDTO[] }) {
  if (recommendations.length === 0) return null;

  const blockers: Blocker[] = [];
  let buyable = 0;

  for (const rec of recommendations) {
    const reasons = blockersFor(rec);
    if (reasons.length === 0) buyable++;
    else blockers.push({ productName: rec.product.identity.name, reasons });
  }

  const total = recommendations.length;
  const allClear = blockers.length === 0;

  return (
    <div className="rounded-card border border-border bg-surface-subtle p-3">
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-faint">
        <Bot size={12} />
        Agent&rsquo;s-eye view
      </p>

      <p className="mt-2 text-sm text-ink">
        {allClear ? (
          <>
            All {total} matched {total === 1 ? "product is" : "products are"} transactable by an autonomous agent — price,
            availability and attributes are all recorded.
          </>
        ) : (
          <>
            <span className="font-semibold">
              {buyable} of {total}
            </span>{" "}
            matched {total === 1 ? "product is" : "products are"} transactable by an autonomous agent. A shopper could
            find the {blockers.length === 1 ? "other one" : `other ${blockers.length}`} with filters and buy{" "}
            {blockers.length === 1 ? "it" : "them"} anyway — an agent cannot.
          </>
        )}
      </p>

      {blockers.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {blockers.map((b) => (
            <li key={b.productName} className="flex items-start gap-1.5 text-xs text-warning-text">
              <AlertTriangle size={11} className="mt-0.5 shrink-0" />
              <span>
                <span className="font-medium">{b.productName}</span> — {b.reasons.join("; ")}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-success-text">
          <CheckCircle2 size={11} />
          Nothing here needs a human to interpret it.
        </p>
      )}

      <p className="mt-2 text-[11px] text-ink-faint">
        This is what a filter sidebar cannot tell you: filters serve a shopper who can read the screen, but an agent
        buying on someone&rsquo;s behalf has to decide from recorded data alone.
      </p>
    </div>
  );
}
