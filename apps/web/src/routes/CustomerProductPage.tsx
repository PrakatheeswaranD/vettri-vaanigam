/**
 * One product, seen by the person buying it.
 *
 * "View details" on a recommendation pointed at `/catalog/:id` — a
 * merchant path. The route guard rejected it and returned the shopper to
 * the Buyer Agent home, discarding the conversation they were reading;
 * and the merchant catalog API behind that page answers 403 for a
 * customer session anyway, so the link could not have worked even if the
 * guard had let it through.
 *
 * This is the shopper's version: the same catalogue truth, read through
 * `/marketplace/products/:id`, showing what someone deciding whether to
 * buy actually needs — price, the variant they were shown, whether it is
 * in stock, and the returns and shipping terms. Merchant-internal
 * readiness scoring and provenance stay on the merchant's page, where
 * they belong.
 */
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Package, Store, Truck, Undo2 } from "lucide-react";
import type { AgentReadableProductDTO } from "@razorgrowth/contracts";
import { clsx } from "clsx";
import { apiGet, ApiError } from "../lib/api-client";
import { formatMoney } from "../lib/format";
import { Card, CardBody, CardHeader, CardTitle } from "../components/ui/Card";
import { ErrorState, Skeleton } from "../components/ui/States";

interface MarketplaceProduct {
  merchant: { id: string; name: string; slug: string };
  product: AgentReadableProductDTO;
}

/** Availability said in a shopper's words, with a tone that never relies
 * on colour alone to carry the meaning. */
const AVAILABILITY_COPY: Record<string, { label: string; className: string }> = {
  IN_STOCK: { label: "In stock", className: "bg-success-subtle text-success-text" },
  LOW_STOCK: { label: "Only a few left", className: "bg-warning-subtle text-warning-text" },
  OUT_OF_STOCK: { label: "Out of stock", className: "bg-danger-subtle text-danger-text" },
  UNAVAILABLE: { label: "Not available", className: "bg-danger-subtle text-danger-text" },
  UNKNOWN: { label: "Stock not recorded", className: "bg-surface-sunken text-ink-muted" },
};

export default function CustomerProductPage() {
  const { productId } = useParams();
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["marketplace", "product", productId],
    queryFn: () => apiGet<MarketplaceProduct>(`/marketplace/products/${productId}`),
    enabled: Boolean(productId),
  });

  if (query.isPending) return <Skeleton className="h-96 w-full" />;
  if (query.isError || !query.data) {
    return (
      <Card>
        <ErrorState
          message={query.error instanceof ApiError ? query.error.message : "Could not load this product."}
          onRetry={() => void query.refetch()}
        />
      </Card>
    );
  }

  const { merchant, product } = query.data;
  const variants = product.variants.filter((variant) => variant.active);
  const selected = variants.find((variant) => variant.variantId === selectedVariantId) ?? variants[0];
  const availability = selected ? AVAILABILITY_COPY[selected.availability.state] ?? AVAILABILITY_COPY.UNKNOWN! : null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link
        to="/customer/discover"
        className="inline-flex items-center gap-1.5 rounded-md text-sm text-ink-muted transition hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
      >
        <ArrowLeft size={14} aria-hidden /> Back to discovery
      </Link>

      <Card>
        <CardBody className="space-y-5">
          <div>
            <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-brand-600">
              <Store size={13} aria-hidden /> {merchant.name}
            </p>
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-ink">{product.identity.name}</h1>
            <p className="mt-1 text-sm text-ink-faint">{product.identity.category}</p>
          </div>

          {product.identity.description ? (
            <p className="text-sm leading-relaxed text-ink-muted">{product.identity.description}</p>
          ) : null}

          {variants.length > 1 ? (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">Choose an option</p>
              <div className="flex flex-wrap gap-2">
                {variants.map((variant) => {
                  const isSelected = selected?.variantId === variant.variantId;
                  return (
                    <button
                      key={variant.variantId}
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => setSelectedVariantId(variant.variantId)}
                      className={clsx(
                        "rounded-md border px-3 py-1.5 text-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600",
                        isSelected
                          ? "border-brand-500 bg-brand-50 font-medium text-brand-700"
                          : "border-border text-ink-muted hover:bg-surface-subtle",
                      )}
                    >
                      {variant.attributes.size ?? variant.attributes.color ?? variant.sku}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {selected ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-card bg-surface-subtle px-4 py-3.5">
              <div>
                <p className="text-xl font-semibold tabular-nums text-ink">{formatMoney(selected.price)}</p>
                <p className="mt-0.5 text-xs text-ink-faint">
                  {Object.entries(selected.attributes).map(([key, value]) => `${key}: ${value}`).join(" · ") || selected.sku}
                </p>
              </div>
              {availability ? (
                <span className={clsx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium", availability.className)}>
                  <Package size={12} aria-hidden />
                  {availability.label}
                  {selected.availability.availableQuantity !== null ? ` · ${selected.availability.availableQuantity} left` : ""}
                </span>
              ) : null}
            </div>
          ) : (
            <p className="rounded-card bg-surface-subtle px-4 py-3.5 text-sm text-ink-muted">
              This product has no options available to buy right now.
            </p>
          )}

          <p className="text-xs text-ink-faint">
            To buy this, ask your Buyer Agent for it — every purchase goes through your spending policy first.
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>Returns &amp; delivery</CardTitle></CardHeader>
        <CardBody className="space-y-3 text-sm">
          <div className="flex gap-2.5">
            <Undo2 size={16} className="mt-0.5 shrink-0 text-ink-faint" aria-hidden />
            <span className="text-ink-muted">
              {product.policies.returns.summary ?? "This merchant has not published return terms for this product."}
            </span>
          </div>
          <div className="flex gap-2.5">
            <Truck size={16} className="mt-0.5 shrink-0 text-ink-faint" aria-hidden />
            <span className="text-ink-muted">
              {product.policies.shipping.summary ?? "This merchant has not published delivery terms for this product."}
            </span>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
