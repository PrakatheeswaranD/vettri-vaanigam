import { Link } from "react-router-dom";
import { FlaskConical, LogOut, Sparkles } from "lucide-react";
import { useMerchant } from "../../hooks/use-api";
import { useCurrentUser, useLogout } from "../../hooks/use-auth";
import { MobileNav } from "./MobileNav";
import { ROLE_LABELS } from "./nav-items";
import { useExperienceRole } from "../../lib/experience-role";

/**
 * PART 01 §38, §88 — merchant identity, a subtle TEST MODE indicator (no
 * real money moves anywhere in this system yet), and route-contextual
 * space. Kept unobtrusive rather than a banner shouting on every page.
 */
export function TopBar() {
  const experienceRole = useExperienceRole();
  const { data: merchant } = useMerchant(experienceRole === "merchant");
  const { data: user } = useCurrentUser();
  const logout = useLogout();

  return (
    <header className="flex h-16 items-center justify-between border-b border-border bg-surface px-4 lg:px-6">
      <div className="flex items-center gap-3">
        <MobileNav />
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-semibold text-ink">
            {experienceRole === "customer" ? "Customer Workspace" : merchant?.name ?? "Loading merchant…"}
          </span>
          <span className="text-xs text-ink-faint">{ROLE_LABELS[experienceRole]}</span>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Link
          to={experienceRole === "customer" ? "/customer/buyer-agent" : "/merchant/overview"}
          className="inline-flex items-center gap-1.5 rounded-full border border-brand-300 bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700 shadow-sm hover:bg-brand-100 transition"
        >
          <Sparkles size={13} className="text-brand-600" />
          <span>{experienceRole === "customer" ? "Buy with AI" : "Merchant Console"}</span>
        </Link>
        <span
          title="No real money moves in this environment — all payments are Razorpay Test Mode or seeded demo data."
          className="inline-flex items-center gap-1.5 rounded-full border border-warning/30 bg-warning-subtle px-2.5 py-1 text-xs font-medium text-warning-text"
        >
          <FlaskConical size={12} />
          Test Mode
        </span>
        {user ? (
          <div className="hidden items-center gap-2 sm:flex">
            <div className="text-right leading-tight">
              <p className="text-xs font-medium text-ink">{user.email}</p>
              <p className="text-[11px] text-ink-faint">{user.role}</p>
            </div>
            <button
              type="button"
              title="Log out"
              onClick={() => logout.mutate()}
              className="rounded-md border border-border p-1.5 text-ink-muted hover:bg-surface-subtle hover:text-ink"
            >
              <LogOut size={14} />
            </button>
          </div>
        ) : null}
      </div>
    </header>
  );
}
