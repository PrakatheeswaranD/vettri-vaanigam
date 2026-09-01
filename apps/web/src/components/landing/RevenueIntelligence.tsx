/**
 * Revenue intelligence.
 *
 * One chart, four headline figures, three supporting ratios. The
 * temptation in this section is a wall of tiles; the discipline is that a
 * merchant reads a page like this to answer one question — did the agents
 * make me money — so the trend line answers it first and everything else
 * qualifies the answer.
 *
 * The line draws itself once when the section scrolls into view, and the
 * numbers count up alongside it. Both settle instantly under reduced
 * motion.
 */
import { ArrowUpRight, TrendingUp } from "lucide-react";
import { Reveal, SectionShell, useCountUp, useReveal } from "./system";

/** Twelve periods of agent-assisted revenue, in lakhs. */
const SERIES = [6.2, 6.8, 6.5, 7.4, 8.1, 8.6, 9.4, 10.8, 11.6, 13.2, 15.1, 18.4];

const HEADLINES = [
  { label: "Revenue impact", value: 18.4, suffix: "L", prefix: "₹", delta: "+24.8%", decimals: 1 },
  { label: "AI-assisted conversions", value: 31, suffix: "%", prefix: "+", delta: "vs. baseline", decimals: 0 },
  { label: "Upsell revenue", value: 4.82, suffix: "L", prefix: "₹", delta: "+18.2%", decimals: 2 },
  { label: "Recovered revenue", value: 2.14, suffix: "L", prefix: "₹", delta: "+9.6%", decimals: 2 },
];

const RATIOS = [
  { label: "Conversion rate", value: "4.8%", note: "up from 3.7%" },
  { label: "Average order value", value: "₹68,420", note: "up ₹5,140" },
  { label: "Abandoned checkout", value: "11.2%", note: "down from 17.4%" },
];

function Headline({ item }: { item: (typeof HEADLINES)[number] }) {
  const { value, ref } = useCountUp(item.value, item.decimals);
  return (
    <div ref={ref} className="rounded-xl border border-[var(--os-line)] bg-[var(--os-surface)] p-5">
      <p className="os-label text-[var(--os-faint)]">{item.label}</p>
      <p className="os-mono mt-3 text-[1.75rem] font-semibold leading-none text-[var(--os-text)]">
        {item.prefix}
        {value.toFixed(item.decimals)}
        {item.suffix}
      </p>
      <p className="mt-2.5 inline-flex items-center gap-1 text-[12px] text-[var(--os-success)]">
        <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
        {item.delta}
      </p>
    </div>
  );
}

/** A 12-point area chart, drawn by hand. A charting library for one
 * sparkline-scale series would be several hundred kilobytes to draw
 * eleven line segments. */
function TrendChart() {
  const ref = useReveal<HTMLDivElement>();
  const width = 720;
  const height = 200;
  const max = Math.max(...SERIES) * 1.08;
  const min = Math.min(...SERIES) * 0.75;

  const points = SERIES.map((value, index) => {
    const x = (index / (SERIES.length - 1)) * width;
    const y = height - ((value - min) / (max - min)) * height;
    return [x, y] as const;
  });

  const line = points.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${width},${height} L0,${height} Z`;
  // Rough path length: enough for the dash animation to look right without
  // measuring the DOM.
  const length = Math.round(width * 1.6);

  return (
    <div ref={ref} className="os-reveal">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="os-label flex items-center gap-2 text-[var(--os-faint)]">
          <TrendingUp className="h-3.5 w-3.5" aria-hidden />
          Agent-assisted revenue · 12 periods
        </p>
        <p className="os-mono text-[11px] text-[var(--os-faint)]">sample data · test mode</p>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="mt-5 h-[180px] w-full sm:h-[220px]"
        role="img"
        aria-label="Agent-assisted revenue rising from ₹6.2 lakh to ₹18.4 lakh across twelve periods"
      >
        <defs>
          <linearGradient id="os-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="os-line" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#3b82f6" />
            <stop offset="60%" stopColor="#22d3ee" />
            <stop offset="100%" stopColor="#8b5cf6" />
          </linearGradient>
        </defs>

        {[0.25, 0.5, 0.75].map((fraction) => (
          <line
            key={fraction}
            x1="0"
            x2={width}
            y1={height * fraction}
            y2={height * fraction}
            stroke="rgba(255,255,255,0.06)"
            strokeWidth="1"
          />
        ))}

        <path className="os-area" d={area} fill="url(#os-area)" />
        <path
          className="os-draw"
          d={line}
          fill="none"
          stroke="url(#os-line)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          style={{ ["--os-len" as string]: length }}
        />
      </svg>
    </div>
  );
}

export function RevenueIntelligence() {
  return (
    <SectionShell
      id="revenue"
      layout="stack"
      eyebrow="Revenue intelligence"
      title="Turn every interaction into measurable growth."
      lede="Agent activity is only worth governing if it is worth having. These are the figures a merchant checks before deciding that it is."
    >

      <Reveal>
        <div className="os-card rounded-2xl p-6 sm:p-8">
          <TrendChart />

          <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {HEADLINES.map((item) => (
              <Headline key={item.label} item={item} />
            ))}
          </div>

          <dl className="mt-6 grid gap-x-8 gap-y-4 border-t border-[var(--os-line)] pt-6 sm:grid-cols-3">
            {RATIOS.map((ratio) => (
              <div key={ratio.label} className="flex items-baseline justify-between gap-3 sm:block">
                <dt className="os-label text-[var(--os-faint)]">{ratio.label}</dt>
                <dd className="sm:mt-2">
                  <span className="os-mono text-[15px] font-semibold text-[var(--os-text)]">{ratio.value}</span>
                  <span className="ml-2 text-[11px] text-[var(--os-faint)]">{ratio.note}</span>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </Reveal>
    </SectionShell>
  );
}
