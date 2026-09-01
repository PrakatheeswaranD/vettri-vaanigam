/**
 * Write policy in English; read the diff before anything is saved.
 *
 * THE SHAPE OF THIS COMPONENT IS THE SAFETY ARGUMENT
 *
 * There is no path in this file from a sentence to a saved policy. The
 * draft endpoint writes nothing; applying it calls the same authenticated
 * save the manual form uses, with the same validation, after a human has
 * read what changes. A merchant who never presses Apply has changed
 * nothing, however the model behaved.
 *
 * WHAT THE DIFF IS FOR
 *
 * Two things, and the second matters more:
 *
 * 1. Showing what changed. Obvious.
 * 2. Showing WHICH WAY it points. A merchant skimming "₹10,000 → ₹40,000"
 *    can easily read it as tightening. Every loosening change is marked
 *    explicitly, and a draft that loosens anything says so before the
 *    button, not after.
 */
import { useState } from "react";
import { Sparkles, ArrowRight, AlertTriangle, Loader2, Check } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "../ui/Card";
import { useDraftPolicy, type GatewayPolicy, type PolicyFieldChange } from "../../hooks/use-agent-gateway";
import { formatMoney } from "../../lib/format";

const EXAMPLES = [
  "Never let an agent I haven't sold to before spend more than ₹10,000",
  "Cap the negotiator at 5% off and never go below 25% margin",
  "Block gift cards from agent purchases entirely",
  "Allow returning agents up to ₹40,000 and limit anyone to 10 attempts an hour",
];

const MONEY_FIELDS = new Set(["unknownAgentCeilingMinor", "knownAgentCeilingMinor"]);
const PERCENT_FIELDS = new Set(["maxNegotiationDiscountBps", "negotiatorFloorMarginBps"]);

function renderValue(field: string, value: number | string[], currency: string): string {
  if (Array.isArray(value)) return value.length === 0 ? "nothing blocked" : value.join(", ");
  if (MONEY_FIELDS.has(field)) {
    return formatMoney({ amountMinor: value, currency: currency === "USD" ? "USD" : "INR" });
  }
  if (PERCENT_FIELDS.has(field)) return `${value / 100}%`;
  return String(value);
}

function ChangeRow({ change, currency }: { change: PolicyFieldChange; currency: string }) {
  return (
    <li className="px-4 py-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] font-semibold text-ink">{change.label}</p>
        {change.loosens ? (
          <span className="inline-flex items-center gap-1 rounded-pill border border-warning-border bg-warning-subtle px-2 py-0.5 text-micro font-semibold text-warning-text">
            <AlertTriangle className="h-3 w-3" aria-hidden />
            Loosens a guardrail
          </span>
        ) : null}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 font-mono text-[13px]">
        <span className="rounded border border-border bg-surface-sunken px-2 py-1 text-ink-muted line-through decoration-ink-faint">
          {renderValue(change.field, change.before, currency)}
        </span>
        <ArrowRight className="h-3.5 w-3.5 text-ink-faint" aria-hidden />
        <span className="rounded border border-brand-200 bg-brand-50 px-2 py-1 font-semibold text-brand-800">
          {renderValue(change.field, change.after, currency)}
        </span>
      </div>

      <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">{change.effect}</p>

      {change.clampedFrom !== null ? (
        <p className="mt-1.5 text-micro text-warning-text">
          Reduced from {renderValue(change.field, change.clampedFrom, currency)} — above what this authoring
          path allows. Set a higher number in the form below if you genuinely want it.
        </p>
      ) : null}
    </li>
  );
}

