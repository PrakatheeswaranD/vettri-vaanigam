/**
 * The failure path.
 *
 * Any demo can show a payment succeeding. The reason this section exists
 * is that the interesting engineering in payments is what happens when
 * the money has left one side and not arrived at the other — and a
 * platform that lets AI agents transact has to answer that before it is
 * allowed anywhere near production.
 *
 * The recovery sequence runs once, when the section is scrolled into
 * view, rather than looping: a repeating failure animation trivialises
 * the thing it is depicting.
 */
import { useCallback, useRef, useState } from "react";
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, FileWarning, ShieldCheck, Siren, UserCheck } from "lucide-react";
import { Reveal, SectionShell, usePrefersReducedMotion } from "./system";

const RECOVERY = [
  { label: "Recovery case created", icon: FileWarning, detail: "case_rc_4471 opened against the failed authorization" },
  { label: "Policy evaluated", icon: ShieldCheck, detail: "Reconciliation rules matched; refund window confirmed" },
  { label: "Merchant notified", icon: Siren, detail: "Owner alerted with the mismatch and the evidence attached" },
  { label: "Customer protected", icon: UserCheck, detail: "Debit flagged for return; no further capture permitted" },
];

/** Runs a counter 0…length once, the first time the node is on screen. */
function useRunOnce(length: number, interval: number) {
  const reduced = usePrefersReducedMotion();
  const [count, setCount] = useState(reduced ? length : 0);
  const started = useRef(false);

  const ref = useCallback(
    (node: HTMLElement | null) => {
      if (!node || started.current) return;
      if (reduced || !("IntersectionObserver" in window)) {
        started.current = true;
        setCount(length);
        return;
      }
      const observer = new IntersectionObserver(
        (entries) => {
          if (!entries.some((entry) => entry.isIntersecting) || started.current) return;
          started.current = true;
          observer.disconnect();
          const id = window.setInterval(
            () =>
              setCount((n) => {
                if (n >= length) {
                  window.clearInterval(id);
                  return n;
                }
                return n + 1;
              }),
            interval,
          );
        },
        { threshold: 0.35 },
      );
      observer.observe(node);
    },
    [length, interval, reduced],
  );

  return { count, ref };
}

export function FailureSimulation() {
  const { count, ref } = useRunOnce(RECOVERY.length, 850);

  return (
    <SectionShell
      id="failure"
      layout="split"
      eyebrow="Failure-first design"
      title="When payments fail, intelligence doesn't."
      lede="A debit without a matching credit is the worst state a payment system can be in. It is also the state most demos never show."
    >

      <div className="grid gap-4 lg:grid-cols-2">
        {/* The failure */}
        <Reveal className="h-full">
          <div className="os-card flex h-full flex-col rounded-2xl border-[rgba(248,113,113,0.28)] p-6">
            <div className="flex items-center justify-between gap-3">
              <p className="os-label flex items-center gap-2 text-[var(--os-danger)]">
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                Payment failed
              </p>
              <p className="os-mono text-[11px] text-[var(--os-faint)]">txn_3b90f1</p>
            </div>

            <p className="os-mono mt-5 text-[2.25rem] font-semibold leading-none text-[var(--os-text)]">₹20,000</p>

            <dl className="mt-7 divide-y divide-[var(--os-line)] border-y border-[var(--os-line)]">
              <div className="flex items-center justify-between gap-4 py-3.5">
                <dt className="flex items-center gap-2 text-[13px] text-[var(--os-dim)]">
                  <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
                  Customer debit
                </dt>
                <dd className="os-label text-[var(--os-warn)]">✓ Debited</dd>
              </div>
              <div className="flex items-center justify-between gap-4 py-3.5">
                <dt className="flex items-center gap-2 text-[13px] text-[var(--os-dim)]">
                  <ArrowDownLeft className="h-3.5 w-3.5" aria-hidden />
                  Merchant credit
                </dt>
                <dd className="os-label text-[var(--os-danger)]">✕ Not credited</dd>
              </div>
            </dl>

            <div className="mt-6 space-y-3">
              <div className="rounded-xl border border-[rgba(248,113,113,0.3)] bg-[rgba(248,113,113,0.07)] p-4">
                <p className="os-label text-[var(--os-danger)]">AI status</p>
                <p className="os-mono mt-2 text-[14px] text-[var(--os-text)]">DEBIT/CREDIT MISMATCH</p>
              </div>
              <div className="rounded-xl border border-[var(--os-line)] bg-[var(--os-surface)] p-4">
                <p className="os-label text-[var(--os-faint)]">Action</p>
                <p className="mt-2 text-[14px] text-[var(--os-text)]">Escalate for recovery</p>
              </div>
            </div>
          </div>
        </Reveal>

        {/* The recovery */}
        <Reveal delay={90} className="h-full">
          <div ref={ref} className="os-card os-edge flex h-full flex-col rounded-2xl p-6">
            <p className="os-label text-[var(--os-cyan)]">Recovery sequence</p>

            <ol className="mt-6 flex-1 space-y-1">
              {RECOVERY.map((step, index) => {
                const shown = index < count;
                return (
                  <li key={step.label} className="os-step flex gap-4" data-shown={shown}>
                    <div className="flex flex-col items-center">
                      <span
                        className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border transition"
                        style={{
                          borderColor: shown ? "rgba(52,211,153,0.4)" : "var(--os-line)",
                          color: shown ? "var(--os-success)" : "var(--os-faint)",
                        }}
                      >
                        <step.icon className="h-4 w-4" aria-hidden />
                      </span>
                      {index < RECOVERY.length - 1 ? (
                        <span
                          aria-hidden
                          className="my-1 w-px flex-1 rounded-full transition"
                          style={{ backgroundColor: shown ? "rgba(52,211,153,0.35)" : "var(--os-line)" }}
                        />
                      ) : null}
                    </div>
                    <div className="pb-6">
                      <p className="text-[14px] font-semibold text-[var(--os-text)]">{step.label}</p>
                      <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--os-dim)]">{step.detail}</p>
                    </div>
                  </li>
                );
              })}
            </ol>

            <p className="border-t border-[var(--os-line)] pt-5 text-[12px] leading-relaxed text-[var(--os-faint)]">
              The mismatch, the case and every step above are written to the same audit trail as a successful
              transaction. A failure is a record, not a gap.
            </p>
          </div>
        </Reveal>
      </div>
    </SectionShell>
  );
}
