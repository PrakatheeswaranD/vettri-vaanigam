import { NavLink } from "react-router-dom";
import { clsx } from "clsx";
import { Zap } from "lucide-react";
import { NAV_SECTIONS } from "./nav-items";

export function Sidebar() {
  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-surface lg:flex">
      <div className="flex h-16 items-center gap-2 border-b border-border px-5">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-500 text-white">
          <Zap size={16} />
        </div>
        <span className="text-sm font-semibold tracking-tight text-ink">RazorGrowth AI</span>
      </div>
      <nav className="flex-1 space-y-4 overflow-y-auto px-3 py-4" aria-label="Primary">
        {NAV_SECTIONS.map((section) => (
          <div key={section.id}>
            <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{section.label}</p>
            <div className="space-y-0.5">
              {section.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    clsx(
                      "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
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
    </aside>
  );
}
