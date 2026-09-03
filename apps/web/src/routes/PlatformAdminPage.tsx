/**
 * Platform Operations — the one screen the platform operator has.
 *
 * WHY IT EXISTS
 *
 * `PLATFORM_ADMIN` is a real role: it is provisioned by
 * `scripts/provision-demo-identities.ts`, it can sign in, and nine
 * `/admin/*` endpoints are implemented and gated to it. Nothing in the
 * console called any of them, so signing in as the operator landed on a
 * merchant console that refused every request. This is the smallest screen
 * that makes that role honest.
 *
 * WHAT IT LEADS WITH
 *
 * Exceptions, not merchant count. A platform operator's job on an agentic
 * commerce rail is the payment that went wrong — a customer debited while
 * the merchant was never credited is the one number worth putting first,
 * because it is the only one where somebody is currently out of pocket.
 */
import { AlertTriangle, Building2, ScrollText, Users } from "lucide-react";
import { PageHeader } from "../components/layout/PageHeader";
import { Card, CardBody, CardHeader, CardTitle } from "../components/ui/Card";
import { EmptyState, ErrorState, Skeleton } from "../components/ui/States";
import { useAdminAudit, useAdminMerchants, useAdminOverview, useAdminRisk } from "../hooks/use-admin";
import { formatDateTime } from "../lib/format";
import { ApiError } from "../lib/api-client";

function Metric({ label, value, tone }: { label: string; value: string; tone?: "danger" }) {
  return (
    <Card>
      <CardBody>
        <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">{label}</p>
        <p className={`mt-2 text-2xl font-bold tabular-nums ${tone === "danger" ? "text-danger-text" : "text-ink"}`}>{value}</p>
      </CardBody>
    </Card>
  );
}

export default function PlatformAdminPage() {
  const overview = useAdminOverview();
  const merchants = useAdminMerchants();
  const risk = useAdminRisk();
  const audit = useAdminAudit();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Platform operations"
        lead="Every merchant on the rail, every payment that needs a human, and the tamper-evident record of what agents did. Read-only: suspending or onboarding a merchant is a deliberate action, not a table button."
      />

      {overview.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
      ) : overview.isError || !overview.data ? (
        <Card>
          <ErrorState
            message={overview.error instanceof ApiError ? overview.error.message : "Could not load platform overview."}
            onRetry={() => void overview.refetch()}
          />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Metric
            label="Payments needing a human"
            value={String(overview.data.exceptions)}
            tone={overview.data.exceptions > 0 ? "danger" : undefined}
          />
          <Metric label="Merchants" value={String(overview.data.merchants)} />
          <Metric label="Payments processed" value={String(overview.data.payments)} />
          <Metric label="Accounts" value={String(overview.data.users)} />
        </div>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-faint">Payments needing a human</h2>
        {risk.isPending ? (
          <Skeleton className="h-32" />
        ) : risk.isError || !risk.data ? (
          <Card><ErrorState message="Could not load payment risk." onRetry={() => void risk.refetch()} /></Card>
        ) : risk.data.items.length === 0 ? (
          <Card>
            <EmptyState icon={<AlertTriangle size={18} />} title="Nothing in exception" description="No payment is currently failed, unknown, or debited-without-credit." />
          </Card>
        ) : (
          <div className="space-y-2">
            {risk.data.items.map((row) => (
              <Card key={row.id}>
                <CardBody className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink">
                      {row.state}
                      {row.failureCategory ? ` · ${row.failureCategory.replaceAll("_", " ")}` : ""}
                    </p>
                    <p className="mt-1 truncate text-xs text-ink-muted">
                      Customer {row.customerDebitStatus ?? "unknown"} · merchant {row.merchantCreditStatus ?? "unknown"}
                    </p>
                  </div>
                  {row.automaticRetryBlocked ? (
                    <span className="rounded-pill bg-danger-subtle px-2 py-0.5 text-micro font-medium text-danger-text">
                      Automatic retry blocked
                    </span>
                  ) : null}
                </CardBody>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-faint">Merchants</h2>
        {merchants.isPending ? (
          <Skeleton className="h-32" />
        ) : merchants.isError || !merchants.data ? (
          <Card><ErrorState message="Could not load merchants." onRetry={() => void merchants.refetch()} /></Card>
        ) : merchants.data.items.length === 0 ? (
          <Card><EmptyState icon={<Building2 size={18} />} title="No merchants" description="No commerce merchant is onboarded on this rail yet." /></Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {merchants.data.items.map((merchant) => (
              <Card key={merchant.id}>
                <CardBody className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-ink">{merchant.name}</p>
                    <p className="mt-1 truncate text-xs text-ink-muted">{merchant.slug} · {merchant.businessCategory}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <span className={`rounded-pill px-2 py-0.5 text-micro font-medium ${merchant.status === "ACTIVE" ? "bg-success-subtle text-success-text" : "bg-warning-subtle text-warning-text"}`}>
                      {merchant.status}
                    </span>
                    <p className="mt-1 text-xs text-ink-muted">{merchant._count.products} products</p>
                  </div>
                </CardBody>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-faint">Platform audit trail</h2>
        <Card>
          <CardHeader className="flex items-center gap-2">
            <ScrollText size={16} className="text-brand-600" />
            <CardTitle>Most recent agent actions, all merchants</CardTitle>
          </CardHeader>
          <CardBody>
            {audit.isPending ? (
              <Skeleton className="h-32" />
            ) : audit.isError || !audit.data ? (
              <ErrorState message="Could not load the audit trail." onRetry={() => void audit.refetch()} />
            ) : audit.data.items.length === 0 ? (
              <EmptyState icon={<Users size={18} />} title="No recorded actions" description="Agent actions appear here as they are written to the ledger." />
            ) : (
              <ul className="space-y-2">
                {audit.data.items.slice(0, 25).map((row) => (
                  <li key={row.id} className="border-b border-border-hair pb-2 last:border-0 last:pb-0">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-medium text-ink">{row.actionType.replaceAll("_", " ")}</span>
                      <span className="text-xs text-ink-faint">{formatDateTime(row.createdAt)}</span>
                    </div>
                    <p className="mt-1 text-sm text-ink-muted">{row.conciseReason}</p>
                    {/* The hash is what makes this trail tamper-evident, so
                        it is shown rather than described. */}
                    <p className="mt-1 font-mono text-[11px] text-ink-faint">{row.eventHash.slice(0, 16)}…</p>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </section>
    </div>
  );
}
