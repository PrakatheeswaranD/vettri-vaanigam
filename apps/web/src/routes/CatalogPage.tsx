import { useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, AlertTriangle, Package, Search, SlidersHorizontal } from "lucide-react";
import { useCatalog, useCatalogCategories, useCatalogQualitySummary } from "../hooks/use-api";
import { useCommerceProducts } from "../hooks/use-commerce";
import type { CommerceProductDTO } from "@razorgrowth/contracts";
import { Card, CardBody } from "../components/ui/Card";
import { EmptyState, ErrorState, Skeleton } from "../components/ui/States";
import { ProductReadinessBadge } from "../components/readiness/ProductReadinessBadge";
import { formatMoney } from "../lib/format";
import { ApiError } from "../lib/api-client";
import { PageHeader } from "../components/layout/PageHeader";
import { CatalogCompiler } from "../components/catalog/CatalogCompiler";
import { CatalogGaps } from "../components/catalog/CatalogGaps";
import { AddProductModal } from "../components/catalog/AddProductModal";

const AVAILABILITY_OPTIONS = [
  { value: "", label: "Any availability" },
  { value: "IN_STOCK", label: "In stock" },
  { value: "LOW_STOCK", label: "Low stock" },
  { value: "OUT_OF_STOCK", label: "Out of stock" },
  { value: "UNAVAILABLE", label: "Unavailable" },
  { value: "UNKNOWN", label: "Unknown inventory" },
];

/**
 * What a product has actually done, under what it costs.
 *
 * Sales are PAID-only and whole-history — an abandoned basket contributes
 * nothing. A product that has never sold says so in words rather than
 * showing a row of zeroes, because "0 sold" and "no data yet" read the
 * same and mean different things to a merchant deciding what to fix.
 */
function PerformanceLine({
  overlay,
  currency,
}: {
  overlay: CommerceProductDTO | undefined;
  currency: string | undefined;
}) {
  if (!overlay) return null;
  const { unitsSold, revenueMinor } = overlay.performance;
  const needsWork = overlay.aiReadiness.state !== "AGENT_READY";

  return (
    <div className="mt-1 flex items-center justify-between gap-2 border-t border-border-hair pt-2 text-xs">
      <span className="text-ink-muted">
        {unitsSold === 0
          ? "Not sold yet"
          : `${unitsSold} sold · ${currency ? formatMoney({ amountMinor: revenueMinor, currency: currency as "INR" | "USD" }) : revenueMinor}`}
      </span>
      {needsWork ? (
        <span className="shrink-0 text-ink-faint">
          {overlay.aiReadiness.missingCritical.length + overlay.aiReadiness.missingImportant.length} gap
          {overlay.aiReadiness.missingCritical.length + overlay.aiReadiness.missingImportant.length === 1 ? "" : "s"}
        </span>
      ) : null}
    </div>
  );
}

