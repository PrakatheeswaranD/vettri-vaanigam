/**
 * The persistent financial-authority indicator (§20) — the single most
 * important sentence in the product, made visually elegant rather than a
 * wall of warnings. This never varies per workflow: it describes the
 * architecture's permanent invariant, not a workflow-specific outcome.
 */
import { Bot, Cpu, ShieldCheck, User } from "lucide-react";

const ITEMS = [
  { icon: Bot, label: "AI", value: "Proposal only" },
  { icon: Cpu, label: "Policy", value: "Deterministic" },
  { icon: User, label: "Approval", value: "Human when required" },
  { icon: ShieldCheck, label: "Payment Truth", value: "Razorpay-verified" },
] as const;

export function FinancialAuthorityStrip() {
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-card border border-border bg-border sm:grid-cols-4">
      {ITEMS.map(({ icon: Icon, label, value }) => (
        <div key={label} className="flex flex-col gap-1 bg-surface px-4 py-3">
          <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
            <Icon size={12} />
            {label}
          </span>
          <span className="text-sm font-semibold text-ink">{value}</span>
        </div>
      ))}
    </div>
  );
}
