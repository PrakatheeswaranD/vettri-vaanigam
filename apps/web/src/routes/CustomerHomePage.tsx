import { Link } from "react-router-dom";
import { ArrowRight, Bot, Receipt, Search, ShieldCheck } from "lucide-react";

export default function CustomerHomePage() {
  return <div className="space-y-6">
    <section className="rounded-card border border-brand-200 bg-gradient-to-br from-brand-50 to-surface p-7">
      <p className="text-xs font-bold uppercase tracking-wider text-brand-600">Customer · Buy with AI</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">Tell your Buyer Agent what you need.</h1>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-muted">It will clarify your intent, discover AI-ready products, compare fit—not only price—and create an explainable purchase proposal before any money action.</p>
      <Link to="/customer/buyer-agent" className="mt-6 inline-flex items-center gap-2 rounded-md bg-brand-600 px-5 py-3 text-sm font-semibold text-white">Start with “I need a laptop” <ArrowRight size={15} /></Link>
    </section>
    <div className="grid gap-4 md:grid-cols-3">
      {[[Search, "Discover", "Search structured, AI-readable catalogs."], [ShieldCheck, "Stay in control", "Policy, risk, and approval gates are always visible."], [Receipt, "Follow every rupee", "See payment state, failures, and safe recovery."]].map(([Icon, title, text]) => { const ItemIcon = Icon as typeof Bot; return <article key={String(title)} className="rounded-card border border-border bg-surface p-5"><ItemIcon className="text-brand-600" /><h2 className="mt-4 font-bold">{String(title)}</h2><p className="mt-2 text-sm text-ink-muted">{String(text)}</p></article>; })}
    </div>
  </div>;
}
