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
 * Availability was taken from `variants[0]` — an arbitrary variant, not a
 * summary — so a product with one sold-out size read as unavailable. It
 * is now derived across the purchasable variants, the same way the
 * agent's own eligibility check treats a product.
 *
 * WHAT THE SECOND PASS FIXED, AND WHY
 *
 * The table had grown a column per attribute, chosen from whatever the
 * whole result set happened to share. That works for one catalogue and
 * falls apart across a marketplace: with laptops and running shoes on the
 * same screen, every laptop printed "—" under Size and Feature, and two
 * columns of nothing pushed the useful ones into a squeeze. Attributes
 * are now summarised INSIDE each row, so a row only ever describes the
 * thing it is about and a mixed marketplace costs no width at all.
 *
 * Two more things were making rows four lines tall: the returns policy
 * was printed in full as prose in a narrow cell, and the action buttons
 * had no `whitespace-nowrap`, so "Review purchase" broke across lines.
 * Returns is now clamped with the full text on hover and on the product
 * page, and it is the first column to drop when space is short — it is
 * the least scannable thing here and the only one available in full
 * elsewhere. It returns at `2xl` rather than `xl` because the breakpoint
 * measures the VIEWPORT and a 256px sidebar stands between that and this
 * table: at `xl` the column came back to a content area that could not
 * hold seven columns, and pushed Actions off the edge.
 *
 * And the dead end: the header honestly said "23 shown of 203 published"
 * and then offered no way to reach the other 180. Each merchant is capped
 * at twenty products per request, so the rest were unreachable by any
 * click on this page. Search now filters SERVER-side across every
 * published product, and the category chips use the filter the discovery
 * endpoint already supported and nothing ever passed.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Bot, Code2, Package, Search, Store, X } from "lucide-react";
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

/**
 * A product's own attributes, summarised for one line.
 *
 * Counting, never inferring: two or fewer values are listed literally
 * ("waterproof"), more are counted ("6 sizes"), and the full list is on
 * the chip's tooltip. A shoe and a laptop can therefore sit in the same
 * column without either being described in the other's vocabulary.
 */
interface OptionChip {
  key: string;
  label: string;
  showKey: boolean;
  title: string;
}

function optionChips(product: AgentReadableProductDTO): OptionChip[] {
  const keys = [...new Set(product.variants.flatMap((variant) => Object.keys(variant.attributes)))];
  return keys
    .slice(0, 3)
    .map((key) => {
      const values = [...new Set(product.variants.map((variant) => variant.attributes[key]).filter(Boolean))];
      if (values.length === 0) return null;
      const label = values.length <= 2 ? values.join(" · ") : `${values.length} ${key}${key.endsWith("s") ? "" : "s"}`;
      // Counted labels already name the attribute ("5 sizes"); listed ones
      // do not, and a bare "MEDIUM" answers a question the reader cannot
      // see. Only the listed form needs the key printed alongside it.
      return { key, label, showKey: values.length <= 2, title: `${key}: ${values.join(", ")}` };
    })
    .filter((chip): chip is OptionChip => chip !== null);
}

/** Keeps a fast-typing shopper from firing a request per keystroke. */
function useDebounced<T>(value: T, delay = 320): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setSettled(value), delay);
    return () => window.clearTimeout(id);
  }, [value, delay]);
  return settled;
}

