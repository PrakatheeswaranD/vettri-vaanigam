/**
 * Entry point (Buildathon Track 01).
 *
 * Deliberately NOT a password wall. The track's bar is "every money
 * action explainable, bounded and gated" — that is about gating MONEY
 * ACTIONS (policy -> approval -> scoped authorization), not about gating
 * the app. Making a reviewer type credentials adds friction and proves
 * nothing.
 *
 * But identity is not removed either, because the approval step needs a
 * REAL approver to be meaningful: `Approval.approverId` is a foreign key
 * to a real `MerchantUser`, so "a human approved this" is a fact in the
 * database rather than a claim in a slide.
 *
 * So this screen turns identity into a demonstration of the guardrail:
 * enter as OWNER (can approve) or as VIEWER (cannot). Choosing VIEWER and
 * then trying to approve returns a real 403 from the server — the gate is
 * a server rule, not a hidden button.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ShieldCheck, Eye, ChevronDown, LogIn } from "lucide-react";
import { useLogin } from "../hooks/use-auth";
import { ApiError } from "../lib/api-client";

const DEMO_ACCOUNTS = {
  OWNER: { email: "owner@meridianathletics.demo", password: "MeridianDemo!2026" },
  VIEWER: { email: "viewer@meridianathletics.demo", password: "MeridianViewer!2026" },
} as const;

export default function LoginPage() {
  const login = useLogin();
  const navigate = useNavigate();
  const [showManual, setShowManual] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function enterAs(role: keyof typeof DEMO_ACCOUNTS) {
    try {
      await login.mutateAsync(DEMO_ACCOUNTS[role]);
      navigate("/overview", { replace: true });
    } catch {
      /* surfaced below */
    }
  }

  async function handleManual(e: React.FormEvent) {
    e.preventDefault();
    try {
      await login.mutateAsync({ email, password });
      navigate("/overview", { replace: true });
    } catch {
      /* surfaced below */
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-subtle px-4 py-10">
      <div className="w-full max-w-md rounded-card border border-border bg-surface p-7 shadow-popover">
        <div className="mb-1 text-center">
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-600">Anumati</p>
          <h1 className="mt-1 text-xl font-bold tracking-tight text-ink">अनुमति — consent for agent commerce</h1>
          <p className="mt-2 text-sm text-ink-muted">
            Be safely discoverable and payable by any AI buyer agent, on any protocol — without three separate
            integrations.
          </p>
        </div>

        <div className="my-6 space-y-3">
          <button
            type="button"
            disabled={login.isPending}
            onClick={() => enterAs("OWNER")}
            className="flex w-full items-start gap-3 rounded-card border border-brand-200 bg-brand-50 px-4 py-3 text-left transition hover:border-brand-400 disabled:opacity-60"
          >
            <ShieldCheck size={18} className="mt-0.5 shrink-0 text-brand-600" />
            <span>
              <span className="block text-sm font-semibold text-ink">Enter as Merchant Owner</span>
              <span className="mt-0.5 block text-xs text-ink-muted">
                Full access — can approve or reject an AI growth proposal.
              </span>
            </span>
          </button>

          <button
            type="button"
            disabled={login.isPending}
            onClick={() => enterAs("VIEWER")}
            className="flex w-full items-start gap-3 rounded-card border border-border bg-surface px-4 py-3 text-left transition hover:bg-surface-subtle disabled:opacity-60"
          >
            <Eye size={18} className="mt-0.5 shrink-0 text-ink-faint" />
            <span>
              <span className="block text-sm font-semibold text-ink">Enter as Viewer (read-only)</span>
              <span className="mt-0.5 block text-xs text-ink-muted">
                Can see everything, but the server rejects any approval attempt with a real 403.
              </span>
            </span>
          </button>
        </div>

        {login.isError ? (
          <p className="mb-4 rounded-card bg-danger-subtle px-3 py-2 text-sm text-danger-text">
            {login.error instanceof ApiError ? login.error.message : "Could not sign in."}
          </p>
        ) : null}

        <p className="rounded-card bg-surface-subtle px-3 py-2.5 text-[11px] leading-relaxed text-ink-muted">
          <span className="font-medium text-ink">Why two roles?</span> Approval is real backend state — an{" "}
          <code className="font-mono">Approval</code> row references a real user, so &ldquo;a human approved
          this&rdquo; is verifiable rather than asserted. Sign in as Viewer and try to approve to see the gate
          enforced server-side.
        </p>

        <button
          type="button"
          onClick={() => setShowManual((v) => !v)}
          aria-expanded={showManual}
          className="mt-4 flex w-full items-center justify-center gap-1 text-xs text-ink-faint hover:text-ink"
        >
          <ChevronDown size={12} className={showManual ? "rotate-180 transition" : "transition"} />
          Sign in with credentials instead
        </button>

        {showManual ? (
          <form onSubmit={handleManual} className="mt-3 space-y-3 border-t border-border pt-4">
            <label className="block">
              <span className="text-xs font-medium text-ink-muted">Email</span>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink focus:border-brand-500 focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-ink-muted">Password</span>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink focus:border-brand-500 focus:outline-none"
              />
            </label>
            <button
              type="submit"
              disabled={login.isPending}
              className="flex w-full items-center justify-center gap-1.5 rounded-md bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              <LogIn size={14} />
              {login.isPending ? "Signing in…" : "Sign in"}
            </button>
          </form>
        ) : null}
      </div>
    </div>
  );
}
