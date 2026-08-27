import { FlaskConical } from "lucide-react";
import { useMerchant } from "../../hooks/use-api";
import { MobileNav } from "./MobileNav";

/**
 * PART 01 §38, §88 — merchant identity, a subtle TEST MODE indicator (no
 * real money moves anywhere in this system yet), and route-contextual
 * space. Kept unobtrusive rather than a banner shouting on every page.
 */
export function TopBar() {
  const { data: merchant } = useMerchant();

  return (
    <header className="flex h-16 items-center justify-between border-b border-border bg-surface px-4 lg:px-6">
      <div className="flex items-center gap-3">
        <MobileNav />
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-semibold text-ink">{merchant?.name ?? "Loading merchant…"}</span>
          <span className="text-xs text-ink-faint">{merchant?.businessCategory ?? " "}</span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span
          title="No real money moves in this environment — all payments are Razorpay Test Mode or seeded demo data."
          className="inline-flex items-center gap-1.5 rounded-full border border-warning/30 bg-warning-subtle px-2.5 py-1 text-xs font-medium text-warning-text"
        >
          <FlaskConical size={12} />
          Test Mode
        </span>
      </div>
    </header>
  );
}
