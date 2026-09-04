import { useState } from "react";
import { NavLink } from "react-router-dom";
import { clsx } from "clsx";
import { Menu, X, ShieldCheck } from "lucide-react";
import { getNavSections } from "./nav-items";
import { useExperienceRole } from "../../lib/experience-role";

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const sections = getNavSections(useExperienceRole());

  return (
    <div className="lg:hidden">
      <button
        type="button"
        aria-label="Open navigation menu"
        onClick={() => setOpen(true)}
        className="flex h-9 w-9 items-center justify-center rounded-md border border-border text-ink-muted hover:bg-surface-subtle"
      >
        <Menu size={18} />
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex">
          <button
            type="button"
            aria-label="Close navigation menu"
            className="absolute inset-0 bg-ink/40"
            onClick={() => setOpen(false)}
          />
          <div className="relative flex w-64 flex-col bg-surface shadow-popover">
            <div className="flex h-16 items-center justify-between border-b border-border px-4">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-600 text-white">
                  <ShieldCheck size={15} />
                </div>
                <span className="text-sm font-semibold text-ink">Vettri Vaanigam</span>
              </div>
              <button
                type="button"
                aria-label="Close navigation menu"
                onClick={() => setOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-md text-ink-muted hover:bg-surface-subtle"
              >
                <X size={16} />
              </button>
            </div>
            <nav className="flex-1 space-y-4 overflow-y-auto px-3 py-4" aria-label="Primary">
              {sections.map((section) => (
                <div key={section.id}>
                  <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{section.label}</p>
                  <div className="space-y-0.5">
                    {section.items.map((item) => (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        onClick={() => setOpen(false)}
                        className={({ isActive }) =>
                          clsx(
                            "flex gap-2.5 rounded-lg px-3 py-2 text-sm font-medium",
                            isActive ? "bg-brand-50 text-brand-700" : "text-ink-muted hover:bg-surface-subtle hover:text-ink",
                          )
                        }
                      >
                        <item.icon size={16} />
                        {item.label}
                      </NavLink>
                    ))}
                  </div>
                </div>
              ))}
            </nav>
          </div>
        </div>
      ) : null}
    </div>
  );
}