export function PolicyComposer({
  policy,
  onApply,
  applying,
}: {
  policy: GatewayPolicy | undefined;
  /** Applies the proposed policy through the normal authenticated save. */
  onApply: (proposed: GatewayPolicy) => void;
  applying: boolean;
}) {
  const [instruction, setInstruction] = useState("");
  const draft = useDraftPolicy();
  const [applied, setApplied] = useState(false);

  const result = draft.data;
  const currency = policy?.currency ?? "INR";

  function submit() {
    if (instruction.trim().length < 3) return;
    setApplied(false);
    draft.mutate(instruction.trim());
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Describe your policy in plain English</CardTitle>
            <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-ink-muted">
              Say what you want and read the diff before anything is saved. Nothing here writes to your policy —
              the model drafts, the change is clamped to safe bounds, and you decide.
            </p>
          </div>
          {result ? (
            <span className="shrink-0 rounded-pill border border-border bg-surface-subtle px-2.5 py-1 text-micro font-medium text-ink-muted">
              {result.modelMode === "DEMO_RULE_BASED" ? "Rule-based (no model key set)" : result.modelMode}
            </span>
          ) : null}
        </div>
      </CardHeader>

      <CardBody className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            placeholder="e.g. Never let an unknown agent spend more than ₹10,000"
            className="min-w-0 flex-1 rounded-card border border-border bg-surface px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-faint focus:border-brand-400"
          />
          <button
            type="button"
            onClick={submit}
            disabled={draft.isPending || instruction.trim().length < 3}
            className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-card bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-card transition hover:bg-brand-700 disabled:opacity-40"
          >
            {draft.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Drafting…
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" aria-hidden />
                Draft the change
              </>
            )}
          </button>
        </div>

        {!result && !draft.isPending ? (
          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => setInstruction(example)}
                className="rounded-pill border border-border bg-surface-subtle px-3 py-1.5 text-micro text-ink-muted transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800"
              >
                {example}
              </button>
            ))}
          </div>
        ) : null}

        {draft.isError ? (
          <p className="rounded-card border border-danger-border bg-danger-subtle px-4 py-3 text-[13px] text-danger-text">
            That draft could not be produced. Nothing was changed.
          </p>
        ) : null}

        {result ? (
          <div className="space-y-3">
            {result.changes.length === 0 ? (
              <p className="rounded-card border border-border bg-surface-subtle px-4 py-3 text-[13px] leading-relaxed text-ink-muted">
                {result.note}
              </p>
            ) : (
              <>
                <ul className="divide-y divide-border-hair overflow-hidden rounded-card border border-border">
                  {result.changes.map((change) => (
                    <ChangeRow key={change.field} change={change} currency={currency} />
                  ))}
                </ul>

                {result.clampNotes.length > 0 ? (
                  <ul className="space-y-1.5 rounded-card border border-warning-border bg-warning-subtle px-4 py-3">
                    {result.clampNotes.map((note) => (
                      <li key={note} className="text-micro leading-relaxed text-warning-text">
                        {note}
                      </li>
                    ))}
                  </ul>
                ) : null}

                {result.ignoredFields.length > 0 ? (
                  <p className="rounded-card border border-border bg-surface-subtle px-4 py-2.5 text-micro leading-relaxed text-ink-muted">
                    Ignored, because these are not settings a sentence can change:{" "}
                    <span className="font-mono">{result.ignoredFields.join(", ")}</span>
                  </p>
                ) : null}

                <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-surface-subtle px-4 py-3">
                  {/* Once applied, the pre-apply caution is no longer true.
                      Leaving "Nothing has been saved yet" beside a button
                      reading "Applied" told the merchant two opposite things
                      about whether their policy had changed. */}
                  <p className="text-[13px] text-ink-muted">
                    {applied ? (
                      <span className="font-semibold text-success-text">
                        Saved. These values are now the policy every later decision is judged against.
                      </span>
                    ) : (
                      <>
                        {result.loosensAnyGuardrail ? (
                          <span className="font-semibold text-warning-text">
                            This widens what agents may do without asking you.
                          </span>
                        ) : (
                          "Nothing has been saved yet."
                        )}{" "}
                        Review the changes above before applying.
                      </>
                    )}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      onApply(result.proposed);
                      setApplied(true);
                    }}
                    disabled={applying || applied}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-pill bg-ink px-4 py-2 text-[13px] font-semibold text-ink-inverse transition hover:bg-ink-muted disabled:opacity-50"
                  >
                    {applied ? (
                      <>
                        <Check className="h-3.5 w-3.5" aria-hidden />
                        Applied
                      </>
                    ) : (
                      `Apply ${result.changes.length} change${result.changes.length === 1 ? "" : "s"}`
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
