/**
 * The way in.
 *
 * WHAT THIS REPLACED, AND WHY
 *
 * This screen used to be two large cards — "Continue as AI Buyer" and
 * "Continue as Merchant" — each of which silently signed in with a
 * hardcoded seeded account. It worked, but it read as a demo switcher
 * rather than as a sign-in, and a product whose entire pitch is that the
 * SERVER decides what an account may do cannot afford a front door that
 * appears to decide for itself.
 *
 * So the credentials are back, and they are the real thing: an email and
 * a password posted to `/auth/login`, which either returns a session
 * token or the deliberately indistinguishable "Invalid email or
 * password." The client validates FORMAT only, never identity — a client
 * that could tell a wrong password from an unknown email would be an
 * email-enumeration oracle, which is exactly what the server takes care
 * not to be.
 *
 * WHAT SURVIVED
 *
 * One-click entry, demoted. The seeded accounts are still reachable, but
 * as a labelled secondary row that FILLS THE FORM IN FRONT OF YOU before
 * submitting it. Nothing is hidden: the credentials shown are the ones
 * actually sent, and a reviewer can retype them by hand and get the same
 * session.
 *
 * The role is no longer chosen here. It is read off the authenticated
 * user the server returns, which is the only answer that was ever
 * trustworthy.
 */
import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Bot,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Lock,
  Mail,
  Scale,
  ScrollText,
  ShieldCheck,
  Store,
} from "lucide-react";
import { clsx } from "clsx";
import { useAuthToken, useLogin } from "../hooks/use-auth";
import { ApiError } from "../lib/api-client";
import { getExperienceRole, ROLE_HOME, type ExperienceRole } from "../lib/experience-role";

/** Shape only. Whether an address exists is the server's business. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface SeededAccount {
  role: ExperienceRole;
  label: string;
  icon: typeof Bot;
  email: string;
  password: string;
}

const SEEDED_ACCOUNTS: SeededAccount[] = [
  { role: "customer", label: "AI Buyer", icon: Bot, email: "customer@vettrivaanigam.demo", password: "CustomerDemo!2026" },
  {
    role: "merchant",
    label: "Merchant",
    icon: Store,
    email: "owner@meridianathletics.demo",
    password: "MeridianDemo!2026",
  },
];

const PROOF_POINTS = [
  {
    icon: KeyRound,
    title: "Verified mandates",
    body: "Every spend mandate is Ed25519-checked against the key the merchant registered — never the key inside the request.",
  },
  {
    icon: Scale,
    title: "Policy decided in code",
    body: "Ceilings, blocked categories, velocity and an adaptive trust score. Deterministic, versioned, and explained in the same pass.",
  },
  {
    icon: ScrollText,
    title: "A ledger that remembers",
    body: "Every action lands in a tamper-evident chain, so an answer given today is still checkable tomorrow.",
  },
];

const FIELD_BASE =
  "w-full rounded-card border bg-surface py-2.5 pl-10 pr-3 text-sm text-ink placeholder:text-ink-faint transition focus:outline-none disabled:opacity-60";
/* No focus shadow of their own: the app already draws a visible focus ring
   globally (`:focus-visible` in index.css), and a second one around the
   same field reads as a rendering bug rather than as emphasis. */
const FIELD_OK = "border-border focus:border-brand-500";
const FIELD_BAD = "border-danger-border focus:border-danger";

