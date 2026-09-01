/**
 * The rail down the left edge.
 *
 * WHAT IT IS FOR
 *
 * The page is one transaction being walked from intent to audit, and this
 * is the position indicator for that walk: a fixed column of markers that
 * fills as you descend, names the section you are in, and jumps to any
 * other on click. It is the device that stops the page reading as ten
 * independent blocks — the reader can always see where in the flow they
 * are, the same way the product's own console shows where a transaction
 * is in the gate.
 *
 * It appears only on screens wide enough to have empty margin beside a
 * 72rem column, and it is `aria-hidden` with the same targets reachable
 * from the navigation, so it is decoration for assistive tech rather than
 * a second, competing set of landmarks.
 */
import { SECTIONS, useActiveSection, usePrefersReducedMotion } from "./system";

export function TransactionSpine() {
  const active = useActiveSection();
  const reduced = usePrefersReducedMotion();
  const activeIndex = SECTIONS.findIndex((section) => section.id === active);
  const progress = activeIndex < 0 ? 0 : ((activeIndex + 1) / SECTIONS.length) * 100;

  function jump(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  }

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed left-5 top-1/2 z-40 hidden -translate-y-1/2 xl:block 2xl:left-10"
    >
      <p className="os-label mb-4 text-[9px] text-[var(--os-faint)]">Transaction path</p>

      <div className="relative">
        {/* The track, and the part of it already crossed. */}
        <span aria-hidden className="absolute left-[3px] top-1 h-[calc(100%-0.5rem)] w-px bg-[var(--os-line)]" />
        <span
          aria-hidden
          className="absolute left-[3px] top-1 w-px bg-gradient-to-b from-[var(--os-cyan)] to-[var(--os-violet)] transition-[height] duration-500 ease-out"
          style={{ height: `calc(${progress}% - 0.5rem)` }}
        />

        <ul className="relative space-y-3.5">
          {SECTIONS.map((section, index) => {
            const isActive = section.id === active;
            const passed = activeIndex >= 0 && index < activeIndex;
            return (
              <li key={section.id}>
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => jump(section.id)}
                  className="pointer-events-auto group flex items-center gap-3 text-left"
                >
                  <span
                    className="h-[7px] w-[7px] shrink-0 rounded-full transition-all duration-300"
                    style={{
                      backgroundColor: isActive
                        ? "var(--os-cyan)"
                        : passed
                          ? "rgba(34,211,238,0.45)"
                          : "var(--os-line-2)",
                      boxShadow: isActive ? "0 0 0 4px rgba(34,211,238,0.14)" : "none",
                    }}
                  />
                  <span
                    className={`os-label whitespace-nowrap text-[9px] transition-all duration-300 group-hover:text-[var(--os-dim)] ${
                      isActive
                        ? "translate-x-0 text-[var(--os-text)] opacity-100"
                        : "-translate-x-1 text-[var(--os-faint)] opacity-0 group-hover:translate-x-0 group-hover:opacity-100"
                    }`}
                  >
                    {section.label}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
