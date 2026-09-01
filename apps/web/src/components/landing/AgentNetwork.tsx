/**
 * The AI commerce network — the hero's centrepiece.
 *
 * WHAT IT IS
 *
 * A replay of one transaction crossing four participants, in the order
 * the system actually crosses them: BUYER AGENT → POLICY ENGINE →
 * MERCHANT AGENT → PAYMENT. One stage is live at a time; the wire feeding
 * the live stage carries a light packet, and every stage behind it stays
 * on screen in its settled state. Nothing disappears, so the whole chain
 * is readable at any moment of the loop.
 *
 * THE THIRD DIMENSION IS DOING A JOB
 *
 * The stage has real perspective: the live participant translates toward
 * the viewer, the ones still waiting sit back behind the plane, and the
 * whole stage leans a few degrees toward the pointer. Depth encodes the
 * SAME state as the accent border, so it is redundant rather than
 * load-bearing — which is what lets it flatten completely under reduced
 * motion, or on a touch device, without any information being lost.
 *
 * WHY NOT AN SVG SCENE
 *
 * Because it has to survive a phone. Node cards are real DOM in a grid, so
 * on a narrow screen they stack vertically with the wires rotating to
 * match, text reflows instead of scaling into illegibility, and screen
 * readers get an ordered list of four labelled steps rather than a picture.
 * A hand-placed SVG scene would have needed a second implementation for
 * mobile and would have said nothing to assistive tech.
 */
import { useEffect, useState } from "react";
import { Bot, CheckCircle2, Circle, CreditCard, ShieldCheck, Store } from "lucide-react";
import { StatusDot, usePrefersReducedMotion, useSequence, useTilt } from "./system";

const POLICY_CHECKS = [
  "Intent validated",
  "Merchant approved",
  "Spending limit checked",
  "Risk policy passed",
  "Payment authorized",
];

type Stage = 0 | 1 | 2 | 3;

const NODES: {
  key: string;
  label: string;
  icon: typeof Bot;
  accent: string;
}[] = [
  { key: "buyer", label: "Buyer Agent", icon: Bot, accent: "var(--os-cyan)" },
  { key: "policy", label: "Policy Engine", icon: ShieldCheck, accent: "var(--os-violet)" },
  { key: "merchant", label: "Merchant Agent", icon: Store, accent: "var(--os-blue)" },
  { key: "payment", label: "Payment", icon: CreditCard, accent: "var(--os-success)" },
];

