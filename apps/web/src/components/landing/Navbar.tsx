/**
 * The command bar.
 *
 * At the top of the page it is a transparent rail that lets the hero run
 * behind it. Past the fold it contracts into a floating pill — narrower,
 * rounded, bordered and blurred — so the navigation stops competing with
 * the section a reader is actually in. That transition is the only piece
 * of chrome on the page that reacts to scroll, which is what keeps it
 * feeling deliberate rather than busy.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Menu, X } from "lucide-react";
import { usePrefersReducedMotion } from "./system";

const LINKS = [
  { href: "#platform", label: "Platform" },
  { href: "#buyer-agent", label: "Buyer Agent" },
  { href: "#merchant-agent", label: "Merchant Agent" },
  { href: "#trust-layer", label: "Trust Layer" },
  { href: "#demo", label: "Demo" },
];

export function Navbar() {
  const [condensed, setCondensed] = useState(false);
  const [open, setOpen] = useState(false);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    const onScroll = () => setCondensed(window.scrollY > 28);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  function goTo(event: React.MouseEvent<HTMLAnchorElement>, href: string) {
    const target = document.querySelector(href);
    if (!target) return;
    event.preventDefault();
    setOpen(false);
    target.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  }

  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-50 px-4 pt-3 sm:pt-4">
      <div
        className={[
          "pointer-events-auto mx-auto flex items-center justify-between gap-4 transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]",
          condensed
            ? "max-w-4xl rounded-full border border-[var(--os-line-2)] bg-[rgba(8,11,18,0.82)] px-3 py-2 shadow-[0_20px_50px_-30px_rgba(0,0,0,1)] backdrop-blur-xl"
            : "max-w-6xl rounded-full border border-transparent px-2 py-2.5",
        ].join(" ")}
      >
        <a
          href="#top"
          onClick={(event) => goTo(event, "#top")}
          className="flex shrink-0 items-center gap-2.5 rounded-full px-1.5 py-1"
        >
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-[#2563eb] via-[#6d3ff0] to-[#0ea5e9]">
            <span aria-hidden className="h-2.5 w-2.5 rounded-[3px] bg-white/90" />
          </span>
          <span className="flex flex-col leading-none">
            <span className="text-[15px] font-semibold tracking-[-0.02em] text-[var(--os-text)]">Vettri Vaanigam</span>
            <span className="os-label mt-1 text-[9px] text-[var(--os-faint)]">Agentic commerce</span>
          </span>
        </a>

        <nav aria-label="Primary" className="hidden items-center gap-0.5 lg:flex">
          {LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={(event) => goTo(event, link.href)}
              className="whitespace-nowrap rounded-full px-3 py-2 text-[13px] font-medium text-[var(--os-dim)] transition hover:bg-white/[0.06] hover:text-[var(--os-text)]"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Link to="/login" className="os-btn os-btn-primary hidden px-4 py-2 text-[13px] sm:inline-flex">
            Get Started
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-controls="os-mobile-nav"
            aria-label={open ? "Close menu" : "Open menu"}
            className="grid h-9 w-9 place-items-center rounded-lg border border-[var(--os-line-2)] text-[var(--os-dim)] transition hover:text-[var(--os-text)] lg:hidden"
          >
            {open ? <X className="h-4 w-4" aria-hidden /> : <Menu className="h-4 w-4" aria-hidden />}
          </button>
        </div>
      </div>

      {open ? (
        <nav
          id="os-mobile-nav"
          aria-label="Primary"
          className="pointer-events-auto mx-auto mt-2 max-w-6xl rounded-2xl border border-[var(--os-line-2)] bg-[rgba(8,11,18,0.94)] p-2 backdrop-blur-xl lg:hidden"
        >
          {LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={(event) => goTo(event, link.href)}
              className="block rounded-lg px-3.5 py-2.5 text-sm font-medium text-[var(--os-dim)] transition hover:bg-white/[0.06] hover:text-[var(--os-text)]"
            >
              {link.label}
            </a>
          ))}
          <Link to="/login" className="os-btn os-btn-primary mt-1 w-full">
            Get Started
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </nav>
      ) : null}
    </header>
  );
}
