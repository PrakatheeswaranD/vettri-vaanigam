import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Gauge, Package, ScrollText, TrendingUp, XCircle, CheckCircle2 } from "lucide-react";
import { READINESS_DIMENSIONS, READINESS_DIMENSION_LABEL } from "@razorgrowth/domain";
import {
  useCatalogQualitySummary,
  useGrowthOpportunities,
  useLedger,
  useMerchantStats,
  useReadinessLatest,
} from "../hooks/use-api";
import { Card, CardBody, CardHeader, CardTitle } from "../components/ui/Card";
import { EmptyState, ErrorState, Skeleton } from "../components/ui/States";
import { DemoDataBadge } from "../components/ui/DemoDataBadge";
import { ValueTag } from "../components/ui/ValueTag";
import { AgentActionStatusBadge } from "../components/ui/StatusBadge";
import { DimensionBar } from "../components/readiness/DimensionBar";
import { ReadinessLevelBadge } from "../components/readiness/ReadinessLevelBadge";
import { formatDateTime, formatMoney } from "../lib/format";

export default function OverviewPage() {
  const readiness = useReadinessLatest();
  const stats = useMerchantStats();
  const opportunities = useGrowthOpportunities();
  const ledger = useLedger({ limit: 5 });
  const catalogQuality = useCatalogQualitySummary();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Overview</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-muted">
          Command center for Meridian Athletics — how AI-ready this catalog is, where the revenue opportunities
          are, and what's actually happened.
        </p>
      </div>

      {/* Agentic Readiness */}
      <Card>
        <CardHeader className="flex flex-wrap items-center gap-2">
          <CardTitle>Agentic Readiness</CardTitle>
          {readiness.data ? <ReadinessLevelBadge level={readiness.data.snapshot.level} /> : null}
          {readiness.data?.snapshot.isSyntheticDemo ? <DemoDataBadge /> : null}
        </CardHeader>
        <CardBody>
          {readiness.isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : readiness.isError ? (
            <ErrorState message="Could not load the readiness snapshot." onRetry={() => readiness.refetch()} />
          ) : !readiness.data ? (
            <EmptyState icon={<Gauge size={18} />} title="Readiness has not been calculated yet" />
          ) : (
            <div className="grid gap-6 md:grid-cols-[auto_1fr]">
              <div className="flex flex-col items-center justify-center gap-1 rounded-card bg-surface-subtle px-8 py-6">
                <span className="text-4xl font-bold tabular-nums text-ink">{readiness.data.snapshot.overallScore}</span>
                <span className="text-xs text-ink-faint">out of 100</span>
                {readiness.data.delta ? (
                  <span
                    className={
                      readiness.data.delta.overallScoreDelta > 0
                        ? "mt-1 text-xs font-medium text-success-text"
                        : readiness.data.delta.overallScoreDelta < 0
                          ? "mt-1 text-xs font-medium text-danger-text"
                          : "mt-1 text-xs font-medium text-ink-faint"
                    }
                  >
                    {readiness.data.delta.overallScoreDelta > 0 ? "+" : ""}
                    {readiness.data.delta.overallScoreDelta} since last analysis
                  </span>
                ) : null}
              </div>
              <div className="space-y-3">
                {READINESS_DIMENSIONS.slice(0, 4).map((dimension) => (
                  <DimensionBar
                    key={dimension}
                    label={READINESS_DIMENSION_LABEL[dimension]}
                    score={readiness.data.snapshot.dimensions[dimension]}
                  />
                ))}
              </div>
            </div>
          )}
          {readiness.data ? (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4 text-sm">
              <p className="text-ink-muted">
                Largest readiness gap:{" "}
                <span className="font-medium text-ink">{readiness.data.snapshot.weakestDimension}</span>
              </p>
              <Link to="/readiness" className="inline-flex items-center gap-1 text-brand-600 hover:text-brand-700">
                View full breakdown <ArrowRight size={14} />
              </Link>
            </div>
          ) : null}
        </CardBody>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Growth Opportunities */}
        <Card>
          <CardHeader className="flex items-center justify-between">
            <CardTitle>Growth Opportunities</CardTitle>
            <Link to="/growth" className="text-xs text-brand-600 hover:text-brand-700">
              View all
            </Link>
          </CardHeader>
          <CardBody>
            {opportunities.isLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : opportunities.isError ? (
              <ErrorState message="Could not load growth opportunities." onRetry={() => opportunities.refetch()} />
            ) : !opportunities.data || opportunities.data.items.length === 0 ? (
              <EmptyState icon={<TrendingUp size={18} />} title="No opportunities identified yet" />
            ) : (
              <ul className="space-y-3">
                {opportunities.data.items.slice(0, 3).map((opp) => (
                  <li key={opp.id} className="border-b border-border pb-3 last:border-0 last:pb-0">
                    <div className="mb-1 flex items-center gap-2">
                      <ValueTag classification={opp.valueClassification} />
                      {opp.estimatedValue ? (
                        <span className="text-xs font-medium text-ink">{formatMoney(opp.estimatedValue)}</span>
                      ) : null}
                    </div>
                    <p className="text-sm text-ink-muted">{opp.recommendation}</p>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        {/* Recent Agent Actions */}
        <Card>
          <CardHeader className="flex items-center justify-between">
            <CardTitle>Recent Agent Actions</CardTitle>
            <Link to="/action-ledger" className="text-xs text-brand-600 hover:text-brand-700">
              View ledger
            </Link>
          </CardHeader>
          <CardBody>
            {ledger.isLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : ledger.isError ? (
              <ErrorState message="Could not load the action ledger." onRetry={() => ledger.refetch()} />
            ) : !ledger.data || ledger.data.items.length === 0 ? (
              <EmptyState icon={<ScrollText size={18} />} title="No agent actions have been recorded" />
            ) : (
              <ul className="space-y-3">
                {ledger.data.items.map((action) => (
                  <li key={action.id} className="border-b border-border pb-3 last:border-0 last:pb-0">
                    <div className="mb-1 flex items-center gap-2">
                      <span className="text-xs text-ink-faint">{formatDateTime(action.createdAt)}</span>
                      <AgentActionStatusBadge status={action.status} />
                      {action.isSyntheticDemo ? <DemoDataBadge /> : null}
                    </div>
                    <p className="text-sm text-ink-muted">{action.conciseReason}</p>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Commerce Activity */}
      <Card>
        <CardHeader>
          <CardTitle>Commerce Activity</CardTitle>
        </CardHeader>
        <CardBody>
          {stats.isLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : stats.isError || !stats.data ? (
            <ErrorState message="Could not load commerce activity." onRetry={() => stats.refetch()} />
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
              <StatTile icon={<Package size={16} />} label="Products" value={stats.data.productCount} />
              <StatTile icon={<ScrollText size={16} />} label="Orders" value={stats.data.orderCount} />
              <StatTile
                icon={<CheckCircle2 size={16} className="text-success" />}
                label="Captured Payments"
                value={stats.data.capturedPayments}
              />
              <StatTile
                icon={<XCircle size={16} className="text-danger" />}
                label="Failed Payments"
                value={stats.data.failedPayments}
              />
              <StatTile icon={<Package size={16} />} label="Out-of-Stock Variants" value={stats.data.outOfStockVariants} />
            </div>
          )}
        </CardBody>
      </Card>

      {/* Catalog Health Summary (PART 02 §68) */}
      <Card>
        <CardHeader>
          <CardTitle>Catalog Health</CardTitle>
        </CardHeader>
        <CardBody>
          {catalogQuality.isLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : catalogQuality.isError || !catalogQuality.data ? (
            <ErrorState message="Could not load catalog health." onRetry={() => catalogQuality.refetch()} />
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
              <StatTile icon={<Package size={16} />} label="Active Products" value={catalogQuality.data.activeProducts} />
              <StatTile
                icon={<CheckCircle2 size={16} className="text-success" />}
                label="Agent-Ready"
                value={catalogQuality.data.agentReadyProducts}
              />
              <StatTile label="Partially Ready" value={catalogQuality.data.partiallyReadyProducts} icon={<Package size={16} />} />
              <StatTile
                icon={<XCircle size={16} className="text-danger" />}
                label="Not Ready"
                value={catalogQuality.data.notReadyProducts}
              />
              <StatTile
                icon={<Package size={16} />}
                label="Unknown Inventory"
                value={catalogQuality.data.unknownInventoryVariants}
              />
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function StatTile({ icon, label, value }: { icon: ReactNode; label: string; value: number }) {
  return (
    <div className="rounded-card bg-surface-subtle px-4 py-3">
      <div className="mb-1 flex items-center gap-1.5 text-ink-faint">{icon}</div>
      <p className="text-xl font-semibold text-ink">{value}</p>
      <p className="text-xs text-ink-muted">{label}</p>
    </div>
  );
}
