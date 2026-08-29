import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Bot, Truck, Undo2, User } from "lucide-react";
import { useAgentProduct, useProduct } from "../hooks/use-api";
import { Card, CardBody, CardHeader, CardTitle } from "../components/ui/Card";
import { ErrorState, Skeleton } from "../components/ui/States";
import { ProductReadinessBadge } from "../components/readiness/ProductReadinessBadge";
import { formatDateTime, formatMoney } from "../lib/format";
import { ApiError } from "../lib/api-client";
import { clsx } from "clsx";

type ViewMode = "human" | "agent";

export default function ProductDetailPage() {
  const { productId } = useParams();
  const { data: product, isLoading, isError, error, refetch } = useProduct(productId);
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);
  const [mode, setMode] = useState<ViewMode>("human");

  if (isLoading) {
    return <Skeleton className="h-96 w-full" />;
  }

  if (isError || !product) {
    return (
      <Card>
        <ErrorState
          message={error instanceof ApiError ? error.message : "Could not load this product."}
          onRetry={() => refetch()}
        />
      </Card>
    );
  }

  const selectedVariant = product.variants.find((v) => v.id === selectedVariantId) ?? product.variants[0];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link to="/catalog" className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink">
          <ArrowLeft size={14} /> Back to catalog
        </Link>

        {/* PART 02 §61, §121 — the demo moment: same product, two lenses. */}
        <div className="inline-flex rounded-md border border-border bg-surface p-0.5 text-sm">
          <button
            type="button"
            onClick={() => setMode("human")}
            className={clsx(
              "inline-flex items-center gap-1.5 rounded px-3 py-1.5 font-medium",
              mode === "human" ? "bg-brand-50 text-brand-700" : "text-ink-muted hover:text-ink",
            )}
          >
            <User size={14} /> Human View
          </button>
          <button
            type="button"
            onClick={() => setMode("agent")}
            className={clsx(
              "inline-flex items-center gap-1.5 rounded px-3 py-1.5 font-medium",
              mode === "agent" ? "bg-brand-50 text-brand-700" : "text-ink-muted hover:text-ink",
            )}
          >
            <Bot size={14} /> Agent View
          </button>
        </div>
      </div>

      {mode === "human" ? (
        <div className="space-y-6">
          <Card>
            <CardBody className="space-y-4">
              <div>
                <div className="flex items-start justify-between gap-2">
                  <span className="text-xs font-medium text-brand-600">{product.category}</span>
                  <ProductReadinessBadge state={product.readiness} />
                </div>
                <h1 className="text-2xl font-bold tracking-tight text-ink">{product.name}</h1>
                <p className="text-sm text-ink-faint">{product.brand}</p>
              </div>
              <p className="text-sm text-ink-muted">{product.description}</p>

              <div>
                <p className="mb-2 text-xs font-medium text-ink-muted">Variants</p>
                <div className="flex flex-wrap gap-2">
                  {product.variants.map((variant) => (
                    <button
                      key={variant.id}
                      type="button"
                      onClick={() => setSelectedVariantId(variant.id)}
                      className={clsx(
                        "rounded-md border px-3 py-1.5 text-sm",
                        selectedVariant?.id === variant.id
                          ? "border-brand-500 bg-brand-50 text-brand-700"
                          : "border-border text-ink-muted hover:bg-surface-subtle",
                      )}
                    >
                      {(variant.attributes as Record<string, string>).size ?? variant.title}
                    </button>
                  ))}
                </div>
              </div>

              {selectedVariant ? (
                <div className="flex items-center justify-between rounded-card bg-surface-subtle px-4 py-3">
                  <div>
                    <p className="text-lg font-semibold text-ink">{formatMoney(selectedVariant.price)}</p>
                    <p className="text-xs text-ink-faint">SKU {selectedVariant.sku}</p>
                  </div>
                  <span
                    className={clsx(
                      "text-sm font-medium",
                      (selectedVariant.inventory?.availableQuantity ?? 0) > 0 ? "text-success-text" : "text-danger-text",
                    )}
                  >
                    {(selectedVariant.inventory?.availableQuantity ?? 0) > 0
                      ? `${selectedVariant.inventory?.availableQuantity} available`
                      : "Out of stock"}
                  </span>
                </div>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Policies</CardTitle>
            </CardHeader>
            <CardBody className="space-y-3 text-sm">
              <div className="flex gap-2">
                <Undo2 size={16} className="mt-0.5 shrink-0 text-ink-faint" />
                <span className="text-ink-muted">
                  {product.returnPolicySummary ?? "No structured return policy has been added for this product yet."}
                </span>
              </div>
              <div className="flex gap-2">
                <Truck size={16} className="mt-0.5 shrink-0 text-ink-faint" />
                <span className="text-ink-muted">
                  {product.shippingSummary ?? "No structured shipping information has been added for this product yet."}
                </span>
              </div>
            </CardBody>
          </Card>
        </div>
      ) : (
        <AgentView productId={product.id} />
      )}
    </div>
  );
}

