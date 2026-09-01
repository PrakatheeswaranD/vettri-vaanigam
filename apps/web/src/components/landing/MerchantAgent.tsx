/**
 * The merchant side.
 *
 * Every card carries the same three lines in the same order — REASON,
 * EXPECTED IMPACT, PROPOSED ACTION — because that is the shape of a
 * recommendation a merchant can actually audit. A number without its
 * reason is a guess with confidence, and a proposed action without an
 * expected impact is a chore.
 *
 * Note what the buttons say: these are proposals awaiting a human, and the
 * copy never implies the agent has already acted.
 */
import { ArrowUpRight, Layers, Megaphone, TrendingUp, Check, ArrowRight } from "lucide-react";
import { Reveal, SectionShell, useCardMotion } from "./system";

const OPPORTUNITIES = [
  {
    kind: "Cross-sell",
    icon: Layers,
    accent: "var(--os-cyan)",
    reason: "Customer intent: laptop purchase",
    recommendation: "Extended warranty, 3-year onsite",
    impact: "+₹4,999",
    impactNote: "per accepted attach",
    action: "Attach to checkout as an optional add-on",
    confidence: 74,
  },
  {
    kind: "Upsell",
    icon: TrendingUp,
    accent: "var(--os-blue)",
    reason: "Basket at ₹74,999, config below requested spec ceiling",
    recommendation: "₹79,999 premium bundle",
    impact: "+₹5,000",
    impactNote: "order value uplift",
    action: "Offer the bundle before payment authorization",
    confidence: 87,
  },
  {
    kind: "Campaign insight",
    icon: Megaphone,
    accent: "var(--os-violet)",
    reason: "18% increase in demand for premium configurations",
    recommendation: "Targeted offer to premium-intent segment",
    impact: "+12.4%",
    impactNote: "projected conversion",
    action: "Launch a bounded campaign, capped by policy",
    confidence: 81,
  },
];

export function MerchantAgent() {
  const grid = useCardMotion<HTMLDivElement>();

  return (
    <SectionShell
      id="merchant-agent"
      layout="split"
      eyebrow="Merchant agent"
      title="Every transaction can become a growth opportunity."
      lede="The agent watches live intent and proposes the next commercial move. Reason, expected impact and proposed action — in that order, every time."
    >

      <div ref={grid} className="grid gap-4 lg:grid-cols-3">
        {OPPORTUNITIES.map((item, index) => (
          <Reveal as="article" key={item.kind} delay={index * 80} className="h-full">
            <div className="os-card os-card-hover flex h-full flex-col rounded-2xl p-6">
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2.5">
                  <span
                    className="os-pop grid h-8 w-8 place-items-center rounded-lg border border-[var(--os-line)]"
                    style={{ color: item.accent }}
                  >
                    <item.icon className="h-4 w-4" aria-hidden />
                  </span>
                  <span className="os-label text-[var(--os-dim)]">{item.kind}</span>
                </span>
                <span className="os-mono text-[11px] text-[var(--os-faint)]">{item.confidence}% conf.</span>
              </div>

              <dl className="mt-6 flex-1 space-y-4">
                <div>
                  <dt className="os-label text-[var(--os-faint)]">Reason</dt>
                  <dd className="mt-1.5 text-[13px] leading-relaxed text-[var(--os-dim)]">{item.reason}</dd>
                </div>
                <div>
                  <dt className="os-label text-[var(--os-faint)]">Recommended</dt>
                  <dd className="mt-1.5 text-[13px] leading-relaxed text-[var(--os-text)]">{item.recommendation}</dd>
                </div>
                <div>
                  <dt className="os-label text-[var(--os-faint)]">Expected impact</dt>
                  <dd className="mt-1.5 flex items-baseline gap-2">
                    <span className="os-mono inline-flex items-center gap-1 text-[1.35rem] font-semibold text-[var(--os-success)]">
                      <ArrowUpRight className="h-4 w-4" aria-hidden />
                      {item.impact}
                    </span>
                    <span className="text-[11px] text-[var(--os-faint)]">{item.impactNote}</span>
                  </dd>
                </div>
                <div>
                  <dt className="os-label text-[var(--os-faint)]">Proposed action</dt>
                  <dd className="mt-1.5 text-[13px] leading-relaxed text-[var(--os-dim)]">{item.action}</dd>
                </div>
              </dl>

              <div className="mt-6 border-t border-[var(--os-line)] pt-4">
                <div className="os-meter h-1">
                  <span
                    style={{
                      width: `${item.confidence}%`,
                      backgroundImage: "linear-gradient(90deg, #22d3ee, #8b5cf6)",
                    }}
                  />
                </div>
                <div className="mt-4 flex items-center justify-between gap-3">
                  <span className="flex items-center gap-1.5 text-[11px] text-[var(--os-faint)]">
                    <Check className="h-3.5 w-3.5 text-[var(--os-success)]" aria-hidden />
                    Within policy bounds
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[var(--os-text)]">
                    Review proposal
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                  </span>
                </div>
              </div>
            </div>
          </Reveal>
        ))}
      </div>
    </SectionShell>
  );
}
