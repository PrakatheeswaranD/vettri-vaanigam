/**
 * The way in. Two doors, one click each.
 *
 * WHAT THIS REPLACED, AND WHY
 *
 * There used to be three roles, a per-role sub-page, and an email/password
 * form under a divider. That was four screens and a credential field
 * standing between someone and a product they are here to look at — and
 * the credentials were the same seeded demo accounts the buttons already
 * used, so the form added a step without adding a capability.
 *
 * The platform-admin role went with it. It was a third door onto a console
 * nobody demoing this product needs, and every extra door dilutes the two
 * that carry the actual story: an agent buying, and a merchant governing.
 *
 * WHAT DID NOT CHANGE
 *
 * These are still real authenticated sessions against real distinct
 * accounts, and the SERVER decides what each may do. Choosing a door here
 * does not grant anything — it picks which account to sign in as. That
 * line is worth keeping visible, because a one-click entry screen is
 * exactly the kind of thing people assume is faked.
 */
import { Navigate, useNavigate } from "react-router-dom";
import { ArrowRight, Bot, ShieldCheck, Store } from "lucide-react";
import { useLogin } from "../hooks/use-auth";
import { ApiError } from "../lib/api-client";
import { ROLE_HOME, setExperienceRole, type ExperienceRole } from "../lib/experience-role";

const DEMO_ACCOUNTS: Record<ExperienceRole, { email: string; password: string }> = {
  customer: { email: "customer@vaanigam.demo", password: "CustomerDemo!2026" },
  merchant: { email: "owner@meridianathletics.demo", password: "MeridianDemo!2026" },
};

const DOORS: {
  role: ExperienceRole;
  emoji: string;
  icon: typeof Bot;
  title: string;
  lead: string;
  points: string[];
  accent: string;
  iconClass: string;
}[] = [
  {
    role: "customer",
    emoji: "🛒",
    icon: Bot,
    title: "Continue as AI Buyer",
    lead: "Shop by talking to an agent, and watch it negotiate on your behalf.",
    points: [
      "Discovery grounded in the merchant's real catalogue",
      "A discount your own order history earns, applied automatically",
      "Every step of the reasoning open, not a black box",
    ],
    accent: "hover:border-brand-300",
    iconClass: "bg-brand-50 text-brand-700 ring-brand-200/60 group-hover:bg-brand-600 group-hover:text-white",
  },
  {
    role: "merchant",
    emoji: "🏪",
    icon: Store,
    title: "Continue as Merchant",
    lead: "Set what AI agents and shoppers may do with your money, and approve the rest.",
    points: [
      "Enforced spending ceilings and an adaptive agent trust score",
      "Only the discounts past your line come to you",
      "A full audit trail behind every rupee",
    ],
    accent: "hover:border-success/40",
    iconClass: "bg-success-subtle text-success-text ring-success/20 group-hover:bg-success group-hover:text-white",
  },
];

export default function LoginPage() {
  const login = useLogin();
  const navigate = useNavigate();

  async function enter(role: ExperienceRole) {
    try {
      await login.mutateAsync({ ...DEMO_ACCOUNTS[role], experience: role });
      setExperienceRole(role);
      navigate(ROLE_HOME[role], { replace: true });
    } catch {
      /* rendered below */
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-surface px-4 py-12">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-hero-mesh" />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-dot-grid bg-dot-grid [mask-image:radial-gradient(40rem_28rem_at_50%_20%,black,transparent)]"
      />

      <div className="relative w-full max-w-3xl">
        <div className="text-center">
          <span className="inline-flex items-center gap-2 rounded-pill border border-border bg-surface/80 px-3.5 py-1.5 text-micro font-semibold uppercase tracking-[0.09em] text-ink-muted shadow-card backdrop-blur">
            <ShieldCheck className="h-3.5 w-3.5 text-brand-600" aria-hidden />
            Vaanigam · Razorpay Track 01
          </span>
          <h1 className="mt-6 text-balance text-3xl font-semibold tracking-[-0.025em] text-ink sm:text-4xl">
            Choose how you want to experience agentic commerce.
          </h1>
          <p className="mx-auto mt-3 max-w-lg text-pretty text-[15px] leading-relaxed text-ink-muted">
            Two sides of the same transaction. Both are real, signed-in sessions over the same data.
          </p>
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          {DOORS.map((door) => (
            <button
              key={door.role}
              type="button"
              disabled={login.isPending}
              // The card's own text is a heading, a paragraph and a list;
              // assistive tech announcing the control needs one short name
              // for it, not the whole card read out as the label.
              aria-label={door.title}
              onClick={() => void enter(door.role)}
              className={`group flex flex-col rounded-card border border-border bg-surface p-7 text-left shadow-card transition hover:-translate-y-0.5 hover:shadow-lifted disabled:pointer-events-none disabled:opacity-60 ${door.accent}`}
            >
              <span
                className={`grid h-12 w-12 place-items-center rounded-xl text-xl ring-1 ring-inset transition ${door.iconClass}`}
                aria-hidden
              >
                {door.emoji}
              </span>

              <h2 className="mt-5 text-lg font-semibold tracking-tight text-ink">{door.title}</h2>
              <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">{door.lead}</p>

              <ul className="mt-5 flex-1 space-y-2 border-t border-border-hair pt-4">
                {door.points.map((point) => (
                  <li key={point} className="flex gap-2 text-micro leading-relaxed text-ink-muted">
                    <span aria-hidden className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-ink-faint" />
                    {point}
                  </li>
                ))}
              </ul>

              <span className="mt-6 inline-flex items-center gap-1.5 text-[13px] font-semibold text-brand-700">
                {login.isPending ? "Signing in…" : "Enter"}
                <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" aria-hidden />
              </span>
            </button>
          ))}
        </div>

        {login.isError ? (
          <p className="mt-6 rounded-card border border-danger-border bg-danger-subtle px-4 py-3 text-center text-[13px] text-danger-text">
            {login.error instanceof ApiError ? login.error.message : "Could not sign in."}
          </p>
        ) : null}

        {/* Worth saying out loud: a one-click entry screen is exactly the
            kind of thing people assume is faked. */}
        <p className="mt-8 text-center text-micro leading-relaxed text-ink-faint">
          Each door signs in to a distinct authenticated account. The server enforces what that account may do —
          picking a door here does not grant anything.
        </p>
      </div>
    </main>
  );
}

/** `/login/:role` used to exist. Anything still linking to it lands here. */
export function LegacyRoleLoginRedirect() {
  return <Navigate to="/login" replace />;
}