export default function LoginPage() {
  const login = useLogin();
  const navigate = useNavigate();
  const token = useAuthToken();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});

  function clearServerError() {
    if (login.isError) login.reset();
  }

  async function signIn(credentials: { email: string; password: string }) {
    try {
      const result = await login.mutateAsync(credentials);
      navigate(ROLE_HOME[result.user.role === "CUSTOMER" ? "customer" : "merchant"], { replace: true });
    } catch {
      /* surfaced by the alert below */
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = email.trim();
    const next: { email?: string; password?: string } = {};
    if (!trimmed) next.email = "Enter your email address.";
    else if (!EMAIL_PATTERN.test(trimmed)) next.email = "Enter a valid email address.";
    if (!password) next.password = "Enter your password.";
    setErrors(next);
    if (next.email || next.password) return;
    void signIn({ email: trimmed, password });
  }

  function fillAndSignIn(account: SeededAccount) {
    setEmail(account.email);
    setPassword(account.password);
    setErrors({});
    clearServerError();
    void signIn({ email: account.email, password: account.password });
  }

  const serverError = login.isError
    ? login.error instanceof ApiError
      ? login.error.message
      : "Could not reach the sign-in service. Check your connection and try again."
    : null;

  /** A live token means a session already exists, so this screen has
   * nothing to ask. RequireAuth sends people here when it does not — this
   * is the other half of that loop. */
  if (token && !login.isPending) return <Navigate to={ROLE_HOME[getExperienceRole()]} replace />;

  return (
    <main className="min-h-screen bg-surface lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      {/* Left: who this is. Deliberately one dark column rather than a dark
          page — the product behind this door is white, and the door should
          not promise a different one. */}
      <aside className="relative hidden overflow-hidden bg-gradient-to-b from-brand-800 via-brand-900 to-[#1e1b4b] px-12 py-12 lg:flex lg:flex-col">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 [mask-image:radial-gradient(42rem_34rem_at_28%_12%,black,transparent)]"
          style={{
            backgroundImage: "radial-gradient(rgb(255 255 255 / 0.13) 1px, transparent 1px)",
            backgroundSize: "22px 22px",
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -left-32 top-1/3 h-96 w-96 rounded-full bg-brand-500/25 blur-3xl"
        />

        <div className="relative flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/10 text-white ring-1 ring-inset ring-white/20">
            <ShieldCheck className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <p className="text-sm font-semibold tracking-tight text-white">Vettri Vaanigam</p>
            <p className="text-micro text-white/60">Agentic commerce infrastructure</p>
          </div>
        </div>

        <div className="relative my-auto py-14">
          <h2 className="text-balance text-[28px] font-semibold leading-tight tracking-[-0.025em] text-white">
            The commerce layer an AI agent is actually allowed to transact with.
          </h2>
          <p className="mt-4 max-w-md text-pretty text-sm leading-relaxed text-white/70">
            Agents discover, negotiate and pay through one gateway. The merchant keeps the ceiling, the veto and the
            record.
          </p>

          <ul className="mt-10 space-y-6">
            {PROOF_POINTS.map((point) => (
              <li key={point.title} className="flex gap-3.5">
                <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/10 text-white ring-1 ring-inset ring-white/15">
                  <point.icon className="h-4 w-4" aria-hidden />
                </span>
                <div>
                  <p className="text-[13px] font-semibold text-white">{point.title}</p>
                  <p className="mt-1 max-w-sm text-micro leading-relaxed text-white/60">{point.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-micro text-white/40">Vettri Vaanigam · Razorpay Track 01</p>
      </aside>

      {/* Right: the form. */}
      <div className="flex min-h-screen flex-col px-5 py-7 sm:px-8 lg:min-h-0 lg:px-14 lg:py-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5 lg:invisible">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-600 text-white shadow-card">
              <ShieldCheck className="h-4 w-4" aria-hidden />
            </span>
            <p className="text-sm font-semibold tracking-tight text-ink">Vettri Vaanigam</p>
          </div>
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 rounded-pill px-3 py-1.5 text-[13px] font-medium text-ink-muted transition hover:bg-surface-subtle hover:text-ink"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            Back to home
          </Link>
        </div>

        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
          <h1 className="text-2xl font-semibold tracking-[-0.02em] text-ink">Sign in</h1>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
            Use your Vettri Vaanigam account. The server decides what that account may do — signing in does not grant anything
            on its own.
          </p>

          {serverError ? (
            <div
              role="alert"
              className="mt-6 flex items-start gap-2.5 rounded-card border border-danger-border bg-danger-subtle px-3.5 py-3 text-[13px] leading-relaxed text-danger-text"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>{serverError}</span>
            </div>
          ) : null}

          <form className="mt-6 space-y-5" onSubmit={onSubmit} noValidate>
            <div>
              <label htmlFor="login-email" className="block text-[13px] font-semibold text-ink">
                Email address
              </label>
              <div className="relative mt-1.5">
                <Mail
                  aria-hidden
                  className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint"
                />
                <input
                  id="login-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  autoFocus
                  spellCheck={false}
                  placeholder="you@company.com"
                  value={email}
                  disabled={login.isPending}
                  aria-invalid={errors.email ? true : undefined}
                  aria-describedby={errors.email ? "login-email-error" : undefined}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    if (errors.email) setErrors((prev) => ({ ...prev, email: undefined }));
                    clearServerError();
                  }}
                  className={clsx(FIELD_BASE, errors.email ? FIELD_BAD : FIELD_OK)}
                />
              </div>
              {errors.email ? (
                <p id="login-email-error" className="mt-1.5 text-micro text-danger-text">
                  {errors.email}
                </p>
              ) : null}
            </div>

            <div>
              <label htmlFor="login-password" className="block text-[13px] font-semibold text-ink">
                Password
              </label>
              <div className="relative mt-1.5">
                <Lock
                  aria-hidden
                  className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint"
                />
                <input
                  id="login-password"
                  name="password"
                  type={revealed ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="••••••••••"
                  value={password}
                  disabled={login.isPending}
                  aria-invalid={errors.password ? true : undefined}
                  aria-describedby={
                    clsx(errors.password && "login-password-error", capsLock && "login-caps-lock") || undefined
                  }
                  onChange={(event) => {
                    setPassword(event.target.value);
                    if (errors.password) setErrors((prev) => ({ ...prev, password: undefined }));
                    clearServerError();
                  }}
                  // Caps Lock is the most common cause of a password the
                  // person typing it swears is correct.
                  onKeyUp={(event) => setCapsLock(event.getModifierState("CapsLock"))}
                  onBlur={() => setCapsLock(false)}
                  className={clsx(FIELD_BASE, "pr-11", errors.password ? FIELD_BAD : FIELD_OK)}
                />
                <button
                  type="button"
                  onClick={() => setRevealed((value) => !value)}
                  aria-label={revealed ? "Hide password" : "Show password"}
                  aria-pressed={revealed}
                  className="absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-ink-faint transition hover:bg-surface-subtle hover:text-ink-muted"
                >
                  {revealed ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
                </button>
              </div>
              {errors.password ? (
                <p id="login-password-error" className="mt-1.5 text-micro text-danger-text">
                  {errors.password}
                </p>
              ) : null}
              {capsLock ? (
                <p id="login-caps-lock" className="mt-1.5 text-micro text-warning-text">
                  Caps Lock is on.
                </p>
              ) : null}
            </div>

            <button
              type="submit"
              disabled={login.isPending}
              className="inline-flex w-full items-center justify-center gap-2 rounded-card bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-card transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {login.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  Signing in…
                </>
              ) : (
                "Sign in"
              )}
            </button>
          </form>

          {/* The old one-click doors, demoted: they fill the form above with
              the exact credentials they are about to send, so nothing here
              does anything the typed form could not. */}
          <div className="mt-8">
            <div className="flex items-center gap-3">
              <span className="h-px flex-1 bg-border-hair" />
              <span className="text-micro font-semibold uppercase tracking-[0.09em] text-ink-faint">
                Evaluation accounts
              </span>
              <span className="h-px flex-1 bg-border-hair" />
            </div>

            {/* One per row rather than side by side: the whole point of
                showing the address is that it can be read and retyped, and
                two columns at this width truncate it to an ellipsis. */}
            <div className="mt-4 space-y-2">
              {SEEDED_ACCOUNTS.map((account) => (
                <button
                  key={account.role}
                  type="button"
                  disabled={login.isPending}
                  onClick={() => fillAndSignIn(account)}
                  className="group flex w-full items-center gap-3 rounded-card border border-border bg-surface px-3 py-2.5 text-left transition hover:border-brand-300 hover:shadow-card disabled:pointer-events-none disabled:opacity-60"
                >
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700 transition group-hover:bg-brand-600 group-hover:text-white">
                    <account.icon className="h-4 w-4" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-semibold text-ink">{account.label}</span>
                    <span className="block truncate font-mono text-micro text-ink-faint">{account.email}</span>
                  </span>
                  <ArrowRight
                    aria-hidden
                    className="h-3.5 w-3.5 shrink-0 text-ink-faint transition group-hover:translate-x-0.5 group-hover:text-brand-600"
                  />
                </button>
              ))}
            </div>

            <p className="mt-4 text-micro leading-relaxed text-ink-faint">
              Seeded accounts on this environment. Selecting one fills the form above and signs in with those exact
              credentials — the server still authenticates them, and still enforces what each may do.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
