/**
 * The first screen.
 *
 * THREE DECISIONS WORTH RECORDING
 *
 * 1. The honesty badges are ON THIS PAGE, not buried in docs. "ACP built to
 *    spec · AP2 and x402 are compatibility shims" is the kind of line most
 *    projects hide. Putting it first turns the discipline into the pitch:
 *    a reader who checks the code finds it matches the marketing.
 *
 * 2. The stats strip is MEASURED, not decorative. It reads the merchant's
 *    genuinely public `.well-known/agent-catalog.json` — the same document
 *    an outside AI agent would read — and counts what is actually there.
 *    If the fetch fails the strip renders nothing rather than a flattering
 *    placeholder, because a fabricated number on the first screen would
 *    undermine every real number behind it.
 *
 * 3. Dark surface, built from the EXISTING token set (`surface-inverse`,
 *    `ink-inverse`, the brand ramp) rather than a second palette invented
 *    for one page. The spec asked for a confident dark base and for visual
 *    consistency with the console; those only reconcile if the dark is made
 *    of the same tokens the console already uses.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Bot, Store, ShieldCheck, CheckCircle2, ScrollText } from "lucide-react";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000/api/v1";
const DEMO_SLUG = import.meta.env.VITE_DEMO_MERCHANT_SLUG ?? "meridian-athletics";

interface LandingStats {
  products: number;
  buyableOffers: number;
}

/**
 * Counts what an agent would actually find. Deliberately reads the public
 * discovery document rather than an internal endpoint — the number shown is
 * then the same number an outside agent would see.
 */
function useCatalogStats(): LandingStats | null {
  const [stats, setStats] = useState<LandingStats | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/agent-catalog/${DEMO_SLUG}/.well-known/agent-catalog.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((doc: { itemListElement?: { item?: { offers?: unknown[] } }[] } | null) => {
        if (cancelled || !doc?.itemListElement) return;
        const items = doc.itemListElement;
        setStats({
          products: items.length,
          buyableOffers: items.reduce((sum, entry) => sum + (entry.item?.offers?.length ?? 0), 0),
        });
      })
      // Silence is correct here: no strip beats an invented strip.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return stats;
}

const BADGES = [
  "ACP built to spec · AP2 and x402 are labelled shims",
  "Zero invented products — every result is grounding-validated",
  "Every action written to a tamper-evident ledger",
];

const PATHS = [
  {
    to: "/login/customer",
    icon: Bot,
    eyebrow: "Buyer",
    title: "Shop with an AI agent",
    lead: "See what an autonomous agent can actually buy from a real catalogue.",
    bullets: [
      "Conversational discovery grounded in real catalogue data",
      "Transparent reasoning you can open, not a black box",
      "Nothing an agent buys is ever a guess",
    ],
    cta: "Enter as a buyer",
  },
  {
    to: "/login/merchant",
    icon: Store,
    eyebrow: "Merchant",
    title: "Sell to AI agents, safely",
    lead: "Configure, approve and audit exactly what AI agents may do with your money.",
    bullets: [
      "Bounded proposals with real, enforced policy ceilings",
      "Every approval tied to a real, authenticated person",
      "A full audit trail behind every rupee",
    ],
    cta: "Enter as a merchant",
  },
  {
    to: "/login/admin",
    icon: ShieldCheck,
    eyebrow: "Platform",
    title: "Govern agentic commerce",
    lead: "Onboard AI-ready merchants and watch risk, payments and exceptions across them.",
    bullets: [
      "Readiness and transactability across merchants",
      "Uncertain payment states surfaced, never hidden",
      "Explainable agent actions, end to end",
    ],
    cta: "Enter as platform admin",
  },
];

export default function LandingPage() {
  const stats = useCatalogStats();

  return (
    <main className="min-h-screen bg-surface-inverse text-ink-inverse">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-6">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-white">
            <ScrollText size={18} />
          </span>
          <div>
            <p className="text-sm font-semibold tracking-tight">Anumati</p>
            <p className="text-micro text-white/45">अनुमति · consent for agent commerce</p>
          </div>
        </div>
        <Link
          to="/login"
          className="rounded-md border border-white/15 px-4 py-2 text-sm font-medium text-white/80 transition-colors hover:bg-white/5 hover:text-white"
        >
          Sign in
        </Link>
      </header>

      <section className="mx-auto max-w-6xl animate-fade-up px-5 pb-4 pt-10 text-center lg:pt-16">
        <p className="text-micro font-semibold uppercase tracking-[0.2em] text-brand-300">
          Razorpay Track 01 · AI Growth &amp; Agentic Commerce
        </p>

        <h1 className="mx-auto mt-5 max-w-3xl text-3xl font-bold leading-tight tracking-tight md:text-5xl">
          Agentic commerce, built so every rupee an AI agent moves is{" "}
          <span className="border-b-4 border-brand-500 pb-0.5">explainable, bounded, and gated</span>.
        </h1>

        <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-white/60">
          Any AI buyer agent, on any protocol, can discover and pay a merchant here — and cannot move a rupee without
          a signed permission and the merchant&rsquo;s own rules both agreeing.
        </p>

        <div className="mt-7 flex flex-wrap items-center justify-center gap-2">
          {BADGES.map((badge) => (
            <span
              key={badge}
              className="inline-flex items-center gap-1.5 rounded-pill border border-white/10 bg-white/[0.04] px-3 py-1.5 text-micro text-white/70"
            >
              <CheckCircle2 size={11} className="text-brand-300" />
              {badge}
            </span>
          ))}
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-4 px-5 py-10 md:grid-cols-3">
        {PATHS.map((path, i) => {
          const Icon = path.icon;
          return (
            <article
              key={path.to}
              className="animate-fade-up rounded-card border border-white/10 bg-white/[0.03] p-6 transition-transform duration-200 ease-ui hover:-translate-y-1"
              style={{ animationDelay: `${i * 70}ms` }}
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-600/15 text-brand-300">
                <Icon size={19} />
              </span>

              <p className="mt-5 text-micro font-semibold uppercase tracking-wider text-white/40">{path.eyebrow}</p>
              <h2 className="mt-1 text-lg font-bold tracking-tight">{path.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-white/55">{path.lead}</p>

              <ul className="mt-4 space-y-1.5">
                {path.bullets.map((b) => (
                  <li key={b} className="flex items-start gap-2 text-micro leading-snug text-white/60">
                    <CheckCircle2 size={11} className="mt-0.5 shrink-0 text-brand-400" />
                    {b}
                  </li>
                ))}
              </ul>

              <Link
                to={path.to}
                className="mt-5 inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-500"
              >
                {path.cta}
                <ArrowRight size={14} />
              </Link>
            </article>
          );
        })}
      </section>

      {/* Rendered only when the numbers are real. */}
      {stats ? (
        <section className="mx-auto max-w-6xl animate-fade-up px-5 pb-16">
          <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-4 rounded-card border border-white/10 bg-white/[0.02] px-6 py-5">
            <div className="text-center">
              <p className="text-2xl font-bold">{stats.products}</p>
              <p className="text-micro text-white/45">Products an AI agent can discover</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold">{stats.buyableOffers}</p>
              <p className="text-micro text-white/45">Offers it can actually buy</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold">3</p>
              <p className="text-micro text-white/45">Protocols accepted on one endpoint</p>
            </div>
            <p className="mx-auto max-w-sm text-micro leading-snug text-white/35">
              Counted live from this merchant&rsquo;s public agent catalogue — the same document an outside agent
              reads. Seeded demo data, not production volume.
            </p>
          </div>
        </section>
      ) : null}
    </main>
  );
}
