/**
 * PART 00 §78, §19, §29 — visually distinguishes Observed / Estimated /
 * Opportunity revenue figures so they can never be conflated in the UI.
 */
import { clsx } from "clsx";
import type { ValueClassificationDTO } from "@razorgrowth/contracts";

const LABEL: Record<ValueClassificationDTO, string> = {
  OBSERVED: "Observed",
  ESTIMATED: "Estimated Incremental",
  OPPORTUNITY: "Potential Opportunity",
};

const CLASS: Record<ValueClassificationDTO, string> = {
  OBSERVED: "bg-success-subtle text-success-text",
  ESTIMATED: "bg-info-subtle text-info-text",
  OPPORTUNITY: "bg-surface-sunken text-ink-muted",
};

export function ValueTag({ classification }: { classification: ValueClassificationDTO }) {
  return (
    <span className={clsx("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium", CLASS[classification])}>
      {LABEL[classification]}
    </span>
  );
}
