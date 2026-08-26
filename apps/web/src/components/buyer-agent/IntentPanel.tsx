/**
 * PART 03 §74-§75 — makes the Buyer Agent's interpretation of the buyer's
 * message inspectable, and visually distinguishes REQUIRED (hard
 * constraint) from PREFERRED (soft) so the architecture is visible, not
 * just described.
 */
import type { ReactNode } from "react";
import { CheckCircle2, Ban, Sparkles } from "lucide-react";
import type { BuyerIntentDTO } from "@razorgrowth/contracts";
import { formatMoney } from "../../lib/format";

function Chip({ tone, children }: { tone: "required" | "preferred" | "excluded"; children: ReactNode }) {
  const toneClass =
    tone === "required"
      ? "bg-brand-50 text-brand-700"
      : tone === "preferred"
        ? "bg-info-subtle text-info-text"
        : "bg-danger-subtle text-danger-text";
  const Icon = tone === "required" ? CheckCircle2 : tone === "preferred" ? Sparkles : Ban;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${toneClass}`}>
      <Icon size={12} />
      {children}
    </span>
  );
}

export function IntentPanel({ intent }: { intent: BuyerIntentDTO }) {
  const requiredChips: string[] = [];
  if (intent.category) requiredChips.push(intent.category);
  if (intent.budget.maxMinor !== null) requiredChips.push(`≤ ${formatMoney({ amountMinor: intent.budget.maxMinor, currency: intent.budget.currency })}`);
  if (intent.budget.minMinor !== null) requiredChips.push(`≥ ${formatMoney({ amountMinor: intent.budget.minMinor, currency: intent.budget.currency })}`);
  for (const [key, value] of Object.entries(intent.requiredAttributes)) requiredChips.push(`${key}: ${value}`);
  if (intent.availabilityRequirement === "PURCHASABLE_ONLY") requiredChips.push("in stock");

  const preferredChips = Object.entries(intent.preferredAttributes).map(([key, value]) => `${key}: ${value}`);
  const excludedChips = Object.entries(intent.excludedAttributes).flatMap(([key, values]) => values.map((v) => `${key} ≠ ${v}`));

  return (
    <div className="space-y-3">
      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-faint">Required</p>
        {requiredChips.length === 0 ? (
          <p className="text-xs text-ink-faint">Nothing required yet.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {requiredChips.map((c) => (
              <Chip key={c} tone="required">
                {c}
              </Chip>
            ))}
          </div>
        )}
      </div>

      {preferredChips.length > 0 ? (
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-faint">Preferred</p>
          <div className="flex flex-wrap gap-1.5">
            {preferredChips.map((c) => (
              <Chip key={c} tone="preferred">
                {c}
              </Chip>
            ))}
          </div>
        </div>
      ) : null}

      {excludedChips.length > 0 ? (
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-faint">Excluded</p>
          <div className="flex flex-wrap gap-1.5">
            {excludedChips.map((c) => (
              <Chip key={c} tone="excluded">
                {c}
              </Chip>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
