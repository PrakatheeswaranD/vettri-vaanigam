import { useState } from "react";
import { Bot, CheckCircle2, Code2, Package, Store } from "lucide-react";
import type { AgentReadableProductDTO } from "@razorgrowth/contracts";
import { useMarketplaceDiscovery } from "../hooks/use-api";
import { formatMoney } from "../lib/format";
import { ErrorState, Skeleton } from "../components/ui/States";
import { PaymentProposalModal } from "../components/buyer-agent/PaymentProposalModal";

export default function MarketplaceDiscoverPage() {
  const marketplace = useMarketplaceDiscovery();
  const [agentView, setAgentView] = useState<AgentReadableProductDTO | null>(null);
  const [purchase, setPurchase] = useState<{ product: AgentReadableProductDTO; variantId: string } | null>(null);
  const products = marketplace.data?.merchants.flatMap((merchant) => merchant.products.map((product) => ({ merchant, product }))) ?? [];

  return <div className="space-y-6">
    <header><p className="text-xs font-bold uppercase tracking-wider text-brand-600">Multi-merchant discovery</p><h1 className="mt-1 text-2xl font-bold">AI-ready merchants</h1><p className="mt-2 text-sm text-ink-muted">Products are normalized from merchant-authored catalogs. Availability, policies, attributes, and checkout capability remain explicit.</p></header>
    {marketplace.isLoading ? <Skeleton className="h-64" /> : marketplace.isError ? <ErrorState message="Could not discover marketplace merchants." onRetry={() => marketplace.refetch()} /> : <>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3"><Stat icon={<Store size={16} />} label="Merchants discovered" value={marketplace.data?.merchantCount ?? 0} /><Stat icon={<Package size={16} />} label="Products normalized" value={marketplace.data?.productCount ?? 0} /><Stat icon={<Bot size={16} />} label="Agentic checkout" value="Enabled" /></div>
      <section className="overflow-hidden rounded-card border border-border bg-surface">
        <div className="overflow-x-auto"><table className="w-full min-w-[800px] text-left text-sm"><thead className="bg-surface-subtle text-xs uppercase tracking-wider text-ink-faint"><tr><th className="p-4">Merchant / Product</th><th className="p-4">Price</th><th className="p-4">RAM</th><th className="p-4">Storage</th><th className="p-4">Availability</th><th className="p-4">Returns</th><th className="p-4">AI checkout</th><th className="p-4">Representation</th></tr></thead><tbody>
          {products.map(({ merchant, product }) => { const variant = product.variants[0]; return <tr key={product.productId} className="border-t border-border"><td className="p-4"><p className="font-semibold">{merchant.name}</p><p className="text-xs text-ink-muted">{product.identity.name}</p></td><td className="p-4 font-semibold">{product.commerce.priceRange ? formatMoney({ amountMinor: product.commerce.priceRange.minMinor, currency: product.commerce.priceRange.currency }) : "Unknown"}</td><td className="p-4">{variant?.attributes.ram ?? "—"}</td><td className="p-4">{variant?.attributes.storage ?? "—"}</td><td className="p-4">{variant?.availability.state.replaceAll("_", " ") ?? "UNKNOWN"}</td><td className="max-w-48 p-4 text-xs text-ink-muted">{product.policies.returns.summary ?? "Unknown"}</td><td className="p-4"><span className="inline-flex items-center gap-1 text-success-text"><CheckCircle2 size={14} /> Yes</span></td><td className="p-4"><button onClick={() => setAgentView(product)} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600"><Code2 size={13} /> View AI JSON</button></td></tr>; })}
        </tbody></table></div>
      </section>
      <section className="grid gap-3 md:grid-cols-3" aria-label="Purchase from marketplace">
        {products.map(({ merchant, product }) => <div key={product.productId} className="rounded-card border border-border bg-surface p-4">
          <h2 className="font-semibold">{product.identity.name}</h2><p className="text-xs text-ink-muted">Sold by {merchant.name}</p>
          {product.variants.map((variant) => <button key={variant.variantId} disabled={!["IN_STOCK", "LOW_STOCK"].includes(variant.availability.state)} onClick={() => setPurchase({ product, variantId: variant.variantId })} className="mt-3 block rounded-lg bg-brand-600 px-3 py-2 text-sm text-white disabled:opacity-50">Review purchase · {variant.sku} · {formatMoney(variant.price)}</button>)}
        </div>)}
      </section>
    </>}
    {purchase ? <PaymentProposalModal recommendation={purchase} onClose={() => setPurchase(null)} /> : null}
    {agentView ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4" role="dialog" aria-modal="true"><div className="max-h-[85vh] w-full max-w-3xl overflow-hidden rounded-card bg-surface shadow-popover"><div className="flex items-center justify-between border-b border-border p-4"><div><p className="font-bold">AI-readable representation</p><p className="text-xs text-ink-muted">Canonical structured catalog record</p></div><button onClick={() => setAgentView(null)} className="rounded-md border border-border px-3 py-1.5 text-sm">Close</button></div><pre className="max-h-[70vh] overflow-auto bg-surface-subtle p-5 text-xs leading-relaxed">{JSON.stringify(agentView, null, 2)}</pre></div></div> : null}
  </div>;
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | number }) { return <div className="rounded-card border border-border bg-surface p-4"><div className="text-brand-600">{icon}</div><p className="mt-3 text-xl font-bold">{value}</p><p className="text-xs text-ink-muted">{label}</p></div>; }