function NodeFrame({
  index,
  stage,
  children,
}: {
  index: Stage;
  stage: number;
  children: React.ReactNode;
}) {
  // `NODES[index]` under `noUncheckedIndexedAccess`: the index type is the
  // literal union of the four positions, so this is total, but the
  // compiler cannot see that through the array.
  const node = NODES[index] as (typeof NODES)[number];
  const active = stage === index;
  const done = stage > index;
  const Icon = node.icon;
  // A shallow arc: the outer nodes turn slightly inward, so the row reads
  // as a curved stage rather than four flat cards at different depths.
  const arc = [6, 2, -2, -6][index] ?? 0;

  return (
    <li
      className="os-card os-node flex h-full flex-col rounded-2xl p-4"
      data-active={active}
      data-done={done}
      aria-current={active ? "step" : undefined}
      style={{ ["--os-nry" as string]: `${arc}deg` }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <span
            className="os-pop grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-[var(--os-line)]"
            style={{ color: node.accent, backgroundColor: active ? "rgba(255,255,255,0.06)" : "transparent" }}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden />
          </span>
          <span className="os-label truncate text-[var(--os-dim)]">{node.label}</span>
        </span>
        {active ? <StatusDot tone="cyan" /> : done ? <StatusDot tone="success" pulse={false} /> : null}
      </div>
      <div className="mt-3.5 flex-1">{children}</div>
    </li>
  );
}

/** The connector between two nodes. Horizontal on desktop, vertical when
 * the grid stacks — the same element, rotated by class. */
function Wire({ live, settled }: { live: boolean; settled: boolean }) {
  const opacity = settled ? "opacity-100" : "opacity-40";
  return (
    <li aria-hidden className="flex items-center justify-center py-1 lg:py-0">
      {/* Two elements rather than one with overrides: the vertical wire is
          the stacked layout's, the horizontal one the desktop layout's,
          and each keeps its own packet animation. */}
      <span className={`os-wire os-wire-v relative h-8 w-px overflow-hidden rounded-full lg:hidden ${opacity}`}>
        {live ? <span className="os-packet os-packet-v" /> : null}
      </span>
      <span className={`os-wire relative hidden h-px w-full overflow-hidden rounded-full lg:block ${opacity}`}>
        {live ? <span className="os-packet" /> : null}
      </span>
    </li>
  );
}

export function AgentNetwork() {
  const stage = useSequence(NODES.length, 1900, 2) as number;
  const reduced = usePrefersReducedMotion();
  const stageRef = useTilt<HTMLOListElement>(3.5);
  const [checks, setChecks] = useState(reduced ? POLICY_CHECKS.length : 0);

  // The policy engine ticks its five checks off while it holds the floor.
  useEffect(() => {
    if (reduced) {
      setChecks(POLICY_CHECKS.length);
      return;
    }
    if (stage < 1) {
      setChecks(0);
      return;
    }
    if (stage > 1) {
      setChecks(POLICY_CHECKS.length);
      return;
    }
    setChecks(0);
    const id = window.setInterval(() => setChecks((n) => (n >= POLICY_CHECKS.length ? n : n + 1)), 260);
    return () => window.clearInterval(id);
  }, [stage, reduced]);

  return (
    <div className="os-card os-edge os-stage relative rounded-3xl p-4 sm:p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <p className="os-label flex items-center gap-2 text-[var(--os-faint)]">
          <StatusDot tone="cyan" />
          Agent network · transaction replay
        </p>
        <p className="os-mono text-[11px] text-[var(--os-faint)]">session_8f21 · test mode</p>
      </div>

      <ol
        ref={stageRef}
        className="os-stage-inner grid gap-1 lg:grid-cols-[1fr_3rem_1fr_3rem_1fr_3rem_1fr] lg:items-stretch lg:gap-2"
      >
        <NodeFrame index={0} stage={stage}>
          <p className="os-label text-[var(--os-cyan)]">Intent detected</p>
          <p className="mt-2 text-[13px] leading-relaxed text-[var(--os-text)]">
            “Find the best laptop under ₹80,000”
          </p>
          <p className="mt-2 os-mono text-[11px] text-[var(--os-faint)]">
            {stage === 0 ? <span className="os-blink">searching merchants…</span> : "4 merchants matched"}
          </p>
        </NodeFrame>

        <Wire live={stage === 1} settled={stage >= 1} />

        <NodeFrame index={1} stage={stage}>
          {/* Pending checks stay on the page in a dimmed state rather than
              being invisible until their turn: an empty box for two
              seconds of every loop reads as a broken panel, and the list
              of what WILL be checked is itself part of the argument. */}
          <ul className="space-y-1.5">
            {POLICY_CHECKS.map((check, index) => {
              const passed = index < checks;
              return (
                <li
                  key={check}
                  className={`flex items-center gap-2 text-[12px] leading-snug transition-colors duration-300 ${
                    passed ? "text-[var(--os-dim)]" : "text-[var(--os-faint)] opacity-55"
                  }`}
                >
                  {passed ? (
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[var(--os-success)]" aria-hidden />
                  ) : (
                    <Circle className="h-3.5 w-3.5 shrink-0 text-[var(--os-line-2)]" aria-hidden />
                  )}
                  {check}
                </li>
              );
            })}
          </ul>
        </NodeFrame>

        <Wire live={stage === 2} settled={stage >= 2} />

        <NodeFrame index={2} stage={stage}>
          <p className="os-label text-[var(--os-blue)]">Revenue opportunity detected</p>
          <p className="mt-2 text-[13px] leading-relaxed text-[var(--os-text)]">
            +12.4% conversion potential
          </p>
          <p className="mt-2 text-[12px] leading-relaxed text-[var(--os-dim)]">
            Recommended: <span className="text-[var(--os-text)]">Premium Bundle</span>
            <span className="os-mono"> ₹74,999</span>
          </p>
        </NodeFrame>

        <Wire live={stage === 3} settled={stage >= 3} />

        <NodeFrame index={3} stage={stage}>
          <p className="os-mono text-2xl font-semibold tracking-tight text-[var(--os-text)]">₹74,999</p>
          <p className={`os-label mt-2 ${stage >= 3 ? "text-[var(--os-success)]" : "text-[var(--os-faint)]"}`}>
            {stage >= 3 ? "Authorized" : "Awaiting policy"}
          </p>
          <p className="mt-2 os-mono text-[11px] text-[var(--os-faint)]">razorpay · test mode</p>
        </NodeFrame>
      </ol>
    </div>
  );
}
