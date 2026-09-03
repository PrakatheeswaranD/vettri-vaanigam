/**
 * The second level of navigation, and the only one.
 *
 * WHY THIS EXISTS
 *
 * The console had grown to nineteen sidebar entries across two groups.
 * Each was a real screen, but a merchant reading the list could not tell
 * which of "Growth Opportunities", "Offers & Actions", "Agent Ledger" and
 * "Agent Activity" answered the question they actually had — so the
 * product read as several applications that happened to share a shell.
 *
 * Track 01 is two capabilities: a merchant growing revenue with AI, and
 * AI buyers completing real commerce. The sidebar now names five places a
 * merchant goes, and everything that used to be its own destination is a
 * tab inside the one it belongs to.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 *
 * It renders no title of its own. Each tab is still a whole page with its
 * own `PageHeader` saying what it is for in a merchant's words, and those
 * sentences were worth keeping — collapsing them into one section heading
 * would have thrown away the most useful writing in the console to save a
 * line of vertical space.
 *
 * Tabs are real routes, not local state: a merchant can link someone
 * straight to Governance → Approvals, and the back button behaves.
 */
import { NavLink } from "react-router-dom";
import { clsx } from "clsx";

export interface SectionTab {
  to: string;
  label: string;
}

export function SectionTabs({ tabs }: { tabs: readonly SectionTab[] }) {
  return (
    <nav
      aria-label="Section"
      // Scrolls rather than wraps: a wrapped tab bar changes height as the
      // window narrows and pushes the page content around under it.
      className="-mx-1 flex gap-1 overflow-x-auto border-b border-border-hair pb-px"
    >
      {tabs.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end
          className={({ isActive }) =>
            clsx(
              "shrink-0 whitespace-nowrap rounded-t-md px-3 py-2 text-sm font-medium transition-colors duration-150 ease-ui",
              isActive
                ? "border-b-2 border-brand-600 text-brand-700"
                : "border-b-2 border-transparent text-ink-muted hover:bg-surface-sunken hover:text-ink",
            )
          }
        >
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}