export default function MarketplaceDiscoverPage() {
  const [category, setCategory] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const search = useDebounced(query.trim());

  const marketplace = useMarketplaceDiscovery({
    category: category ?? undefined,
    search: search.length > 1 ? search : undefined,
  });
  const [agentView, setAgentView] = useState<AgentReadableProductDTO | null>(null);
  const [purchase, setPurchase] = useState<{ product: AgentReadableProductDTO; variantId: string } | null>(null);

  const rows = useMemo(
    () =>
      marketplace.data?.merchants.flatMap((merchant: MarketplaceMerchantDTO) =>
        merchant.products.map((product) => ({ merchant, product })),
      ) ?? [],
    [marketplace.data],
  );

  // Remembered from the UNFILTERED result: once a category is applied the
  // response only contains that category, and deriving the chips from it
  // would leave a shopper with one chip and no way back.
  const [categories, setCategories] = useState<string[]>([]);
  const filtered = category !== null || search.length > 1;
  useEffect(() => {
    if (filtered || rows.length === 0) return;
    setCategories([...new Set(rows.map((row) => row.product.identity.category))].sort());
  }, [rows, filtered]);

  const shown = marketplace.data?.productCount ?? 0;
  const total = marketplace.data?.productTotal ?? 0;

  function clearFilters() {
    setCategory(null);
    setQuery("");
  }

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
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Stat icon={<Store size={16} />} label="Merchants discovered" value={marketplace.data?.merchantCount ?? 0} />
            <Stat
              icon={<Package size={16} />}
              label={shown < total ? `Products listed of ${total} matching` : "Products published"}
              value={shown}
            />
            <Stat icon={<Bot size={16} />} label="Agentic checkout" value="Enabled" />
          </div>

          {/* Filters. The endpoint has always accepted a category; nothing
              ever passed one, so a shopper's only view of a 203-product
              marketplace was the first twenty per merchant. */}
          <Card className="p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <label className="relative w-full lg:max-w-sm">
                <span className="sr-only">Search products across merchants</span>
                <Search
                  size={15}
                  aria-hidden
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint"
                />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search every published product…"
                  className="w-full rounded-md border border-border bg-surface py-2 pl-9 pr-3 text-sm text-ink placeholder:text-ink-faint focus:border-brand-500 focus:outline-none"
                />
              </label>

              {categories.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setCategory(null)}
                    aria-pressed={category === null}
                    className={chipClass(category === null)}
                  >
                    All categories
                  </button>
                  {categories.map((name) => (
                    <button
                      key={name}
                      type="button"
                      onClick={() => setCategory(name)}
                      aria-pressed={category === name}
                      className={chipClass(category === name)}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <p className="mt-3 text-xs text-ink-faint">
              Up to 20 products are listed per merchant. Search filters across every published product, not just the
              ones on screen.
            </p>
          </Card>

          {rows.length === 0 ? (
            <Card>
              <EmptyState
                title={filtered ? "No products match those filters" : "No AI-ready merchants yet"}
                description={
                  filtered
                    ? "Try a different term, or clear the filters to see the full marketplace."
                    : "A merchant appears here once they publish an agent-readable catalogue."
                }
                icon={<Store size={18} />}
                action={
                  filtered ? (
                    <button
                      type="button"
                      onClick={clearFilters}
                      className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-ink transition hover:bg-surface-subtle"
                    >
                      Clear filters
                    </button>
                  ) : undefined
                }
              />
            </Card>
          ) : (
            <Card className={clsx("overflow-hidden", marketplace.isFetching && "opacity-70 transition-opacity")}>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <caption className="sr-only">Products discoverable by an AI buyer agent, across merchants</caption>
                  <thead className="bg-surface-subtle text-micro uppercase tracking-wider text-ink-faint">
                    <tr>
                      <th scope="col" className="px-4 py-3 font-semibold">Product</th>
                      <th scope="col" className="px-4 py-3 font-semibold">Merchant</th>
                      <th scope="col" className="px-4 py-3 text-right font-semibold">Price</th>
                      <th scope="col" className="px-4 py-3 font-semibold">Options</th>
                      <th scope="col" className="px-4 py-3 font-semibold">Availability</th>
                      <th scope="col" className="hidden px-4 py-3 font-semibold 2xl:table-cell">Returns</th>
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
                      const chips = optionChips(product);
                      const range = product.commerce.priceRange;
                      const returns = product.policies.returns.summary;
                      return (
                        <tr key={product.productId} className="border-t border-border-hair align-top hover:bg-surface-subtle/60">
                          <td className="px-4 py-3">
                            <Link
                              to={`/customer/product/${product.productId}`}
                              className="rounded font-medium text-ink transition hover:text-brand-700 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
                            >
                              {product.identity.name}
                            </Link>
                            <p className="mt-0.5 text-xs text-ink-faint">{product.identity.category}</p>
                          </td>

                          <td className="whitespace-nowrap px-4 py-3 text-ink-muted">{merchant.name}</td>

                          <td className="whitespace-nowrap px-4 py-3 text-right">
                            {range ? (
                              <>
                                <span className="font-semibold tabular-nums text-ink">
                                  {formatMoney({ amountMinor: range.minMinor, currency: range.currency })}
                                </span>
                                {/* Only says "from" when there is actually a
                                    spread to be from. */}
                                {range.maxMinor > range.minMinor ? (
                                  <span className="block text-xs text-ink-faint">
                                    to {formatMoney({ amountMinor: range.maxMinor, currency: range.currency })}
                                  </span>
                                ) : null}
                              </>
                            ) : (
                              <span className="text-xs text-ink-faint">No price recorded</span>
                            )}
                          </td>

                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-1">
                              {chips.length > 0 ? (
                                chips.map((chip) => (
                                  <span
                                    key={chip.key}
                                    title={chip.title}
                                    className="inline-flex items-center gap-1 rounded border border-border-hair bg-surface-subtle px-1.5 py-0.5 text-xs text-ink-muted"
                                  >
                                    {chip.showKey ? (
                                      <span className="text-ink-faint">{chip.key.replace(/_/g, " ")}</span>
                                    ) : null}
                                    {chip.label.replace(/_/g, " ")}
                                  </span>
                                ))
                              ) : (
                                <span className="text-xs text-ink-faint">
                                  {product.variants.length} option{product.variants.length === 1 ? "" : "s"}
                                </span>
                              )}
                            </div>
                          </td>

                          <td className="whitespace-nowrap px-4 py-3">
                            <span className={clsx("inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium", availability.className)}>
                              {availability.label}
                            </span>
                          </td>

                          {/* Clamped, with the whole policy on hover and in
                              full on the product page. Prose in a narrow
                              cell was making every row four lines tall. */}
                          <td className="hidden max-w-[16rem] px-4 py-3 text-xs text-ink-muted 2xl:table-cell">
                            {returns ? (
                              <span className="line-clamp-2" title={returns}>
                                {returns}
                              </span>
                            ) : (
                              <span className="text-ink-faint">Not published</span>
                            )}
                          </td>

                          <td className="px-4 py-3">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => setAgentView(product)}
                                className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-ink-muted transition hover:bg-surface hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
                              >
                                <Code2 size={13} aria-hidden /> AI JSON
                              </button>
                              <button
                                type="button"
                                disabled={!buyable}
                                title={buyable ? undefined : "No option of this product is purchasable right now"}
                                onClick={() => buyable && setPurchase({ product, variantId: buyable.variantId })}
                                className="whitespace-nowrap rounded-md bg-brand-600 px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-ink-faint"
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
          )}
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

function chipClass(active: boolean): string {
  return clsx(
    "rounded-full border px-3 py-1.5 text-xs font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600",
    active
      ? "border-brand-300 bg-brand-50 text-brand-700"
      : "border-border text-ink-muted hover:bg-surface-subtle hover:text-ink",
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
