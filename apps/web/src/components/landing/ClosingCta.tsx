/**
 * The last ask, and the footer.
 *
 * Both live here because they are one block visually: a bordered panel
 * that closes the argument, then a quiet rail underneath. The footer is
 * deliberately plain — a page that has just spent ten sections arguing
 * for restraint should not end in a five-column link farm.
 */
import { Link } from "react-router-dom";
import { ArrowRight, Play } from "lucide-react";
import { Reveal, useMagnetic } from "./system";

const FOOTER_LINKS = [
  { label: "Platform", href: "#platform" },
  { label: "Agents", href: "#buyer-agent" },
  { label: "Trust", href: "#trust-layer" },
  { label: "Documentation", href: "#platform" },
  { label: "Demo", href: "#demo" },
];

export function ClosingCta() {
  const ctaRef = useMagnetic<HTMLAnchorElement>(5);

  return (
    <section className="relative border-t border-[var(--os-line)]" aria-labelledby="cta-title">
      <div className="mx-auto w-full max-w-6xl px-5 py-20 sm:py-24">
        <Reveal>
          <div className="os-card os-edge relative overflow-hidden rounded-3xl px-6 py-14 text-center sm:px-14">
            <div
              aria-hidden
              className="os-grid pointer-events-none absolute inset-0 [mask-image:radial-gradient(26rem_16rem_at_50%_40%,black,transparent)]"
            />
            <div className="relative">
              <h2 id="cta-title" className="os-display mx-auto max-w-2xl text-balance text-[2rem] sm:text-[2.75rem]">
                Let agents transact. <span className="os-gradient-text">Keep the controls.</span>
              </h2>
              <p className="mx-auto mt-5 max-w-xl text-pretty text-[15px] leading-relaxed text-[var(--os-dim)]">
                Open the command center and watch an autonomous purchase pass validation, policy, risk and
                authorization — with every step written to an audit trail you can read.
              </p>
              <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <Link ref={ctaRef} to="/login" className="os-btn os-btn-primary group w-full sm:w-auto">
                  Get Started
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
                </Link>
                <a href="#demo" className="os-btn os-btn-ghost w-full sm:w-auto">
                  <Play className="h-4 w-4" aria-hidden />
                  Run the agent flow
                </a>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

export function SiteFooter() {
  return (
    <footer className="relative border-t border-[var(--os-line)]">
      <div className="mx-auto grid w-full max-w-6xl gap-8 px-5 py-12 sm:grid-cols-[1.2fr_1fr]">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-[#2563eb] via-[#6d3ff0] to-[#0ea5e9]">
              <span aria-hidden className="h-2.5 w-2.5 rounded-[3px] bg-white/90" />
            </span>
            <span className="text-[15px] font-semibold tracking-[-0.02em] text-[var(--os-text)]">Vaanigam</span>
          </div>
          <p className="mt-4 max-w-sm text-[13px] leading-relaxed text-[var(--os-dim)]">
            Vaanigam is the operating layer for AI-native commerce — the trust boundary between an autonomous
            buyer and a merchant's money.
          </p>
        </div>

        <nav aria-label="Footer" className="sm:justify-self-end">
          <ul className="grid grid-cols-2 gap-x-10 gap-y-2.5 sm:grid-cols-1 sm:text-right">
            {FOOTER_LINKS.map((link) => (
              <li key={link.label}>
                <a
                  href={link.href}
                  className="text-[13px] text-[var(--os-dim)] transition hover:text-[var(--os-text)]"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>

      <div className="border-t border-[var(--os-line)]">
        <div className="mx-auto w-full max-w-6xl px-5 py-6">
          <p className="text-[12px] leading-relaxed text-[var(--os-faint)]">
            Built for AI Growth &amp; Agentic Commerce · Razorpay Test Mode
          </p>
        </div>
      </div>
    </footer>
  );
}
