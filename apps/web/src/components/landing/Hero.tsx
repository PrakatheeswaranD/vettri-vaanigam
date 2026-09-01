/**
 * The first ten seconds.
 *
 * The headline states the offer and its catch — sell to autonomous
 * buyers, without handing them the credentials — and the network
 * underneath shows that catch being enforced; the telemetry strip along the bottom is the system
 * talking while you read. A reader who never scrolls should still leave
 * with the three things that matter: an agent proposed, a policy decided,
 * and a payment was authorised in test mode with an audit trail behind it.
 *
 * The strip is a marquee of the calls the gate actually makes, in the
 * gate's own vocabulary. It is the cheapest way to make a static page feel
 * like a running system, and it stops moving entirely under reduced
 * motion — where it becomes a plain, readable row of the same events.
 */
import { Fragment } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, PlayCircle } from "lucide-react";
import { AgentNetwork } from "./AgentNetwork";
import { useMagnetic, useParallax, usePointerGlow, usePrefersReducedMotion } from "./system";

const TRUST = ["Razorpay Test Mode", "Policy-Governed", "Fully Auditable"];

const TELEMETRY: { call: string; result: string; tone: "ok" | "flag" }[] = [
  { call: "intent.parse", result: "4 constraints", tone: "ok" },
  { call: "catalog.query", result: "4 merchants", tone: "ok" },
  { call: "offer.reprice", result: "verified ₹74,999", tone: "ok" },
  { call: "mandate.verify", result: "signature valid", tone: "ok" },
  { call: "policy.evaluate", result: "within limit", tone: "ok" },
  { call: "risk.score", result: "low", tone: "ok" },
  { call: "payment.authorize", result: "₹74,999", tone: "ok" },
  { call: "ledger.append", result: "seq 1042", tone: "ok" },
  { call: "reconcile.check", result: "debit/credit matched", tone: "flag" },
];

function TelemetryStrip() {
  const reduced = usePrefersReducedMotion();

  const row = (
    <ul className="flex shrink-0 items-center" aria-hidden={!reduced}>
      {TELEMETRY.map((event) => (
        <li key={event.call} className="flex items-center gap-2.5 whitespace-nowrap px-5">
          <span
            className="h-1 w-1 rounded-full"
            style={{ backgroundColor: event.tone === "ok" ? "var(--os-success)" : "var(--os-warn)" }}
          />
          <span className="os-mono text-[11px] text-[var(--os-dim)]">{event.call}</span>
          <span className="os-mono text-[11px] text-[var(--os-faint)]">→ {event.result}</span>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="os-ticker mt-3 overflow-hidden rounded-xl border border-[var(--os-line)] bg-[rgba(8,11,18,0.5)] py-2.5">
      {reduced ? (
        <div className="flex flex-wrap justify-center gap-y-2 px-2">{row}</div>
      ) : (
        // Two copies, translated by exactly half the track: the loop has no
        // seam and no JavaScript.
        <div className="os-ticker-track">
          {row}
          {row}
        </div>
      )}
    </div>
  );
}

export function Hero() {
  const glowRef = usePointerGlow<HTMLDivElement>();
  const primaryRef = useMagnetic<HTMLAnchorElement>(5);
  const depthRef = useParallax<HTMLDivElement>(0.045);

  return (
    <div id="top" ref={glowRef} className="relative">
      <div aria-hidden className="os-cursor-glow pointer-events-none absolute inset-0 -z-10" />

      <div className="mx-auto w-full max-w-6xl px-5 pb-16 pt-28 sm:pb-20 sm:pt-32">
        <div className="mx-auto max-w-3xl text-center">
          <span className="os-chip animate-rise-in">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[var(--os-cyan)]" />
            AI-native commerce infrastructure
          </span>

          {/* THE HEADLINE
              "Commerce, built for AI." named the category and claimed
              nothing. This one states the offer and the catch in the same
              breath: a merchant can be sold through by autonomous buyers
              WITHOUT handing them the credentials, which is the only
              reason this product needs to exist. Six words, and both
              halves are falsifiable by the rest of the page.

              Mechanically: each word arrives rotated back on the X axis
              rather than merely faded, so the line assembles in space. The
              gradient has to sit on EACH word rather than on a wrapper —
              `background-clip: text` cannot paint through a transformed
              descendant, and a wrapper gradient rendered the whole second
              line invisible for exactly that reason. Continuity is
              restored by giving every word the same oversized gradient and
              stepping its background-position, so one sweep still crosses
              the line. The gaps are REAL SPACES between the spans rather
              than margins: an inline-block per word with margin renders
              identically and reads back as "SelltoAIagents." to a screen
              reader, and copies that way too. */}
          <h1
            className="os-display mt-7 text-balance text-[2.85rem] leading-[0.98] sm:text-[4.5rem]"
            style={{ perspective: "700px" }}
          >
            {["Sell", "to", "AI", "agents."].map((word, index, words) => (
              <Fragment key={word}>
                <span className="os-word" style={{ animationDelay: `${60 + index * 70}ms` }}>
                  {word}
                </span>
                {index < words.length - 1 ? " " : null}
              </Fragment>
            ))}
            <br />
            {["Keep", "the", "keys."].map((word, index, words) => (
              <Fragment key={word}>
                <span
                  className="os-word os-gradient-text"
                  style={{
                    animationDelay: `${380 + index * 90}ms`,
                    backgroundSize: "300% 100%",
                    backgroundPosition: `${index * 50}% 0`,
                  }}
                >
                  {word}
                </span>
                {index < words.length - 1 ? " " : null}
              </Fragment>
            ))}
          </h1>

          <p
            className="mx-auto mt-7 max-w-2xl animate-rise-in text-pretty text-[17px] leading-relaxed text-[var(--os-dim)]"
            style={{ animationDelay: "120ms" }}
          >
            Let AI discover, decide, and transact — while every money action remains governed, explainable, and
            auditable.
          </p>

          <div
            className="mt-9 flex animate-rise-in flex-col items-center justify-center gap-3 sm:flex-row"
            style={{ animationDelay: "180ms" }}
          >
            <Link ref={primaryRef} to="/login" className="os-btn os-btn-primary group w-full sm:w-auto">
              Get Started
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
            </Link>
            <a href="#demo" className="os-btn os-btn-ghost w-full sm:w-auto">
              <PlayCircle className="h-4 w-4" aria-hidden />
              Watch the Agent Flow
            </a>
          </div>

          <ul
            className="mt-8 flex animate-rise-in flex-wrap items-center justify-center gap-x-3 gap-y-2 text-[12px] text-[var(--os-faint)]"
            style={{ animationDelay: "240ms" }}
          >
            {TRUST.map((item, index) => (
              <li key={item} className="flex items-center gap-3">
                {index > 0 ? <span aria-hidden className="h-1 w-1 rounded-full bg-[var(--os-line-2)]" /> : null}
                {item}
              </li>
            ))}
          </ul>
        </div>

        {/* Two wrappers on purpose: the outer one carries the scroll
            parallax (an inline transform), the inner one the entrance
            animation. A `both`-filled animation keeps applying its own
            transform after it ends, so sharing one element would let the
            entrance permanently win over the parallax. */}
        <div ref={depthRef} className="mt-14">
          <div className="animate-rise-in" style={{ animationDelay: "260ms" }}>
            <AgentNetwork />
            <TelemetryStrip />
          </div>
        </div>
      </div>
    </div>
  );
}
