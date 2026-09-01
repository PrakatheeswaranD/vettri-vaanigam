/**
 * The trust layer, end to end.
 *
 * One row, read left to right: where a request starts, every gate it
 * passes, and where it is finally written down. The two agents share a
 * cell because they are peers on the same step — the buyer proposing and
 * the merchant responding — and flattening them into the chain would
 * imply an ordering that does not exist.
 */
import { Brain, Bot, Store, Target, Scale, ShieldAlert, KeyRound, CreditCard, FileLock2, ChevronRight } from "lucide-react";
import { Reveal, SectionShell, useScrollTilt } from "./system";

const CHAIN = [
  { label: "AI", icon: Brain, note: "Reasoning" },
  { label: "Agents", icon: Bot, note: "Buyer · Merchant", second: Store },
  { label: "Intent", icon: Target, note: "Structured" },
  { label: "Policy", icon: Scale, note: "Deterministic" },
  { label: "Risk", icon: ShieldAlert, note: "Scored" },
  { label: "Authorization", icon: KeyRound, note: "Bounded" },
  { label: "Razorpay", icon: CreditCard, note: "Test mode" },
  { label: "Audit", icon: FileLock2, note: "Hash-chained" },
];

const BADGES = ["Explainable", "Bounded", "Auditable", "Deterministic", "Test Mode"];

export function TrustArchitecture() {
  // The chain lies back and straightens as it rises through the viewport,
  // so it arrives as a ribbon and settles into a row. Scroll position
  // drives the angle directly — no easing curve to fall out of sync with
  // where the reader actually is.
  const ribbon = useScrollTilt<HTMLOListElement>(15);

  return (
    <SectionShell
      id="trust-layer"
      layout="stack"
      eyebrow="Trust architecture"
      title="Nothing reaches the money without crossing all of it."
      lede="The chain is the product. Remove any link and what remains is a chatbot with a payment key."
    >

      <Reveal>
        <div className="os-card os-ribbon rounded-2xl p-5 sm:p-7">
          <ol
            ref={ribbon}
            className="os-ribbon-inner grid grid-cols-2 gap-2 sm:grid-cols-4 lg:flex lg:items-stretch lg:gap-0"
          >
            {CHAIN.map((link, index) => (
              <li key={link.label} className="flex items-stretch lg:flex-1">
                <div className="flex-1 rounded-xl border border-[var(--os-line)] bg-[var(--os-surface)] p-3.5 text-center">
                  <span className="mx-auto flex w-fit items-center gap-1 text-[var(--os-blue)]">
                    <link.icon className="h-4 w-4" aria-hidden />
                    {link.second ? <link.second className="h-4 w-4" aria-hidden /> : null}
                  </span>
                  <p className="mt-2.5 text-[13px] font-semibold text-[var(--os-text)]">{link.label}</p>
                  <p className="os-label mt-1 text-[9px] text-[var(--os-faint)]">{link.note}</p>
                </div>
                {index < CHAIN.length - 1 ? (
                  <ChevronRight
                    aria-hidden
                    className="hidden h-4 w-4 shrink-0 self-center text-[var(--os-line-2)] lg:block"
                  />
                ) : null}
              </li>
            ))}
          </ol>

          <ul className="mt-7 flex flex-wrap justify-center gap-2 border-t border-[var(--os-line)] pt-7">
            {BADGES.map((badge) => (
              <li key={badge} className="os-chip">
                {badge}
              </li>
            ))}
          </ul>
        </div>
      </Reveal>
    </SectionShell>
  );
}
