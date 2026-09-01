/**
 * The first screen.
 *
 * FOUR DECISIONS WORTH RECORDING
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
 * 3. WHITE, and everything that follows from it. A dark hero flatters: any
 *    typography looks considered on near-black. White is unforgiving — it
 *    exposes weak hierarchy, uneven rhythm and arbitrary spacing — so the
 *    page is built on a strict scale instead of on contrast. Depth comes
 *    from the shadow ramp and hairlines, texture from a 5%-opacity dot
 *    mesh, and the only saturated colour on the screen is the brand ramp
 *    and one amber that means "a human decides this".
 *
 * 4. The claims are specific and checkable. "Ed25519 mandate, verified
 *    against a registered key" is falsifiable by reading one file;
 *    "enterprise-grade security" is not. Every line here names something
 *    that exists in the repository.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Bot,
  Store,
  ShieldCheck,
  CheckCircle2,
  ScrollText,
  KeyRound,
  Scale,
  UserCheck,
  Receipt,
  Swords,
  TrendingUp,
} from "lucide-react";

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

/**
 * The gate, in order. This is the product's actual claim, so it gets the
 * most space and the plainest language on the page.
 */
const CHAIN = [
  {
    icon: Bot,
    title: "An agent asks",
    body: "ACP, AP2 or x402 arrives at one endpoint. The mesh works out the dialect so the merchant never has to.",
  },
  {
    icon: Receipt,
    title: "We price it ourselves",
    body: "Every protocol states a price on the wire. None is believed. The basket is repriced from the merchant's own catalogue, and a disagreement is surfaced rather than resolved in the agent's favour.",
  },
  {
    icon: KeyRound,
    title: "The mandate is verified",
    body: "An Ed25519 spend mandate, checked against the key the merchant registered — never the key inside the request. A self-signed mandate is a forged one.",
  },
  {
    icon: Scale,
    title: "Policy decides, in code",
    body: "Ceilings, blocked categories, velocity and an adaptive trust score. Deterministic, versioned, and the same function that produces the decision produces the sentence explaining it.",
  },
  {
    icon: UserCheck,
    title: "A human approves anything above the line",
    body: "Over the ceiling is not a refusal. It escalates to a named, authenticated approver — and the calling agent is told so in ACP's own approval_required message.",
  },
  {
    icon: ScrollText,
    title: "The ledger remembers",
    body: "Every decision, approval and payment lands in a hash-chained record. Including the ones that failed.",
  },
];

const PROOF = [
  {
    icon: Swords,
    label: "Adversarial",
    title: "A red-team agent attacks it on stage",
    body: "Replay, expired mandate, mandate/cart mismatch, price forgery and a prompt injection aimed at the negotiator — run live against the same gateway, with the result asserted rather than narrated.",
  },
  {
    icon: TrendingUp,
    label: "Adaptive",
    title: "A ceiling that earns itself up, and collapses",
    body: "Trust is derived from an agent's own record with this merchant. Good behaviour raises its limit toward what the merchant configured; one flagged attack cancels four clean orders and drops it below what a stranger gets.",
  },
  {
    icon: ShieldCheck,
    label: "Bounded",
    title: "The model never moves money",
    body: "The negotiator proposes; code clamps. Every decision stores the model's raw proposal beside the enforced outcome, so the claim is checkable from the data rather than taken on trust.",
  },
];

const PATHS = [
  {
    to: "/login",
    icon: Bot,
    eyebrow: "Buyer",
    title: "Shop with an AI agent",
    lead: "See what an autonomous agent can actually buy — and watch it negotiate for you.",
    bullets: [
      "Conversational discovery grounded in real catalogue data",
      "A discount your own order history earns, applied automatically",
      "Transparent reasoning you can open, not a black box",
    ],
    cta: "Continue as AI Buyer",
  },
  {
    to: "/login",
    icon: Store,
    eyebrow: "Merchant",
    title: "Sell to AI agents, safely",
    lead: "Configure, approve and audit exactly what AI agents may do with your money.",
    bullets: [
      "Bounded proposals with real, enforced policy ceilings",
      "Only the discounts past your line ever reach you",
      "A full audit trail behind every rupee",
    ],
    cta: "Continue as Merchant",
  },
];