export default function CatalogPage() {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("");
  const [availability, setAvailability] = useState<string>("");
  const [minPrice, setMinPrice] = useState<string>("");
  const [maxPrice, setMaxPrice] = useState<string>("");
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(1);

  const { data: categories } = useCatalogCategories();
  const { data: quality } = useCatalogQualitySummary();
  /**
   * The operational overlay: how each product has actually performed, and
   * which Growth findings attach to it.
   *
   * A SEPARATE call on purpose. The catalogue endpoint browses, filters
   * and paginates; this one carries only what the catalogue does not.
   * Merging them would put two copies of every product's name and price on
   * one screen, free to disagree the moment either changes.
   */
  const overlay = useCommerceProducts();

  const performanceById = new Map((overlay.data?.products ?? []).map((row) => [row.productId, row]));

  const { data, isLoading, isError, error, refetch } = useCatalog({
    page,
    limit: 12,
    search: search || undefined,
    category: category || undefined,
    availability: availability || undefined,
    minPriceMinor: minPrice ? Math.round(Number(minPrice) * 100) : undefined,
    maxPriceMinor: maxPrice ? Math.round(Number(maxPrice) * 100) : undefined,
  });

  const priceRangeInvalid = minPrice !== "" && maxPrice !== "" && Number(minPrice) > Number(maxPrice);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <PageHeader
          title={"Products"}
          lead={"Your catalogue as an AI agent sees it — the price, stock and details it reads before deciding whether it can buy."}
        />

      <CatalogGaps />

      <CatalogCompiler />
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search products…"
              className="w-full rounded-md border border-border bg-surface py-2 pl-8 pr-3 text-sm text-ink placeholder:text-ink-faint focus:border-brand-500 sm:w-56"
            />
          </div>
          <select
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setPage(1);
            }}
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink focus:border-brand-500"
          >
            <option value="">All categories</option>
            {categories?.items.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setShowFilters((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink hover:bg-surface-subtle"
            aria-expanded={showFilters}
          >
            <SlidersHorizontal size={14} />
            Filters
          </button>
          <AddProductModal />
        </div>
      </div>

      {quality ? (
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-card bg-surface-subtle px-4 py-3">
            <p className="text-xl font-semibold text-ink">{quality.activeProducts}</p>
            <p className="text-xs text-ink-muted">Products</p>
          </div>
          <div className="rounded-card bg-success-subtle px-4 py-3">
            <p className="flex items-center gap-1.5 text-xl font-semibold text-success-text">
              <CheckCircle2 size={16} /> {quality.agentReadyProducts}
            </p>
            <p className="text-xs text-success-text">Agent Ready</p>
          </div>
          <div className="rounded-card bg-warning-subtle px-4 py-3">
            <p className="flex items-center gap-1.5 text-xl font-semibold text-warning-text">
              <AlertTriangle size={16} /> {quality.partiallyReadyProducts + quality.notReadyProducts}
            </p>
            <p className="text-xs text-warning-text">Needs Attention</p>
          </div>
        </div>
      ) : null}

      {showFilters ? (
        <Card>
          <CardBody className="flex flex-wrap items-end gap-4">
            <label className="flex flex-col gap-1 text-xs text-ink-muted">
              Min price (₹)
              <input
                type="number"
                min={0}
                value={minPrice}
                onChange={(e) => {
                  setMinPrice(e.target.value);
                  setPage(1);
                }}
                className="w-28 rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-ink focus:border-brand-500"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-ink-muted">
              Max price (₹)
              <input
                type="number"
                min={0}
                value={maxPrice}
                onChange={(e) => {
                  setMaxPrice(e.target.value);
                  setPage(1);
                }}
                className="w-28 rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-ink focus:border-brand-500"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-ink-muted">
              Availability
              <select
                value={availability}
                onChange={(e) => {
                  setAvailability(e.target.value);
                  setPage(1);
                }}
                className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-ink focus:border-brand-500"
              >
                {AVAILABILITY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
            {priceRangeInvalid ? (
              <p className="text-xs text-danger-text">Minimum price cannot exceed maximum price.</p>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-44 w-full" />
          ))}
        </div>
      ) : isError ? (
        <Card>
          <ErrorState
            message={error instanceof ApiError ? error.message : "Could not load the catalog."}
            onRetry={() => refetch()}
          />
        </Card>
      ) : !data || data.items.length === 0 ? (
        <Card>
          <EmptyState icon={<Package size={18} />} title="No products found" description="Try a different search term or filters." />
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {data.items.map((product) => (
              <Link key={product.id} to={`/merchant/commerce/products/${product.id}`}>
                <Card className="h-full transition-shadow hover:shadow-popover">
                  <CardBody className="flex h-full flex-col gap-2">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-xs font-medium text-brand-600">{product.category}</span>
                      <ProductReadinessBadge state={product.readiness} />
                    </div>
                    <span className="text-sm font-semibold text-ink">{product.name}</span>
                    <span className="text-xs text-ink-faint">{product.brand}</span>
                    <div className="mt-auto flex items-center justify-between pt-2 text-sm">
                      <span className="font-medium text-ink">
                        {product.minPrice ? formatMoney(product.minPrice) : "—"}
                      </span>
                      <span
                        className={
                          product.totalAvailable > 0 ? "text-xs text-success-text" : "text-xs text-danger-text"
                        }
                      >
                        {product.totalAvailable > 0 ? `${product.totalAvailable} in stock` : "Out of stock"}
                      </span>
                    </div>
                    <PerformanceLine overlay={performanceById.get(product.id)} currency={overlay.data?.currency} />
                  </CardBody>
                </Card>
              </Link>
            ))}
          </div>

          <div className="flex items-center justify-between text-sm text-ink-muted">
            <span>
              Page {data.pagination.page} of {data.pagination.totalPages} · {data.pagination.total} products
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded-md border border-border px-3 py-1.5 disabled:opacity-40"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={page >= data.pagination.totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="rounded-md border border-border px-3 py-1.5 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
