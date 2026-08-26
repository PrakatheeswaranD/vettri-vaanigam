/**
 * PART 03 §73, §129 — real starter queries that run through the actual
 * pipeline (never hardcoded responses). Figures below are matched to the
 * real seeded catalog: Meridian Summit Trail (UK9, Black, ₹5,802) is the
 * genuine exact match under ₹6,000, and the genuine honest near match
 * under ₹5,000 (PART 03 §131-§132).
 */
const STARTER_QUERIES = [
  "Find black running shoes in size 9 under ₹6,000",
  "Find black running shoes in size 9 under ₹5,000",
  "I need road-running shoes, lightweight preferred, under ₹4,500",
];

export function StarterQueries({ onSelect }: { onSelect: (query: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {STARTER_QUERIES.map((q) => (
        <button
          key={q}
          type="button"
          onClick={() => onSelect(q)}
          className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs text-ink-muted hover:border-brand-500 hover:text-brand-600"
        >
          {q}
        </button>
      ))}
    </div>
  );
}
