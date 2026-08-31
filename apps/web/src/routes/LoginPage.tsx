import { useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Bot, ShieldCheck, Store } from "lucide-react";
import { useLogin } from "../hooks/use-auth";
import { ApiError } from "../lib/api-client";
import { ROLE_HOME, setExperienceRole, type ExperienceRole } from "../lib/experience-role";

const DEMO_ACCOUNTS = {
  merchant: { email: "owner@meridianathletics.demo", password: "MeridianDemo!2026" },
  customer: { email: "customer@anumati.demo", password: "CustomerDemo!2026" },
  admin: { email: "admin@anumati.demo", password: "AdminDemo!2026" },
};
const ROLE_COPY: Record<ExperienceRole, { title: string; purpose: string; icon: typeof Bot; accent: string }> = {
  customer: { title: "Customer", purpose: "Buy with AI", icon: Bot, accent: "bg-brand-50 border-brand-200 text-brand-700" },
  merchant: { title: "Merchant", purpose: "Grow with AI", icon: Store, accent: "bg-success-subtle border-success/30 text-success-text" },
  admin: { title: "Razorpay Admin", purpose: "Enable and govern AI commerce", icon: ShieldCheck, accent: "bg-warning-subtle border-warning/30 text-warning-text" },
};

export default function LoginPage() {
  const { role: rawRole } = useParams();
  const role = rawRole as ExperienceRole | undefined;
  const login = useLogin();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  if (role && !(role in ROLE_COPY)) return <Navigate to="/login" replace />;

  async function signIn(targetRole: ExperienceRole, credentials = DEMO_ACCOUNTS[targetRole]) {
    try {
      await login.mutateAsync({ ...credentials, experience: targetRole });
      setExperienceRole(targetRole);
      navigate(ROLE_HOME[targetRole], { replace: true });
    } catch { /* error is rendered below */ }
  }

  if (!role) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-subtle px-4 py-10">
        <div className="w-full max-w-4xl">
          <div className="mb-8 text-center">
            <p className="text-xs font-semibold uppercase tracking-widest text-brand-600">Anumati · Razorpay Track 01</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-ink">Choose your agentic-commerce experience</h1>
            <p className="mt-2 text-sm text-ink-muted">Three roles. Three distinct jobs. One governed commerce layer.</p>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {(Object.entries(ROLE_COPY) as [ExperienceRole, (typeof ROLE_COPY)[ExperienceRole]][]).map(([key, item]) => (
              <Link key={key} to={`/login/${key}`} className={`rounded-card border p-6 shadow-card transition hover:-translate-y-0.5 hover:shadow-popover ${item.accent}`}>
                <item.icon size={28} />
                <h2 className="mt-5 text-xl font-bold">{item.title}</h2>
                <p className="mt-1 text-sm font-semibold">{item.purpose}</p>
                <p className="mt-5 text-xs opacity-75">Open dedicated login →</p>
              </Link>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const copy = ROLE_COPY[role];
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-subtle px-4 py-10">
      <div className="w-full max-w-md rounded-card border border-border bg-surface p-7 shadow-popover">
        <Link to="/login" className="mb-6 inline-flex items-center gap-1 text-xs text-ink-muted hover:text-ink"><ArrowLeft size={13} /> All roles</Link>
        <div className={`inline-flex rounded-lg border p-3 ${copy.accent}`}><copy.icon size={24} /></div>
        <h1 className="mt-4 text-2xl font-bold text-ink">{copy.title} login</h1>
        <p className="mt-1 text-sm font-medium text-ink-muted">{copy.purpose}</p>
        <button type="button" disabled={login.isPending} onClick={() => void signIn(role)} className="mt-6 w-full rounded-md bg-brand-600 px-4 py-3 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
          {login.isPending ? "Entering demo…" : `Enter ${copy.title} demo`}
        </button>
        <div className="my-5 flex items-center gap-3 text-[11px] uppercase tracking-wider text-ink-faint"><span className="h-px flex-1 bg-border" />or use credentials<span className="h-px flex-1 bg-border" /></div>
        <form onSubmit={(event) => { event.preventDefault(); void signIn(role, { email, password }); }} className="space-y-3">
          <input aria-label="Email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} className="w-full rounded-md border border-border px-3 py-2 text-sm" />
          <input aria-label="Password" type="password" required value={password} onChange={(event) => setPassword(event.target.value)} className="w-full rounded-md border border-border px-3 py-2 text-sm" />
          <button disabled={login.isPending} className="w-full rounded-md border border-border px-4 py-2.5 text-sm font-medium hover:bg-surface-subtle">Sign in</button>
        </form>
        {login.isError ? <p className="mt-4 rounded-md bg-danger-subtle p-3 text-sm text-danger-text">{login.error instanceof ApiError ? login.error.message : "Could not sign in."}</p> : null}
        <p className="mt-5 text-[11px] leading-relaxed text-ink-faint">Each demo uses a distinct authenticated account. The server enforces its role; selecting a login screen does not grant access.</p>
      </div>
    </div>
  );
}
