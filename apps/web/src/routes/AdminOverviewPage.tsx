import { Link } from "react-router-dom";
import { AlertTriangle, Building2, CheckCircle2, Receipt, ShieldCheck } from "lucide-react";

const metrics = [[Building2, "AI-ready merchants", "4"], [Receipt, "Payments today", "217"], [AlertTriangle, "Open exceptions", "3"], [CheckCircle2, "Webhook health", "99.98%"]] as const;

export default function AdminOverviewPage() {
  return <div className="space-y-6">
    <section className="rounded-card border border-border bg-surface p-6"><p className="text-xs font-bold uppercase tracking-wider text-brand-600">Razorpay Admin</p><h1 className="mt-2 text-2xl font-bold">Enable and govern AI commerce</h1><p className="mt-2 text-sm text-ink-muted">Platform-level visibility for merchant onboarding, readiness, transaction health, risk exceptions, and audit evidence.</p></section>
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{metrics.map(([Icon, label, value]) => <article key={label} className="rounded-card border border-border bg-surface p-5"><Icon size={17} className="text-brand-600" /><p className="mt-4 text-2xl font-bold">{value}</p><p className="text-xs text-ink-muted">{label}</p></article>)}</div>
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-card border border-border bg-surface p-6"><h2 className="font-bold">Governance queue</h2><div className="mt-4 space-y-3"><Row label="TechNova onboarding" state="Ready for review" /><Row label="Debit-credit mismatch" state="Investigation required" danger /><Row label="ByteStore readiness" state="2 blockers" /></div><Link to="/admin/risk" className="mt-5 inline-block text-sm font-semibold text-brand-600">Open risk & exceptions →</Link></section>
      <section className="rounded-card border border-border bg-surface p-6"><div className="flex items-center gap-2"><ShieldCheck size={18} className="text-success" /><h2 className="font-bold">Platform safety posture</h2></div><ul className="mt-4 space-y-3 text-sm text-ink-muted"><li>✓ Payment execution isolated from the LLM</li><li>✓ Duplicate operations protected by idempotency</li><li>✓ Uncertain debit states block automatic retry</li><li>✓ Agent actions recorded in the audit ledger</li></ul></section>
    </div>
  </div>;
}

function Row({ label, state, danger = false }: { label: string; state: string; danger?: boolean }) { return <div className="flex items-center justify-between rounded-md bg-surface-subtle px-3 py-3"><span className="text-sm font-medium">{label}</span><span className={danger ? "text-xs font-semibold text-danger-text" : "text-xs font-semibold text-ink-muted"}>{state}</span></div>; }