function AgentView({ productId }: { productId: string }) {
  const { data, isLoading, isError, error, refetch } = useAgentProduct(productId);

  if (isLoading) return <Skeleton className="h-96 w-full" />;
  if (isError || !data) {
    return (
      <Card>
        <ErrorState
          message={error instanceof ApiError ? error.message : "Could not load the agent-readable representation."}
          onRetry={() => refetch()}
        />
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="border-brand-100 bg-brand-50/40">
        <CardBody className="flex gap-3 text-sm">
          <Bot size={16} className="mt-0.5 shrink-0 text-brand-600" />
          <p className="text-ink-muted">
            The structured commerce representation an AI buyer would read for this product —{" "}
            <code className="rounded bg-surface px-1 py-0.5 text-xs">GET /api/v1/agent-commerce/catalog/{productId}</code>.
            Not a claim of ACP/AP2/UCP/x402 protocol compliance — Anumati's own internal representation.
          </p>
        </CardBody>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Identity & Readiness</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-ink-muted">Readiness state</span>
              <ProductReadinessBadge state={data.readiness.state} />
            </div>
            {data.readiness.missingCritical.length > 0 ? (
              <div>
                <p className="text-xs font-medium text-danger-text">Missing critical:</p>
                <ul className="list-inside list-disc text-ink-muted">
                  {data.readiness.missingCritical.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {data.readiness.missingImportant.length > 0 ? (
              <div>
                <p className="text-xs font-medium text-warning-text">Missing important:</p>
                <ul className="list-inside list-disc text-ink-muted">
                  {data.readiness.missingImportant.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="border-t border-border pt-3">
              <p className="text-xs text-ink-faint">Provenance</p>
              <p className="text-ink-muted">
                {data.provenance.source} · {data.provenance.dataset}
              </p>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Commerce & Freshness</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-ink-muted">Price range</span>
              <span className="font-medium text-ink">
                {data.commerce.priceRange
                  ? `${formatMoney({ amountMinor: data.commerce.priceRange.minMinor, currency: data.commerce.priceRange.currency })} – ${formatMoney({ amountMinor: data.commerce.priceRange.maxMinor, currency: data.commerce.priceRange.currency })}`
                  : "No purchasable variant"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-ink-muted">Purchasable variants</span>
              <span className="font-medium text-ink">{data.commerce.purchasableVariantCount}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-ink-muted">Promotion eligibility</span>
              <span className="font-medium text-ink">{data.policies.promotionEligibility}</span>
            </div>
            <div className="border-t border-border pt-3 text-xs text-ink-faint">
              <p>Product updated {formatDateTime(data.freshness.productUpdatedAt)}</p>
              {data.freshness.oldestPriceUpdateAt ? (
                <p>Oldest price data from {formatDateTime(data.freshness.oldestPriceUpdateAt)}</p>
              ) : null}
            </div>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Policies (structured)</CardTitle>
        </CardHeader>
        <CardBody className="grid gap-4 sm:grid-cols-2 text-sm">
          <div>
            <p className="text-xs text-ink-faint">Returns — {data.policies.returns.status}</p>
            <p className="text-ink-muted">{data.policies.returns.summary ?? "Unknown"}</p>
          </div>
          <div>
            <p className="text-xs text-ink-faint">Shipping — {data.policies.shipping.status}</p>
            <p className="text-ink-muted">{data.policies.shipping.summary ?? "Unknown"}</p>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Variants (structured)</CardTitle>
        </CardHeader>
        <CardBody className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="border-b border-border text-xs text-ink-faint">
              <tr>
                <th className="py-2 pr-4 font-medium">SKU</th>
                <th className="py-2 pr-4 font-medium">Price</th>
                <th className="py-2 pr-4 font-medium">Availability</th>
                <th className="py-2 pr-4 font-medium">Attributes</th>
              </tr>
            </thead>
            <tbody>
              {data.variants.map((v) => (
                <tr key={v.variantId} className="border-b border-border last:border-0">
                  <td className="py-2 pr-4 font-mono text-xs">{v.sku}</td>
                  <td className="py-2 pr-4">{formatMoney(v.price)}</td>
                  <td className="py-2 pr-4 text-xs">
                    {v.availability.state}
                    {v.availability.availableQuantity !== null ? ` (${v.availability.availableQuantity})` : ""}
                  </td>
                  <td className="py-2 pr-4 text-xs text-ink-muted">
                    {Object.entries(v.attributes).length > 0
                      ? Object.entries(v.attributes)
                          .map(([k, val]) => `${k}: ${val}`)
                          .join(", ")
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardBody>
      </Card>
    </div>
  );
}
