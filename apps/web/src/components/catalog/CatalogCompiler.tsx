/**
 * Catalog Compiler, made usable.
 *
 * The compiler existed only as `POST /agent-catalog/compile`. A merchant
 * could not reach the one feature that answers their actual first
 * question: "my product list is a mess — can an AI agent read it?"
 *
 * WHAT THIS DELIBERATELY SHOWS FIRST
 *
 * The ISSUES, not the output. A merchant does not want to admire JSON-LD;
 * they want to know which rows are broken and why. A row the model could
 * not read is reported against its row number so it can be fixed in the
 * source spreadsheet — publishing a confident guess to every AI buyer on
 * the internet would be worse than publishing nothing, because the buyer
 * cannot tell the difference.
 */
import { useState } from "react";
import { Wand2, AlertTriangle, CheckCircle2, FileWarning } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "../ui/Card";
import { apiPost, ApiError } from "../../lib/api-client";
import { useMutation } from "@tanstack/react-query";

interface CompileIssue {
  rowNumber: number;
  field: string;
  detail: string;
}

interface CompiledOffer {
  sku: string;
  priceMinor: number;
  currency: string;
  attributes: Record<string, string>;
}

interface CompiledProduct {
  name: string;
  category: string | null;
  offers: CompiledOffer[];
}

interface CompileResult {
  rowsRead: number;
  rowsCompiled: number;
  issues: CompileIssue[];
  products: CompiledProduct[];
  providerMode: string;
}

/** Deliberately messy, because a clean sample would prove nothing. */
const SAMPLE_CSV = `Product Name,Category,Price,Notes
"Meridian Pulse Runner — Festive offer!!",Running Shoes,"Rs. 4,499.00","Black, UK9"
"CoolMax Socks combo of 2",Socks,"399","Grey"
"Mystery Item",,`;

export function CatalogCompiler() {
  const [csv, setCsv] = useState(SAMPLE_CSV);

  const compile = useMutation({
    mutationFn: () => apiPost<CompileResult>("/agent-catalog/compile", { csv }),
  });

  const result = compile.data;

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center gap-2">
        <Wand2 size={16} className="text-brand-600" />
        <CardTitle>Turn a messy product list into something an agent can read</CardTitle>
      </CardHeader>

      <CardBody className="space-y-4">
        <p className="text-sm leading-relaxed text-ink-muted">
          Paste rows from any export — a spreadsheet, a Shopify feed, whatever you already have. Real product data is
          free text (&ldquo;500ml, combo of 2, festive offer&rdquo;), and reading that is a language problem, so a model
          does it. It never invents: anything it cannot read comes back as a numbered problem for you to fix, not a
          guess published to every AI buyer.
        </p>

        <textarea
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          rows={6}
          spellCheck={false}
          aria-label="Product rows to compile"
          className="w-full rounded-card border border-border bg-surface px-3 py-2 font-mono text-micro text-ink focus:border-brand-500"
        />

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => compile.mutate()}
            disabled={compile.isPending || csv.trim().length === 0}
            className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-60"
          >
            <Wand2 size={14} />
            {compile.isPending ? "Reading your rows…" : "Compile"}
          </button>
          {result ? (
            <p className="text-micro text-ink-faint">
              {result.rowsCompiled} of {result.rowsRead} rows compiled ·{" "}
              {result.providerMode === "DEMO_RULE_BASED" ? "deterministic extractor" : "live model"}
            </p>
          ) : null}
        </div>

        {compile.isError ? (
          <p className="rounded-card bg-danger-subtle px-3 py-2 text-sm text-danger-text">
            {compile.error instanceof ApiError ? compile.error.message : "Could not compile those rows."}
          </p>
        ) : null}

        {result ? (
          <div className="space-y-3">
            {/* Problems first — that is what a merchant came for. */}
            {result.issues.length > 0 ? (
              <div className="rounded-card border border-warning-border bg-warning-subtle p-3">
                <p className="flex items-center gap-1.5 text-sm font-medium text-warning-text">
                  <FileWarning size={14} />
                  {result.issues.length} thing{result.issues.length === 1 ? "" : "s"} an agent would not understand
                </p>
                <ul className="mt-2 space-y-1">
                  {result.issues.map((i, idx) => (
                    <li key={`${i.rowNumber}-${i.field}-${idx}`} className="flex items-start gap-1.5 text-micro text-warning-text">
                      <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                      <span>
                        <span className="font-semibold">Row {i.rowNumber}</span> — {i.detail}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="flex items-center gap-1.5 rounded-card border border-success-border bg-success-subtle px-3 py-2 text-sm text-success-text">
                <CheckCircle2 size={14} />
                Every row read cleanly — an agent could buy from all of them.
              </p>
            )}

            {result.products.length > 0 ? (
              <div className="rounded-card border border-border">
                <p className="border-b border-border px-3 py-2 text-micro font-semibold uppercase tracking-wide text-ink-faint">
                  What an agent would see
                </p>
                <ul className="divide-y divide-border">
                  {result.products.map((p, idx) => (
                    <li key={`${p.name}-${idx}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                      <span className="text-sm font-medium text-ink">{p.name}</span>
                      {p.category ? (
                        <span className="rounded-pill bg-surface-sunken px-2 py-0.5 text-micro text-ink-muted">{p.category}</span>
                      ) : (
                        <span className="rounded-pill bg-warning-subtle px-2 py-0.5 text-micro text-warning-text">no category</span>
                      )}
                      {p.offers[0] ? (
                        <span className="text-micro text-ink-muted">
                          ₹{(p.offers[0].priceMinor / 100).toLocaleString("en-IN")}
                        </span>
                      ) : (
                        // Published for discovery, but unbuyable — and said
                        // so, rather than silently dropped.
                        <span className="text-micro text-danger-text">no price — an agent cannot buy this</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
