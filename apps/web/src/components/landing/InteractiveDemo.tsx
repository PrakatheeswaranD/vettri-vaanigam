/**
 * The interactive demo.
 *
 * Eight steps, run on demand rather than on a loop, because a reader who
 * presses the button is choosing to watch — and a sequence that was
 * already halfway through when they arrived teaches nothing. Each line
 * lands with its own status, and the final card states the three things
 * the whole page has been arguing: authorized, policy-approved, recorded.
 *
 * Under reduced motion the run completes immediately on press: the
 * information is the point, the pacing is not.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, CircleDashed, Loader2, Play, RotateCcw, ShieldCheck } from "lucide-react";
import { Reveal, SectionShell, usePrefersReducedMotion } from "./system";

const STEPS = [
  { label: "Intent received", detail: "Structured from a natural-language request" },
  { label: "Buyer Agent searching", detail: "Verified merchants queried in parallel" },
  { label: "Merchant Agent responding", detail: "Offer assembled from live catalogue data" },
  { label: "Offer selected", detail: "Premium bundle · ₹74,999" },
  { label: "Policy evaluation", detail: "Limit, merchant status and category checked" },
  { label: "Risk check", detail: "Scored low against this agent's own history" },
  { label: "Payment authorization", detail: "Requested only after the verdict was written" },
  { label: "Audit event recorded", detail: "Hash-chained to the previous ledger entry" },
];

type RunState = "idle" | "running" | "complete";

export function InteractiveDemo() {
  const reduced = usePrefersReducedMotion();
  const [state, setState] = useState<RunState>("idle");
  const [cursor, setCursor] = useState(0);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
  }, []);

  const run = useCallback(() => {
    if (timer.current) window.clearInterval(timer.current);
    setCursor(0);
    setState("running");

    if (reduced) {
      setCursor(STEPS.length);
      setState("complete");
      return;
    }

    timer.current = window.setInterval(() => {
      setCursor((n) => {
        const next = n + 1;
        if (next >= STEPS.length) {
          if (timer.current) window.clearInterval(timer.current);
          setState("complete");
        }
        return Math.min(next, STEPS.length);
      });
    }, 620);
  }, [reduced]);

  const idle = state === "idle";
  const progress = Math.round((cursor / STEPS.length) * 100);

  return (
    <SectionShell
      id="demo"
      layout="stack"
      eyebrow="Interactive demo"
      title="See an AI transaction happen."
      lede="Eight steps, in the order the system runs them. Press once and watch the whole path from intent to audit record."
    >

      <Reveal>
        <div className="os-card os-edge overflow-hidden rounded-2xl">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--os-line)] px-5 py-4">
            <div className="min-w-0">
              <p className="os-label text-[var(--os-faint)]">Agentic transaction · sandbox</p>
              <p className="os-mono mt-1.5 text-[12px] text-[var(--os-dim)]">
                {idle
                  ? "ready"
                  : state === "running"
                    ? `executing · ${cursor}/${STEPS.length}`
                    : `complete · ${STEPS.length}/${STEPS.length}`}
              </p>
            </div>
            <button type="button" onClick={run} className="os-btn os-btn-primary group shrink-0">
              {state === "running" ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : state === "complete" ? (
                <RotateCcw className="h-4 w-4" aria-hidden />
              ) : (
                <Play className="h-4 w-4" aria-hidden />
              )}
              {state === "complete" ? "Run again" : "Run Agentic Transaction"}
            </button>
          </div>

          <div className="os-meter h-0.5 rounded-none">
            <span
              style={{ width: `${progress}%`, backgroundImage: "linear-gradient(90deg, #3b82f6, #22d3ee, #8b5cf6)" }}
            />
          </div>

          <ol className="divide-y divide-[var(--os-line)]" aria-live="polite">
            {STEPS.map((step, index) => {
              const done = index < cursor;
              const active = state === "running" && index === cursor;
              return (
                <li
                  key={step.label}
                  className={`flex items-center gap-4 px-5 py-3.5 transition-colors ${
                    active ? "bg-white/[0.04]" : ""
                  }`}
                >
                  <span className="os-mono w-6 shrink-0 text-[11px] text-[var(--os-faint)]">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="grid h-6 w-6 shrink-0 place-items-center">
                    {done ? (
                      <Check className="h-4 w-4 text-[var(--os-success)]" aria-hidden />
                    ) : active ? (
                      <Loader2 className="h-4 w-4 animate-spin text-[var(--os-cyan)]" aria-hidden />
                    ) : (
                      <CircleDashed className="h-4 w-4 text-[var(--os-line-2)]" aria-hidden />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={`block text-[14px] font-medium ${
                        done || active ? "text-[var(--os-text)]" : "text-[var(--os-faint)]"
                      }`}
                    >
                      {step.label}
                    </span>
                    <span
                      className={`mt-0.5 block text-[12px] leading-relaxed ${
                        done || active ? "text-[var(--os-dim)]" : "text-[var(--os-faint)] opacity-60"
                      }`}
                    >
                      {step.detail}
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>

          {state === "complete" ? (
            <div className="border-t border-[rgba(52,211,153,0.28)] bg-[rgba(52,211,153,0.06)] px-5 py-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="os-label flex items-center gap-2 text-[var(--os-success)]">
                    <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
                    Transaction complete
                  </p>
                  <p className="os-mono mt-2 text-[1.75rem] font-semibold leading-none text-[var(--os-text)]">
                    ₹74,999
                  </p>
                </div>
                <ul className="grid gap-1.5">
                  {["Authorized", "Policy approved", "Audit recorded"].map((item) => (
                    <li key={item} className="flex items-center gap-2 text-[13px] text-[var(--os-dim)]">
                      <Check className="h-3.5 w-3.5 text-[var(--os-success)]" aria-hidden />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}
        </div>
      </Reveal>
    </SectionShell>
  );
}
