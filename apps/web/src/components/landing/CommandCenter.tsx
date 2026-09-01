/**
 * The command centre preview.
 *
 * Three instruments, not twelve: what the agents earned, what is running
 * right now, and how ready this merchant is to be sold through by a
 * machine. A template dashboard would spread nine tiles evenly and say
 * nothing; these three are sized by importance, and the readiness gauge —
 * the only number a merchant can actually act on — gets its own column.
 *
 * The figures are sample data for a test-mode environment and the panel
 * says so in its own header, because an invented number presented as
 * measured would undermine every real number elsewhere in the product.
 */
import { Activity, ArrowUpRight, Bot, Store, Workflow } from "lucide-react";
import { Reveal, SectionShell, StatusDot, useCountUp } from "./system";

const AGENTS = [
  { label: "Buyer Agents", value: 1248, icon: Bot },
  { label: "Merchant Agents", value: 84, icon: Store },
  { label: "Active Flows", value: 327, icon: Workflow },
];

const READINESS = [
  { label: "Catalog accessibility", value: 96 },
  { label: "Checkout readiness", value: 91 },
  { label: "Policy coverage", value: 94 },
  { label: "Payment reliability", value: 89 },
];

function AgentCounter({ label, value, icon: Icon }: { label: string; value: number; icon: typeof Bot }) {
  const { value: shown, ref } = useCountUp(value);
  return (
    <div ref={ref} className="rounded-xl border border-[var(--os-line)] bg-[var(--os-surface)] p-4">
      <span className="flex items-center gap-2 text-[var(--os-faint)]">
        <Icon className="h-3.5 w-3.5" aria-hidden />
        <span className="os-label">{label}</span>
      </span>
      <p className="os-mono mt-3 text-2xl font-semibold text-[var(--os-text)]">{shown.toLocaleString("en-IN")}</p>
    </div>
  );
}

/** The readiness gauge. An arc rather than a bar: it is a score out of a
 * fixed maximum, and an arc reads as "out of" without a legend. */
function ReadinessGauge({ score }: { score: number }) {
  const { value, ref } = useCountUp(score);
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const filled = (value / 100) * circumference;

  return (
    <div ref={ref} className="flex flex-col items-center">
      <div className="relative h-[136px] w-[136px]">
        <svg viewBox="0 0 128 128" className="h-full w-full -rotate-90" aria-hidden>
          <circle cx="64" cy="64" r={radius} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="8" />
          <defs>
            <linearGradient id="os-readiness" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#22d3ee" />
              <stop offset="100%" stopColor="#8b5cf6" />
            </linearGradient>
          </defs>
          <circle
            cx="64"
            cy="64"
            r={radius}
            fill="none"
            stroke="url(#os-readiness)"
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={`${filled} ${circumference}`}
          />
        </svg>
        <div className="absolute inset-0 grid place-items-center">
          <p className="os-mono text-3xl font-semibold text-[var(--os-text)]">{value}</p>
          <p className="os-label absolute bottom-7 text-[var(--os-faint)]">score</p>
        </div>
      </div>
      <p className="os-label mt-2 text-[var(--os-dim)]">Agentic readiness</p>
    </div>
  );
}

export function CommandCenter() {
  const revenue = useCountUp(2.84, 2);
  const uplift = useCountUp(18.6, 1);

  return (
    <SectionShell
      id="command-center"
      layout="stack"
      eyebrow="Command center"
      title="One command center for autonomous commerce."
      lede="Revenue the agents created, the fleet currently transacting, and whether this storefront is actually ready to be bought from by a machine."
    >

      <Reveal>
        <div className="os-card os-edge overflow-hidden rounded-3xl">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--os-line)] px-5 py-3.5">
            <p className="os-label flex items-center gap-2 text-[var(--os-faint)]">
              <StatusDot tone="success" />
              Live control surface
            </p>
            <p className="os-mono text-[11px] text-[var(--os-faint)]">sample data · razorpay test mode</p>
          </div>

          <div className="grid gap-px bg-[var(--os-line)] lg:grid-cols-[1.15fr_1fr_0.9fr]">
            {/* Revenue opportunity */}
            <div ref={revenue.ref} className="bg-[rgba(8,11,18,0.6)] p-6">
              <p className="os-label flex items-center gap-2 text-[var(--os-faint)]">
                <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
                Revenue opportunity
              </p>
              <p className="os-mono mt-4 text-[2.75rem] font-semibold leading-none text-[var(--os-text)]">
                ₹{revenue.value.toFixed(2)}L
              </p>
              <p className="mt-3 text-[13px] leading-relaxed text-[var(--os-dim)]">
                Potential recovered / generated revenue
              </p>
              <p
                ref={uplift.ref}
                className="os-mono mt-4 inline-flex items-center gap-1.5 rounded-lg border border-[rgba(52,211,153,0.3)] bg-[rgba(52,211,153,0.08)] px-2.5 py-1.5 text-[13px] text-[var(--os-success)]"
              >
                <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
                {uplift.value.toFixed(1)}%
              </p>
            </div>

            {/* Active agents */}
            <div className="bg-[rgba(8,11,18,0.6)] p-6">
              <p className="os-label flex items-center gap-2 text-[var(--os-faint)]">
                <Activity className="h-3.5 w-3.5" aria-hidden />
                Active agents
              </p>
              <div className="mt-4 grid gap-2.5">
                {AGENTS.map((agent) => (
                  <AgentCounter key={agent.label} {...agent} />
                ))}
              </div>
            </div>

            {/* Readiness */}
            <div className="bg-[rgba(8,11,18,0.6)] p-6">
              <ReadinessGauge score={92} />
              <ul className="mt-6 space-y-3">
                {READINESS.map((item) => (
                  <li key={item.label}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-[12px] text-[var(--os-dim)]">{item.label}</span>
                      <span className="os-mono text-[12px] text-[var(--os-text)]">{item.value}</span>
                    </div>
                    <div className="os-meter mt-1.5 h-1">
                      <span
                        style={{
                          width: `${item.value}%`,
                          backgroundImage: "linear-gradient(90deg, #22d3ee, #8b5cf6)",
                        }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </Reveal>
    </SectionShell>
  );
}