function Wordmark() {
  return (
    <Link to="/" className="group flex items-center gap-2.5" aria-label="Vaanigam home">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-brand-600 to-brand-800 shadow-raised transition group-hover:shadow-popover">
        <ShieldCheck className="h-[18px] w-[18px] text-white" aria-hidden />
      </span>
      <span className="flex flex-col leading-none">
        <span className="text-[15px] font-semibold tracking-tight text-ink">Vaanigam</span>
        <span className="text-micro font-medium text-ink-faint">Agent commerce gateway</span>
      </span>
    </Link>
  );
}

export default function LandingPage() {
  const stats = useCatalogStats();

  return (
    <main className="min-h-screen bg-surface text-ink">
      {/* ── Header ─────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-border-hair bg-surface/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5">
          <Wordmark />
          <nav className="flex items-center gap-1.5">
            <Link
              to="/customer/discover"
              className="hidden rounded-pill px-3.5 py-2 text-sm font-medium text-ink-muted transition hover:bg-surface-sunken hover:text-ink sm:inline-flex"
            >
              Browse catalogue
            </Link>
            <Link
              to="/login"
              className="inline-flex items-center gap-1.5 rounded-pill bg-ink px-4 py-2 text-sm font-semibold text-ink-inverse shadow-card transition hover:bg-ink-muted"
            >
              Sign in
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </nav>
        </div>
      </header>

      {/* ── Hero ───────────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-hero-mesh">
        {/* Texture, not decoration: a flat white page reads unfinished. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-dot-grid bg-dot-grid [mask-image:radial-gradient(50rem_30rem_at_50%_0%,black,transparent)]"
        />

        <div className="relative mx-auto max-w-6xl px-5 pb-20 pt-16 sm:pt-24">
          <div className="mx-auto max-w-3xl text-center">
            <span className="inline-flex animate-rise-in items-center gap-2 rounded-pill border border-border bg-surface/80 px-3.5 py-1.5 text-micro font-semibold uppercase tracking-[0.08em] text-ink-muted shadow-card backdrop-blur">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-pulse-soft rounded-full bg-brand-500" />
              </span>
              Razorpay Buildathon · Track 01
            </span>

            <h1
              className="mt-6 animate-rise-in text-balance text-4xl font-semibold leading-[1.08] tracking-[-0.03em] text-ink sm:text-6xl"
              style={{ animationDelay: "60ms" }}
            >
              AI agents can buy from you.
              <br />
              <span className="bg-gradient-to-r from-brand-700 via-brand-600 to-brand-500 bg-clip-text text-transparent">
                You decide what they may spend.
              </span>
            </h1>

            <p
              className="mx-auto mt-6 max-w-2xl animate-rise-in text-pretty text-lg leading-relaxed text-ink-muted"
              style={{ animationDelay: "120ms" }}
            >
              Vaanigam is the gate between an autonomous buyer and a merchant's money. The model proposes.
              Deterministic code decides. A human approves anything above the line — and every step of it is
              written down.
            </p>

            <div
              className="mt-9 flex animate-rise-in flex-col items-center justify-center gap-3 sm:flex-row"
              style={{ animationDelay: "180ms" }}
            >
              <Link
                to="/login"
                className="group inline-flex w-full items-center justify-center gap-2 rounded-pill bg-brand-600 px-6 py-3 text-sm font-semibold text-white shadow-raised transition hover:bg-brand-700 hover:shadow-popover sm:w-auto"
              >
                Choose how to enter
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
              </Link>
              <Link
                to="/demo"
                className="inline-flex w-full items-center justify-center gap-2 rounded-pill border border-border-strong bg-surface px-6 py-3 text-sm font-semibold text-ink shadow-card transition hover:border-ink-faint hover:shadow-raised sm:w-auto"
              >
                Watch the guided demo
              </Link>
            </div>

            {/* The line most projects would leave out. */}
            <ul
              className="mx-auto mt-10 flex animate-rise-in max-w-3xl flex-wrap items-center justify-center gap-x-6 gap-y-2.5"
              style={{ animationDelay: "240ms" }}
            >
              {BADGES.map((badge) => (
                <li key={badge} className="flex items-center gap-2 text-[13px] font-medium text-ink-muted">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden />
                  {badge}
                </li>
              ))}
            </ul>
          </div>

          {/* Measured, not decorative. Renders nothing when unmeasured. */}
          {stats ? (
            <dl className="mx-auto mt-14 grid max-w-3xl animate-rise-in grid-cols-2 gap-px overflow-hidden rounded-card border border-border bg-border shadow-lifted sm:grid-cols-4">
              {[
                { label: "Products an agent can read", value: stats.products.toLocaleString("en-IN") },
                { label: "Buyable offers published", value: stats.buyableOffers.toLocaleString("en-IN") },
                { label: "Protocols on one endpoint", value: "3" },
                { label: "Ways money moves without a human", value: "0" },
              ].map((stat) => (
                // `flex flex-col` is what makes the order classes below do
                // anything: the number is the hook and reads first, but the
                // label is what a screen reader should hit first.
                <div key={stat.label} className="flex flex-col justify-center bg-surface px-5 py-6 text-center">
                  <dt className="order-2 mt-1.5 text-micro font-medium leading-snug text-ink-faint">{stat.label}</dt>
                  <dd className="order-1 text-2xl font-semibold tracking-tight text-ink tabular-nums">{stat.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
      </section>

      {/* ── The chain ──────────────────────────────────────────── */}
      <section className="border-y border-border-hair bg-surface-tint">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <div className="max-w-2xl">
            <p className="text-micro font-semibold uppercase tracking-[0.1em] text-brand-600">The gate</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.02em] text-ink sm:text-4xl">
              Six steps, and the model is not one of them
            </h2>
            <p className="mt-4 text-pretty text-base leading-relaxed text-ink-muted">
              A language model is genuinely good at reading a messy catalogue and writing an offer. It is the
              wrong thing to put between an agent and a bank account. So it does the first job and never the
              second.
            </p>
          </div>

          <ol className="mt-12 grid gap-px overflow-hidden rounded-card border border-border bg-border md:grid-cols-2 lg:grid-cols-3">
            {CHAIN.map((step, index) => (
              <li key={step.title} className="group relative bg-surface p-6 transition hover:bg-surface-veil">
                <div className="flex items-center gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-border bg-surface-subtle text-ink-muted transition group-hover:border-brand-200 group-hover:bg-brand-50 group-hover:text-brand-700">
                    <step.icon className="h-4 w-4" aria-hidden />
                  </span>
                  <span className="text-micro font-semibold tabular-nums text-ink-faint">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                </div>
                <h3 className="mt-4 text-[15px] font-semibold tracking-tight text-ink">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-muted">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── Proof ──────────────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-5 py-20">
        <div className="max-w-2xl">
          <p className="text-micro font-semibold uppercase tracking-[0.1em] text-brand-600">Proof, not posture</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-[-0.02em] text-ink sm:text-4xl">
            Anyone can claim a guardrail. This one gets attacked.
          </h2>
        </div>

        <div className="mt-12 grid gap-5 lg:grid-cols-3">
          {PROOF.map((item) => (
            <article
              key={item.title}
              className="group flex flex-col rounded-card border border-border bg-surface p-7 shadow-card transition hover:-translate-y-0.5 hover:border-border-strong hover:shadow-lifted"
            >
              <div className="flex items-center gap-2.5">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-brand-50 to-brand-100 text-brand-700 ring-1 ring-inset ring-brand-200/60">
                  <item.icon className="h-[18px] w-[18px]" aria-hidden />
                </span>
                <span className="rounded-pill border border-border bg-surface-subtle px-2.5 py-1 text-micro font-semibold uppercase tracking-[0.07em] text-ink-muted">
                  {item.label}
                </span>
              </div>
              <h3 className="mt-5 text-lg font-semibold leading-snug tracking-tight text-ink">{item.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-ink-muted">{item.body}</p>
            </article>
          ))}
        </div>
      </section>

      {/* ── Paths ──────────────────────────────────────────────── */}
      <section className="border-t border-border-hair bg-surface-tint">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <div className="max-w-2xl">
            <p className="text-micro font-semibold uppercase tracking-[0.1em] text-brand-600">Two ways in</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.02em] text-ink sm:text-4xl">
              Pick the seat you want to sit in
            </h2>
            <p className="mt-4 text-base leading-relaxed text-ink-muted">
              The same transaction looks different from each side. Both are real, signed-in surfaces over the
              same data — not two screenshots of one.
            </p>
          </div>

          <div className="mx-auto mt-12 grid max-w-4xl gap-5 sm:grid-cols-2">
            {PATHS.map((path) => (
              <Link
                key={path.eyebrow}
                to={path.to}
                className="group flex flex-col rounded-card border border-border bg-surface p-7 shadow-card transition hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-lifted focus-visible:border-brand-400"
              >
                <div className="flex items-center justify-between">
                  <span className="grid h-11 w-11 place-items-center rounded-xl bg-surface-sunken text-ink transition group-hover:bg-brand-600 group-hover:text-white">
                    <path.icon className="h-5 w-5" aria-hidden />
                  </span>
                  <span className="text-micro font-semibold uppercase tracking-[0.09em] text-ink-faint">
                    {path.eyebrow}
                  </span>
                </div>

                <h3 className="mt-6 text-xl font-semibold tracking-tight text-ink">{path.title}</h3>
                <p className="mt-2.5 text-sm leading-relaxed text-ink-muted">{path.lead}</p>

                <ul className="mt-6 flex-1 space-y-2.5 border-t border-border-hair pt-5">
                  {path.bullets.map((bullet) => (
                    <li key={bullet} className="flex gap-2.5 text-[13px] leading-relaxed text-ink-muted">
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-500" aria-hidden />
                      {bullet}
                    </li>
                  ))}
                </ul>

                <span className="mt-7 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700">
                  {path.cta}
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" aria-hidden />
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ── Closing ────────────────────────────────────────────── */}
      <section className="border-t border-border-hair">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <div className="relative overflow-hidden rounded-card border border-border bg-hero-mesh px-8 py-14 text-center shadow-lifted sm:px-14">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-dot-grid bg-dot-grid [mask-image:radial-gradient(30rem_20rem_at_50%_50%,black,transparent)]"
            />
            <div className="relative">
              <h2 className="mx-auto max-w-2xl text-balance text-3xl font-semibold tracking-[-0.02em] text-ink sm:text-4xl">
                Watch an agent try to cheat, and fail
              </h2>
              <p className="mx-auto mt-4 max-w-xl text-pretty text-base leading-relaxed text-ink-muted">
                The guided demo runs an honest buyer through the full gate, then turns a red-team agent loose on
                the same endpoint. Nothing is pre-recorded.
              </p>
              <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <Link
                  to="/demo"
                  className="group inline-flex w-full items-center justify-center gap-2 rounded-pill bg-brand-600 px-6 py-3 text-sm font-semibold text-white shadow-raised transition hover:bg-brand-700 sm:w-auto"
                >
                  Run the demo
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
                </Link>
                <Link
                  to="/customer/discover"
                  className="inline-flex w-full items-center justify-center rounded-pill border border-border-strong bg-surface px-6 py-3 text-sm font-semibold text-ink shadow-card transition hover:border-ink-faint sm:w-auto"
                >
                  Browse the catalogue first
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-border-hair bg-surface-subtle">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-5 py-8 sm:flex-row">
          <Wordmark />
          <p className="text-center text-micro leading-relaxed text-ink-faint sm:text-right">
            Built for the Razorpay Buildathon, Track 01. Payments run in Razorpay Test Mode.
            <br />
            AP2 and x402 are compatibility shims and are labelled as such everywhere they appear.
          </p>
        </div>
      </footer>
    </main>
  );
}
