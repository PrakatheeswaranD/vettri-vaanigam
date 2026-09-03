/**
 * Real starter queries that run through the actual pipeline — never
 * hardcoded responses. Figures are matched to the real seeded catalog:
 * Meridian Summit Trail (UK9, Black, ₹5,802) is the genuine exact match
 * under ₹6,000, and the genuine honest near match under ₹5,000.
 *
 * PART 09 — THESE TEACH A VOCABULARY, NOT JUST A SEARCH.
 *
 * The agent understands follow-ups now: a refinement merges with the
 * search already in flight, a comparison builds a factual side-by-side,
 * and a purchase prices the chosen item against the buyer's own spending
 * policy. A buyer who never learns they can say "buy the second one" will
 * keep operating the site by hand, which is the exact behaviour this part
 * exists to make unnecessary.
 *
 * So the openers come first and the follow-ups are labelled as such —
 * they only mean anything once something is on the table.
 */
const STARTER_QUERIES = [
  "Find black running shoes in size 9 under ₹6,000",
  "I need road-running shoes, lightweight preferred, under ₹4,500",
];

/** Only useful after a search, so they are presented separately rather
 * than offered as an opening move that would fall through to a search. */
const FOLLOW_UPS = ["Show cheaper ones", "Compare these", "Buy the first one"];

export function StarterQueries({ onSelect, showFollowUps = false }: { onSelect: (query: string) => void; showFollowUps?: boolean }) {
  return (
    <div className="space-y-2">
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
      {showFollowUps ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-ink-faint">Then:</span>
          {FOLLOW_UPS.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => onSelect(q)}
              className="rounded-full border border-dashed border-border bg-surface px-3 py-1.5 text-xs text-ink-muted hover:border-brand-500 hover:text-brand-600"
            >
              {q}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
