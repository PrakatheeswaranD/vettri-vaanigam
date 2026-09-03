/**
 * What is stopping an AI buyer from buying, product by product.
 *
 * WHY THIS SITS ON THE PRODUCTS PAGE
 *
 * Readiness scores live under Merchant Agent → Readiness and answer "how
 * are we doing". This answers "what do I open next", and it belongs where
 * the merchant already is when they are willing to edit a product.
 *
 * WHAT MAKES THE SUGGESTION SAFE
 *
 * `suggestedAttributeKeys` is not generated. It is the attribute vocabulary
 * the merchant's own products in the same category already use, so the
 * agent can say what shape the missing answer takes without ever supplying
 * the answer — only the merchant knows whether that shoe is a UK9.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { CheckCircle2, Wrench } from "lucide-react";
import type { CatalogGapReportDTO } from "@razorgrowth/contracts";
import { apiGet, ApiError } from "../../lib/api-client";
import { Card, CardBody, CardHeader, CardTitle } from "../ui/Card";
import { EmptyState, ErrorState, Skeleton } from "../ui/States";

export function CatalogGaps() {
  const query = useQuery({
    queryKey: ["catalog", "gaps"],
    queryFn: () => apiGet<CatalogGapReportDTO>("/catalog/gaps"),
  });

  if (query.isPending) return <Skeleton className="h-48" />;
  if (query.isError || !query.data) {
    return (
      <Card>
        <ErrorState
          message={query.error instanceof ApiError ? query.error.message : "Could not read your catalogue gaps."}
          onRetry={() => void query.refetch()}
        />
      </Card>
    );
  }

  const { activeProducts, fullyReadyProducts, gaps } = query.data;

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <CardTitle>What is blocking AI buyers</CardTitle>
          <p className="mt-0.5 text-xs text-ink-muted">
            <span className="font-semibold text-ink">{fullyReadyProducts}</span> of {activeProducts} products have no gap
            at all — those are the ones an agent can buy without qualification.
          </p>
        </div>
      </CardHeader>
      <CardBody>
        {gaps.length === 0 ? (
          <EmptyState
            icon={<CheckCircle2 size={18} />}
            title="Nothing is blocking an AI buyer"
            description="Every active product is priced, attributed, stocked and has its policies stated."
          />
        ) : (
          <ul className="space-y-4">
            {gaps.map((gap) => (
              <li key={gap.code} className="rounded-card border border-border-hair p-3.5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-semibold text-ink">{gap.title}</p>
                  <span className="rounded-pill bg-warning-subtle px-2 py-0.5 text-[11px] font-semibold text-warning-text">
                    {gap.affectedCount} product{gap.affectedCount === 1 ? "" : "s"}
                  </span>
                </div>

                <p className="mt-1.5 text-xs leading-snug text-ink-muted">{gap.why}</p>

                <p className="mt-2 flex items-start gap-1.5 text-xs leading-snug text-ink">
                  <Wrench size={12} className="mt-0.5 shrink-0 text-brand-600" aria-hidden />
                  <span>{gap.fix}</span>
                </p>

                {gap.suggestedAttributeKeys.length > 0 ? (
                  <p className="mt-2 text-[11px] leading-snug text-ink-faint">
                    Your other products in these categories use:{" "}
                    <span className="font-medium text-ink-muted">{gap.suggestedAttributeKeys.join(", ")}</span>. These
                    are your own keys, taken from your own catalogue — not a suggestion the agent invented.
                  </p>
                ) : null}

                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {gap.products.slice(0, 8).map((product) => (
                    <Link
                      key={product.productId}
                      to={`/merchant/commerce/products/${product.productId}`}
                      className="rounded-pill bg-surface-sunken px-2 py-0.5 text-[11px] font-medium text-ink-muted hover:bg-brand-50 hover:text-brand-700"
                    >
                      {product.name}
                    </Link>
                  ))}
                  {gap.affectedCount > gap.products.slice(0, 8).length ? (
                    <span className="px-1 py-0.5 text-[11px] text-ink-faint">
                      + {gap.affectedCount - gap.products.slice(0, 8).length} more
                    </span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
