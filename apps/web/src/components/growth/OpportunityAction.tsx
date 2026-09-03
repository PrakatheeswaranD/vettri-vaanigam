/**
 * The real next step for one detected opportunity.
 *
 * WHY THIS IS ONE COMPONENT AND NOT TWO COPIES
 *
 * Both the Growth page and the Overview show opportunity cards, and both
 * have to answer "what do I actually do about this". Written twice, the
 * two would drift — and the failure mode of drift here is a card on one
 * page offering an action the other page has already retired, which is
 * how a merchant ends up clicking something that no longer does anything.
 *
 * TWO KINDS OF ACTION, DELIBERATELY
 *
 * A failed payment can be recovered by the agent itself, so that card
 * gets a button that starts a real, policy-governed recovery. Everything
 * else needs a human to edit a catalogue or read a cohort, so those cards
 * get a link to the exact page where that work happens. A button that
 * pretended to do the editing would be the more impressive of the two and
 * the less honest.
 *
 * An opportunity with neither renders nothing here, and the card says so
 * rather than showing a dead control.
 */
import { Link } from "react-router-dom";
import type { RevenueOpportunityDTO } from "@razorgrowth/contracts";
import { RecoveryActionButton } from "./RecoveryActionButton";

/** Where a merchant goes to actually do the work, for the opportunity
 * types whose action is a catalogue or relationship edit rather than a
 * money operation. */
const WORKBENCH_LINK: Partial<Record<RevenueOpportunityDTO["type"], { to: string; label: string }>> = {
  CROSS_SELL: { to: "/merchant/commerce/products", label: "Open Commerce → Products to link related products" },
  UNDERPERFORMING_PRODUCT: { to: "/merchant/commerce/products", label: "Open Commerce → Products to review these products" },
  AI_BUYER_READINESS: { to: "/merchant/agent/readiness", label: "Open Merchant Agent → Readiness to see the exact blockers" },
  REPEAT_PURCHASE: { to: "/merchant/commerce/customers", label: "Open Commerce → Customers to see who is overdue" },
  CUSTOMER_REACTIVATION: { to: "/merchant/commerce/customers", label: "Open Commerce → Customers to see the lapsed cohort" },
  ABANDONED_CHECKOUT_RECOVERY: { to: "/merchant/commerce/payments", label: "Open Commerce → Payments to see the stalled checkouts" },
};

/** `undefined` when this opportunity has no wired action, so the card can
 * say that rather than render an empty slot. */
export function opportunityAction(opportunity: RevenueOpportunityDTO): React.ReactNode | undefined {
  if (opportunity.type === "FAILED_PAYMENT_RECOVERY") {
    return <RecoveryActionButton paymentIds={opportunity.subjectIds} />;
  }

  const link = WORKBENCH_LINK[opportunity.type];
  if (!link) return undefined;

  return (
    <Link
      to={link.to}
      className="inline-flex items-center gap-1.5 rounded-md border border-brand-200 bg-surface px-3 py-2 text-sm font-medium text-brand-700 hover:bg-brand-50"
    >
      {link.label} →
    </Link>
  );
}
