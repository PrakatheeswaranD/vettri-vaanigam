import { NavLink } from "react-router-dom";
import { clsx } from "clsx";
import { ShieldCheck } from "lucide-react";
import { getNavSections, ROLE_LABELS } from "./nav-items";
import { useExperienceRole } from "../../lib/experience-role";

/**
 * Primary navigation.
 *
 * Two things it does that the previous version did not:
 *
 * - Every item HAS a one-line hint, revealed on hover or when active. An
 *   earlier version showed all thirteen hints permanently; rendered, that
 *   made the nav three times taller than the viewport and destroyed the
 *   scannability the hints were meant to add. Explanation on demand,
 *   structure always.
 * - The active item is marked with a solid rail rather than only a tinted
 *   background. Tint alone is easy to miss at a glance and disappears
 *   entirely for anyone with reduced colour vision.
 */
export function Sidebar() {
  const role = useExperienceRole();
  const sections = getNavSections(role);
  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-surface lg:flex">
      <div className="flex h-16 items-center gap-2.5 border-b border-border px-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white shadow-card">
          <ShieldCheck size={17} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold tracking-tight text-ink">Anumati</p>
          <p className="truncate text-micro text-ink-faint">{ROLE_LABELS[role]}</p>
        </div>
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4" aria-label="Primary">
        {sections.map((section) => (
          <div key={section.id}>
            <p className="px-3 pb-1.5 text-micro font-semibold uppercase tracking-wider text-ink-faint">
              {section.label}
            </p>
            <div className="space-y-0.5">
              {section.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    clsx(
                      "group relative flex gap-2.5 rounded-lg py-2 pl-3 pr-2.5 transition-colors duration-150 ease-ui",
                      isActive ? "bg-brand-50 text-brand-700" : "text-ink-muted hover:bg-surface-sunken hover:text-ink",
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      {/* A shape, not just a tint — legible at a glance and
                          without relying on colour. */}
                      <span
                        aria-hidden
                        className={clsx(
                          "absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r-full transition-colors",
                          isActive ? "bg-brand-600" : "bg-transparent",
                        )}
                      />
                      <item.icon size={16} className="mt-0.5 shrink-0" />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium leading-tight">{item.label}</span>
                        <span
                          className={clsx(
                            "block overflow-hidden text-micro leading-snug transition-all duration-200 ease-ui",
                            isActive
                              ? "mt-0.5 max-h-8 text-brand-700/70 opacity-100"
                              : "max-h-0 text-ink-faint opacity-0 group-hover:mt-0.5 group-hover:max-h-8 group-hover:opacity-100",
                          )}
                        >
                          {item.hint}
                        </span>
                      </span>
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  );
}
