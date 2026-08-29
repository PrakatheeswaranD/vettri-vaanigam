/**
 * The signature visual for Anumati's headline differentiator
 * (PART 00 §18) — a circular progress ring around the Agentic Readiness
 * score, replacing a plain number-in-a-box. Purely presentational: the
 * score, tone, and label all come from the real deterministic readiness
 * engine — this component never computes or guesses a value.
 */
function toneColor(score: number): { stroke: string; text: string } {
  if (score >= 85) return { stroke: "rgb(var(--color-success, 22 163 74))", text: "text-success-text" };
  if (score >= 70) return { stroke: "rgb(var(--color-warning, 217 119 6))", text: "text-warning-text" };
  return { stroke: "rgb(var(--color-danger, 220 38 38))", text: "text-danger-text" };
}

export function ScoreRing({ score, size = 128 }: { score: number; size?: number }) {
  const clamped = Math.max(0, Math.min(100, score));
  const strokeWidth = size * 0.09;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped / 100);
  const tone = toneColor(clamped);

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={strokeWidth} className="stroke-border" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          stroke="#16a34a"
          style={{ stroke: tone.stroke, strokeDasharray: circumference, strokeDashoffset: offset, transition: "stroke-dashoffset 0.6s ease-out" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold tabular-nums leading-none text-ink">{clamped}</span>
        <span className="mt-0.5 text-[11px] text-ink-faint">out of 100</span>
      </div>
    </div>
  );
}
