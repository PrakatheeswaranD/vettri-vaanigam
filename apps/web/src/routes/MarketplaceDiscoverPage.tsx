/**
 * What a shopper's agent can actually see and buy, across merchants.
 *
 * WHAT THIS REPLACED, AND WHY
 *
 * The page rendered the same products TWICE: a wide table, and below it a
 * grid of cards repeating every product with one button per variant
 * labelled by raw SKU ("Review purchase · MERIDIANSUMMITTRAIL-UK9 ·
 * ₹5,802.00"). Two lists of one thing is not two features.
 *
 * The table carried "RAM" and "Storage" columns, left over from a laptop
 * fixture that no longer exists in this catalogue. Every row printed "—"
 * in both, so a third of the table's width was reserved for data that
 * could never arrive. Attributes are now read FROM the products being
 * shown, so the columns describe whatever is actually being sold.
 *
 * Availability was taken from `variants[0]` — an arbitrary variant, not a
 * summary — so a product with one sold-out size read as unavailable. It
 * is now derived across the purchasable variants, the same way the
 * agent's own eligibility check treats a product.
 *
 * And the header counted the products on screen, not the products that
 * exist: the request took the server's default page of 10 and the stat
 * said "Products normalized: 10" for a merchant publishing 25.
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Bot, Code2, Package, Store, X } from "lucide-react";
import type { AgentReadableProductDTO, MarketplaceMerchantDTO } from "@razorgrowth/contracts";
import { clsx } from "clsx";
import { useMarketplaceDiscovery } from "../hooks/use-api";
import { formatMoney } from "../lib/format";
import { Card } from "../components/ui/Card";
import { EmptyState, ErrorState, Skeleton } from "../components/ui/States";
import { PageHeader } from "../components/layout/PageHeader";
import { PaymentProposalModal } from "../components/buyer-agent/PaymentProposalModal";

const BUYABLE_STATES = new Set(["IN_STOCK", "LOW_STOCK"]);

const AVAILABILITY_COPY: Record<string, { label: string; className: string }> = {
  IN_STOCK: { label: "In stock", className: "bg-success-subtle text-success-text" },
  LOW_STOCK: { label: "Low stock", className: "bg-warning-subtle text-warning-text" },
  OUT_OF_STOCK: { label: "Out of stock", className: "bg-danger-subtle text-danger-text" },
  UNAVAILABLE: { label: "Unavailable", className: "bg-danger-subtle text-danger-text" },
  UNKNOWN: { label: "Stock unknown", className: "bg-surface-sunken text-ink-muted" },
};

/**
 * The best state across a product's variants, not the first one's.
 * "One size is in stock" and "the first size listed is out of stock" are
 * different facts, and only the first is what a buyer needs.
 */
function productAvailability(product: AgentReadableProductDTO): string {
  const states = product.variants.filter((variant) => variant.active).map((variant) => variant.availability.state);
  if (states.includes("IN_STOCK")) return "IN_STOCK";
  if (states.includes("LOW_STOCK")) return "LOW_STOCK";
  if (states.includes("UNKNOWN")) return "UNKNOWN";
  if (states.includes("OUT_OF_STOCK")) return "OUT_OF_STOCK";
  return states[0] ?? "UNKNOWN";
}

/** The attribute keys that actually appear in what is being shown —
 * never a fixed list of columns the catalogue may not have. */
function attributeColumns(products: AgentReadableProductDTO[]): string[] {
  const counts = new Map<string, number>();
  for (const product of products) {
    const keys = new Set(product.variants.flatMap((variant) => Object.keys(variant.attributes)));
    for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([key]) => key);
}

function attributeValues(product: AgentReadableProductDTO, key: string): string {
  const values = [...new Set(product.variants.map((variant) => variant.attributes[key]).filter(Boolean))];
  return values.length ? values.join(", ") : "—";
}

