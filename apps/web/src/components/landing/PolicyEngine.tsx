/**
 * The policy engine, shown as an evaluation rather than a promise.
 *
 * Four inputs, one verdict, and the utilisation bar underneath so the
 * headroom is visible rather than asserted. The point of the layout is
 * that nothing here is a model output: every cell is a comparison a
 * reader could redo by hand and get the same answer.
 */
import { BadgeCheck, Check, Gauge, ShieldAlert, Wallet } from "lucide-react";
import { Reveal, SectionShell } from "./system";

const AMOUNT = 74999;
const LIMIT = 100000;

const INPUTS = [
  { label: "Purchase amount", value: "₹74,999", icon: Wallet, tone: "neutral" as const },
  { label: "User limit", value: "₹1,00,000", icon: Gauge, tone: "neutral" as const },
  { label: "Merchant status", value: "Verified", icon: BadgeCheck, tone: "success" as const },
  { label: "Risk level", value: "Low", icon: ShieldAlert, tone: "success" as const },
];

export function PolicyEngine() {
  const utilisation = Math.round((AMOUNT / LIMIT) * 100);

  return (
    <SectionShell
      id="policy"
      layout="split"
      eyebrow="Policy engine"
      title="Autonomy with boundaries."
      lede="The same function that produces the verdict produces the sentence explaining it. No sampling, no temperature, no judgement call."
    >

      <Reveal>
        <div className="os-card os-edge rounded-2xl p-6 sm:p-8">
          <div className="grid gap-3 lg:grid-cols-[repeat(4,minmax(0,1fr))_auto] lg:items-stretch">
            {INPUTS.map((input) => (
              <div key={input.label} className="rounded-xl border border-[var(--os-line)] bg-[var(--os-surface)] p-4">
                <p className="os-label flex items-center gap-2 text-[var(--os-faint)]">
                  <input.icon className="h-3.5 w-3.5" aria-hidden />
                  {input.label}
                </p>
                <p
                  className={`os-mono mt-3 text-[1.25rem] font-semibold ${
                    input.tone === "success" ? "text-[var(--os-success)]" : "text-[var(--os-text)]"
                  }`}
                >
                  {input.value}
                </p>
              </div>
            ))}

            <div className="flex items-center justify-center rounded-xl border border-[rgba(52,211,153,0.35)] bg-[rgba(52,211,153,0.08)] px-6 py-5">
              <p className="flex items-center gap-2.5 text-[var(--os-success)]">
                <Check className="h-5 w-5" aria-hidden />
                <span className="os-label text-[13px] tracking-[0.14em]">Approved</span>
              </p>
            </div>
          </div>

          <div className="mt-7">
            <div className="flex items-baseline justify-between gap-3">
              <p className="os-label text-[var(--os-faint)]">Limit utilisation</p>
              <p className="os-mono text-[12px] text-[var(--os-dim)]">
                ₹74,999 of ₹1,00,000 · {utilisation}%
              </p>
            </div>
            <div className="os-meter mt-2 h-1.5">
              <span
                style={{ width: `${utilisation}%`, backgroundImage: "linear-gradient(90deg, #22d3ee, #34d399)" }}
              />
            </div>
          </div>

          <p className="os-display mt-8 border-t border-[var(--os-line)] pt-7 text-[17px] tracking-[-0.02em] text-[var(--os-text)]">
            AI can recommend. <span className="os-gradient-text">Deterministic policy decides.</span>
          </p>
        </div>
      </Reveal>
    </SectionShell>
  );
}
