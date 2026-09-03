/**
 * Configuration review (Part 11 §16).
 *
 * Deliberately NOT a fake "Activate" button. This build has no
 * activation-state model, and adding one purely so a button could flip
 * it would be inventing persistence to decorate a demo. Per §16's own
 * instruction ("If activation state would be artificial, do NOT fake
 * persistence — instead show CONFIGURATION COMPLETE and treat Active as
 * environment/config state"), this renders the real derived readiness of
 * the capability from data that genuinely exists.
 *
 * Every row is computed, and any row that is not ready is shown as not
 * ready — the summary can report "needs attention", never a guaranteed
 * green wall.
 */
import { CheckCircle2, AlertTriangle, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { useMerchantPolicy, useReadinessLatest, useSystemCapabilities } from "../../hooks/use-api";
import { useGrowthConfig } from "../../hooks/use-merchant-agent";
import { Card, CardBody, CardHeader, CardTitle } from "../ui/Card";
import { Skeleton, ErrorState } from "../ui/States";
import { formatBps } from "../../lib/format";

interface CheckRow {
  label: string;
  value: string;
  ok: boolean;
}

export function ReviewAndActivate() {
  const capabilities = useSystemCapabilities();
  const policy = useMerchantPolicy();
  const growthConfig = useGrowthConfig();
  const readiness = useReadinessLatest();

  if (capabilities.isLoading || policy.isLoading || growthConfig.isLoading) {
    return <Skeleton className="h-72 w-full" />;
  }
  if (capabilities.isError || !capabilities.data || policy.isError || !policy.data || growthConfig.isError || !growthConfig.data) {
    return <ErrorState message="Could not load the configuration summary." onRetry={() => { capabilities.refetch(); policy.refetch(); growthConfig.refetch(); }} />;
  }

  const cap = capabilities.data;
  const p = policy.data;
  const gc = growthConfig.data;

  const growthCapabilityCount = [gc.crossSellEnabled, gc.upsellEnabled, gc.bundleEnabled, gc.boundedOffersEnabled]
    .filter(Boolean).length + (p.maxRecoveryAttempts > 0 ? 1 : 0);

  const rows: CheckRow[] = [
    { label: "Commerce data", value: cap.catalogGrounding === "READY" ? "Ready" : "No catalog data", ok: cap.catalogGrounding === "READY" },
    {
      label: "Agentic readiness",
      value: readiness.data ? `${readiness.data.snapshot.overallScore} / 100` : "Not calculated",
      ok: Boolean(readiness.data),
    },
    { label: "Growth capabilities", value: `${growthCapabilityCount} enabled`, ok: gc.growthActionsEnabled && growthCapabilityCount > 0 },
    { label: "Guardrails", value: `Policy version ${p.policyVersion}`, ok: cap.policy === "ENFORCING" },
    { label: "Automatic discount", value: `≤ ${formatBps(p.autoApprovalDiscountBps)}`, ok: true },
    { label: "Approval band", value: `${formatBps(p.autoApprovalDiscountBps)} – ${formatBps(p.maxDiscountBps)}`, ok: true },
    { label: "Recovery attempts", value: String(p.maxRecoveryAttempts), ok: p.maxRecoveryAttempts > 0 },
    {
      label: "Payment provider",
      value:
        cap.paymentProvider === "RAZORPAY_TEST_MODE"
          ? "Razorpay Test Mode"
          : cap.paymentProvider === "MOCK_GATEWAY"
            ? "Mock gateway (demo)"
            : "Not configured",
      ok: cap.paymentProvider === "RAZORPAY_TEST_MODE",
    },
    { label: "AI financial authority", value: "Proposal only", ok: true },
  ];

  const blocking = rows.filter((r) => !r.ok);

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>Configuration review</CardTitle>
        <span
          className={
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium " +
            (blocking.length === 0 ? "bg-success-subtle text-success-text" : "bg-warning-subtle text-warning-text")
          }
        >
          {blocking.length === 0 ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
          {blocking.length === 0 ? "Configuration complete" : `${blocking.length} need attention`}
        </span>
      </CardHeader>
      <CardBody className="space-y-2">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-3 rounded-card bg-surface-subtle px-3 py-2">
            <span className="text-sm text-ink-muted">{row.label}</span>
            <span
              className={
                "inline-flex shrink-0 items-center gap-1.5 text-xs font-medium " +
                (row.ok ? "text-success-text" : "text-warning-text")
              }
            >
              {row.ok ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
              {row.value}
            </span>
          </div>
        ))}

        <p className="border-t border-border pt-3 text-[11px] text-ink-faint">
          There is no separate &ldquo;activate&rdquo; switch: this capability is active whenever its commerce data,
          guardrails, and payment provider are configured. That state is derived from the values above, not stored
          as a flag a button could flip.
        </p>

        <Link
          to="/merchant/agent/readiness"
          className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700"
        >
          Inspect Agentic Readiness <ArrowRight size={12} />
        </Link>
      </CardBody>
    </Card>
  );
}
