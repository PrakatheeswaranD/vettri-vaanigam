/**
 * The raw server response, per turn.
 *
 * Trace mode already shows the reasoning pipeline, but a pipeline is still
 * OUR rendering of the data. This shows the exact `BuyerAgentResponseDTO`
 * the server returned, so anyone who suspects the UI is dressing things up
 * can check — during a demo, in a review, or at 2am when a number looks
 * wrong. It is the difference between "trust the explanation" and "here is
 * what it was built from".
 */
import { useState } from "react";
import { Braces, ChevronDown, ChevronRight } from "lucide-react";
import type { BuyerAgentResponseDTO } from "@razorgrowth/contracts";

export function RawResponseToggle({ response }: { response: BuyerAgentResponseDTO }) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 text-micro font-medium text-ink-faint transition-colors hover:text-ink"
      >
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <Braces size={11} />
        {open ? "Hide raw server response" : "Show raw server response"}
      </button>

      {open ? (
        <pre className="mt-2 max-h-80 overflow-auto rounded-card border border-border bg-surface-sunken p-3 font-mono text-micro leading-relaxed text-ink-muted">
          {JSON.stringify(response, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}
