/**
 * The three named AI specialists.
 *
 * WHY THIS EXISTS
 *
 * The product surface claimed two agents while the code had three. The
 * Catalog Agent's `normalizeCatalogRow` was always a real, separate
 * `AIProvider` method — it just had no name, so anyone reading the source
 * would have found a third AI touchpoint the UI never mentioned. Naming it
 * changed no code; it closed a gap between what we said and what we built.
 *
 * The boundary line under each one matters more than the name. Three
 * specialists that can each be told apart, and each of which cannot move
 * money, is a stronger claim than two — but only if the limits are stated
 * next to the capability rather than in documentation nobody opens.
 */
import { Bot, Store, FileSpreadsheet, Lock } from "lucide-react";
import { AI_SPECIALISTS } from "@razorgrowth/domain";
import { Card, CardBody, CardHeader, CardTitle } from "../ui/Card";

const ICONS: Record<string, typeof Bot> = {
  buyer_agent: Bot,
  merchant_agent: Store,
  catalog_agent: FileSpreadsheet,
};

export function NamedSpecialists() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>The three AI specialists</CardTitle>
      </CardHeader>
      <CardBody className="space-y-3">
        <p className="text-sm leading-relaxed text-ink-muted">
          Each is a separate, single-purpose model call — not three names for one prompt. None of them can approve a
          purchase, set a price, apply a discount, or move money. That is deterministic code&rsquo;s job, always.
        </p>

        <div className="grid gap-3 md:grid-cols-3">
          {AI_SPECIALISTS.map((specialist) => {
            const Icon = ICONS[specialist.id] ?? Bot;
            return (
              <div key={specialist.id} className="rounded-card border border-border p-3">
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
                    <Icon size={15} />
                  </span>
                  <p className="text-sm font-semibold text-ink">{specialist.name}</p>
                </div>

                <p className="mt-2 text-xs leading-relaxed text-ink-muted">{specialist.purpose}</p>

                <p className="mt-2 font-mono text-micro text-ink-faint">{specialist.aiMethod}</p>

                <p className="mt-2 flex items-start gap-1.5 rounded-md bg-surface-sunken px-2 py-1.5 text-micro leading-snug text-ink-muted">
                  <Lock size={10} className="mt-0.5 shrink-0 text-ink-faint" />
                  {specialist.boundary}
                </p>
              </div>
            );
          })}
        </div>
      </CardBody>
    </Card>
  );
}
