/**
 * PART 00 §78, §19, §29 — visually distinguishes revenue figures so they
 * can never be conflated in the UI.
 *
 * FOUR CLASSES, AND WHY VERIFIED IS NOT A DATABASE VALUE
 *
 *   Observed     countable right now in the merchant's own rows — a
 *                failed payment that exists, revenue already captured.
 *   Estimated    a projection, and only ever where the merchant's own
 *                history supports a rate. Never an industry average.
 *   Potential    a ceiling. What the opportunity could be worth if
 *                everything went perfectly, which it will not.
 *   Verified     money the PROVIDER confirmed moved, on an order that
 *                traces back to an agent action. The strongest claim this
 *                product makes, and the only one that says the agent
 *                caused something.
 *
 * The first three are a Prisma enum, because rows carry them. `VERIFIED`
 * is deliberately presentation-only: no `GrowthOpportunity` row is ever
 * verified — verification is a property of a captured payment joined to a
 * proposal, computed at read time. Adding it to the database enum would
 * invite writing it onto a row that cannot support the claim.
 */
import { clsx } from "clsx";
import type { ValueClassificationDTO } from "@razorgrowth/contracts";

export type ValueClass = ValueClassificationDTO | "VERIFIED";

const LABEL: Record<ValueClass, string> = {
  OBSERVED: "Observed",
  ESTIMATED: "Estimated Incremental",
  OPPORTUNITY: "Potential Opportunity",
  VERIFIED: "Provider-verified",
};

const CLASS: Record<ValueClass, string> = {
  OBSERVED: "bg-success-subtle text-success-text",
  ESTIMATED: "bg-info-subtle text-info-text",
  OPPORTUNITY: "bg-surface-sunken text-ink-muted",
  // Deliberately the strongest treatment on the page: this is the only
  // class that means money actually moved.
  VERIFIED: "bg-brand-600 text-white",
};

export function ValueTag({ classification }: { classification: ValueClass }) {
  return (
    <span className={clsx("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium", CLASS[classification])}>
      {LABEL[classification]}
    </span>
  );
}