export default function MarketplaceDiscoverPage() {
  const marketplace = useMarketplaceDiscovery();
  const [agentView, setAgentView] = useState<AgentReadableProductDTO | null>(null);
  const [purchase, setPurchase] = useState<{ product: AgentReadableProductDTO; variantId: string } | null>(null);

  const rows = useMemo(
    () =>
      marketplace.data?.merchants.flatMap((merchant: MarketplaceMerchantDTO) =>
        merchant.products.map((product) => ({ merchant, product })),
      ) ?? [],
    [marketplace.data],
  );
  const columns = useMemo(() => attributeColumns(rows.map((row) => row.product)), [rows]);

  const shown = marketplace.data?.productCount ?? 0;
  const total = marketplace.data?.productTotal ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI-ready merchants"
        lead="Catalogues normalized from what each merchant publishes. Price, stock, attributes and return terms stay explicit — nothing here is inferred."
      />

      {marketplace.isLoading ? (
        <div className="space-y-4" role="status" aria-label="Discovering merchants">
          <Skeleton className="h-24" />
          <Skeleton className="h-80" />
        </div>
      ) : marketplace.isError ? (
        <Card><ErrorState message="Could not discover marketplace merchants." onRetry={() => void marketplace.refetch()} /></Card>
      ) : rows.length === 0 ? (
        <Card><EmptyState title="No AI-ready merchants yet" description="A merchant appears here once they publish an agent-readable catalogue." icon={<Store size={18} />} /></Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Stat icon={<Store size={16} />} label="Merchants discovered" value={marketplace.data?.merchantCount ?? 0} />
            <Stat
              icon={<Package size={16} />}
              label={shown < total ? `Products shown of ${total} published` : "Products published"}
              value={shown}
            />
            <Stat icon={<Bot size={16} />} label="Agentic checkout" value="Enabled" />
          </div>

          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-left text-sm">
                <caption className="sr-only">Products discoverable by an AI buyer agent, across merchants</caption>
                <thead className="bg-surface-subtle text-micro uppercase tracking-wider text-ink-faint">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-semibold">Product</th>
                    <th scope="col" className="px-4 py-3 font-semibold">From</th>
                    {columns.map((key) => (
                      <th key={key} scope="col" className="px-4 py-3 font-semibold capitalize">{key}</th>
                    ))}
                    <th scope="col" className="px-4 py-3 font-semibold">Availability</th>
                    <th scope="col" className="px-4 py-3 font-semibold">Returns</th>
                    <th scope="col" className="px-4 py-3 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ merchant, product }) => {
                    const state = productAvailability(product);
                    const availability = AVAILABILITY_COPY[state] ?? AVAILABILITY_COPY.UNKNOWN!;
                    const buyable = product.variants.find(
                      (variant) => variant.active && BUYABLE_STATES.has(variant.availability.state),
                    );
                    return (
                      <tr key={product.productId} className="border-t border-border-hair align-top hover:bg-surface-subtle/60">
                        <td className="px-4 py-3">
                          <Link
                            to={`/customer/product/${product.productId}`}
                            className="rounded font-medium text-ink transition hover:text-brand-700 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
                          >
                            {product.identity.name}
                          </Link>
                          <p className="mt-0.5 text-xs text-ink-faint">
                            {product.identity.category} · {product.variants.length} option{product.variants.length === 1 ? "" : "s"}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-ink-muted">{merchant.name}</p>
                          <p className="mt-0.5 font-semibold tabular-nums text-ink">
                            {product.commerce.priceRange
                              ? formatMoney({ amountMinor: product.commerce.priceRange.minMinor, currency: product.commerce.priceRange.currency })
                              : "No price recorded"}
                          </p>
                        </td>
                        {columns.map((key) => (
                          <td key={key} className="px-4 py-3 text-ink-muted">{attributeValues(product, key)}</td>
                        ))}
                        <td className="px-4 py-3">
                          <span className={clsx("inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium", availability.className)}>
                            {availability.label}
                          </span>
                        </td>
                        <td className="max-w-56 px-4 py-3 text-xs text-ink-muted">
                          {product.policies.returns.summary ?? "Not published"}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => setAgentView(product)}
                              className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-ink-muted transition hover:bg-surface hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
                            >
                              <Code2 size={13} aria-hidden /> AI JSON
                            </button>
                            <button
                              type="button"
                              disabled={!buyable}
                              title={buyable ? undefined : "No option of this product is purchasable right now"}
                              onClick={() => buyable && setPurchase({ product, variantId: buyable.variantId })}
                              className="rounded-md bg-brand-600 px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              Review purchase
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {purchase ? <PaymentProposalModal recommendation={purchase} onClose={() => setPurchase(null)} /> : null}

      {agentView ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4" role="dialog" aria-modal="true" aria-label="AI-readable representation">
          <div className="max-h-[85vh] w-full max-w-3xl overflow-hidden rounded-card bg-surface shadow-popover">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <p className="font-semibold text-ink">{agentView.identity.name}</p>
                <p className="text-xs text-ink-muted">The structured record an AI buyer reads for this product</p>
              </div>
              <button
                type="button"
                onClick={() => setAgentView(null)}
                aria-label="Close AI-readable representation"
                className="rounded-md border border-border p-1.5 text-ink-muted transition hover:bg-surface-subtle hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
              >
                <X size={16} aria-hidden />
              </button>
            </div>
            <pre className="max-h-[70vh] overflow-auto bg-surface-subtle p-5 text-xs leading-relaxed">
              {JSON.stringify(agentView, null, 2)}
            </pre>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | number }) {
  return (
    <Card className="p-4">
      <div className="text-brand-600">{icon}</div>
      <p className="mt-3 text-xl font-bold tabular-nums text-ink">{value}</p>
      <p className="mt-0.5 text-xs text-ink-muted">{label}</p>
    </Card>
  );
}
