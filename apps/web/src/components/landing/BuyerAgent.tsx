/**
 * The buyer side.
 *
 * WHY THIS DOES NOT LOOK LIKE A CHAT
 *
 * The interesting thing an agent does for a shopper is not the sentence
 * it writes, it is the comparison behind the sentence. A bubble UI hides
 * that behind prose and invites the reader to file the whole product under
 * "chatbot". So the intent is a parsed request with its constraints
 * visible, the answer is a recommendation record, and the reasoning is a
 * table — three named criteria, each with the runner-up it beat.
 *
 * Everything here is one worked example rather than a feature list: the
 * shopper asked for a development laptop under ₹80,000, and this is what
 * came back.
 */
import { ArrowRight, Check, GitCompare, Sparkles, Cpu, ShieldCheck, Wallet } from "lucide-react";
import { Reveal, SectionShell } from "./system";

const CONSTRAINTS = ["Budget ≤ ₹80,000", "Use: software development", "Portable", "Warranty required"];

const SPECS = ["16GB RAM", "1TB SSD", "Developer optimized"];

const REASONS = [
  {
    icon: Cpu,
    criterion: "Performance",
    finding: "Sustained multi-core throughput clears the compile workload with headroom.",
    beat: "Beat the ₹71,499 option, which throttles under load.",
  },
  {
    icon: ShieldCheck,
    criterion: "Warranty",
    finding: "3-year onsite cover, no separate purchase required.",
    beat: "The cheaper alternative carries 1 year, carry-in.",
  },
  {
    icon: Wallet,
    criterion: "Total cost",
    finding: "₹74,999 all-in — nothing essential left to buy afterwards.",
    beat: "The ₹79,999 bundle added storage the request did not ask for.",
  },
];

export function BuyerAgent() {
  return (
    <SectionShell
      id="buyer-agent"
      layout="split"
      eyebrow="Buyer agent"
      title="Shopping becomes a conversation."
      lede="One instruction in plain language, and a defensible recommendation out — with the comparison that produced it left open for inspection."
    >

      <div className="grid gap-4 lg:grid-cols-[0.85fr_1.15fr]">
        {/* The request */}
        <Reveal className="h-full">
          <div className="os-card flex h-full flex-col rounded-2xl p-6">
            <p className="os-label text-[var(--os-cyan)]">User intent confirmed</p>
            <p className="mt-4 text-pretty text-[17px] leading-relaxed text-[var(--os-text)]">
              “I need a laptop for development, under ₹80,000.”
            </p>

            <p className="os-label mt-7 text-[var(--os-faint)]">Parsed constraints</p>
            <ul className="mt-3 flex flex-wrap gap-2">
              {CONSTRAINTS.map((constraint) => (
                <li
                  key={constraint}
                  className="rounded-lg border border-[var(--os-line)] bg-[var(--os-surface)] px-2.5 py-1.5 text-[12px] text-[var(--os-dim)]"
                >
                  {constraint}
                </li>
              ))}
            </ul>

            <div className="mt-auto flex items-center gap-2 pt-8 text-[12px] text-[var(--os-faint)]">
              <Sparkles className="h-3.5 w-3.5 text-[var(--os-cyan)]" aria-hidden />
              4 compatible options found across verified merchants
            </div>
          </div>
        </Reveal>

        {/* The answer */}
        <Reveal delay={90} className="h-full">
          <div className="os-card os-edge flex h-full flex-col rounded-2xl p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="os-label text-[var(--os-faint)]">Recommended</p>
                <p className="mt-2 text-[20px] font-semibold tracking-tight text-[var(--os-text)]">Acer Swift X</p>
                <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
                  {SPECS.map((spec) => (
                    <li key={spec} className="flex items-center gap-1.5 text-[12px] text-[var(--os-dim)]">
                      <Check className="h-3.5 w-3.5 text-[var(--os-success)]" aria-hidden />
                      {spec}
                    </li>
                  ))}
                </ul>
              </div>
              <p className="os-mono text-[1.75rem] font-semibold leading-none text-[var(--os-text)]">₹74,999</p>
            </div>

            <p className="os-label mt-7 text-[var(--os-faint)]">Why this one</p>
            <ul className="mt-3 divide-y divide-[var(--os-line)] border-y border-[var(--os-line)]">
              {REASONS.map((reason) => (
                <li key={reason.criterion} className="flex gap-3.5 py-3.5">
                  <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-[var(--os-line)] text-[var(--os-blue)]">
                    <reason.icon className="h-3.5 w-3.5" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-[var(--os-text)]">{reason.criterion}</p>
                    <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--os-dim)]">{reason.finding}</p>
                    <p className="mt-1 text-[12px] leading-relaxed text-[var(--os-faint)]">{reason.beat}</p>
                  </div>
                </li>
              ))}
            </ul>

            <div className="mt-6 flex flex-col gap-2.5 sm:flex-row">
              <button type="button" className="os-btn os-btn-ghost w-full sm:w-auto">
                <GitCompare className="h-4 w-4" aria-hidden />
                Compare all 4
              </button>
              <button type="button" className="os-btn os-btn-primary group w-full sm:w-auto">
                Buy — ₹74,999
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
              </button>
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-[var(--os-faint)]">
              Buying from here still passes the policy engine before any authorization is requested.
            </p>
          </div>
        </Reveal>
      </div>
    </SectionShell>
  );
}
