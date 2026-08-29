import type { ReactNode } from "react";

/**
 * One page header, used everywhere.
 *
 * Previously each route wrote its own `<h1>` and paragraph, so heading
 * size, spacing and — more importantly — TONE drifted from page to page.
 * Some explained themselves in plain language; others opened with the
 * codebase's own vocabulary and left a merchant to infer the rest.
 *
 * `lead` is deliberately required, not optional. A page that cannot say in
 * one sentence what it is for is a page a merchant will not use, and
 * making the field mandatory is how that stays true as pages are added.
 */
export function PageHeader({
  title,
  lead,
  actions,
  children,
}: {
  title: string;
  /** One plain sentence. What this page is for, in a merchant's words. */
  lead: string;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="animate-fade-up">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-ink">{title}</h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-ink-muted">{lead}</p>
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children ? <div className="mt-4">{children}</div> : null}
    </header>
  );
}
