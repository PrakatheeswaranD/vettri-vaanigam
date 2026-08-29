/**
 * Recovery guardrails (Part 11 §13). Every boundary shown here is real
 * merchant policy or a structural invariant this codebase enforces —
 * never an illustrative number.
 *
 * `maxRecoveryAttempts` comes from `MerchantPolicy`, the same row the
 * recovery eligibility engine reads. The remaining rows are structural:
 * they are properties of the code path (an UNKNOWN payment is never
 * retried without provider reconciliation; changed financial terms
 * re-enter policy; recovery consumes a scoped authorization), so they
 * are labelled as enforced-by-architecture rather than configurable.
 */
import { ShieldCheck, Lock } from "lucide-react";
import { useMerchantPolicy } from "../../hooks/use-api";
import { Card, CardBody, CardHeader, CardTitle } from "../ui/Card";
import { Skeleton, ErrorState } from "../ui/States";

function Row({ label, value, structural }: { label: string; value: string; structural?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-card bg-surface-subtle px-3 py-2">
      <span className="text-sm text-ink-muted">{label}</span>
      <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-ink">
        {structural ? <Lock size={11} className="text-ink-faint" /> : null}
        {value}
      </span>
    </div>
  );
}

export function RecoveryGuardrails() {
  const policy = useMerchantPolicy();

  if (policy.isLoading) return <Skeleton className="h-56 w-full" />;
  if (policy.isError || !policy.data) {
    return <ErrorState message="Could not load recovery guardrails." onRetry={() => policy.refetch()} />;
  }

  const p = policy.data;
  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center gap-2">
        <ShieldCheck size={16} className="text-brand-600" />
        <CardTitle>Payment Recovery Guardrails</CardTitle>
      </CardHeader>
      <CardBody className="space-y-2">
        <Row label="Maximum recovery attempts" value={String(p.maxRecoveryAttempts)} />
        <Row label="Retry an UNKNOWN payment" value="Never" structural />
        <Row label="Timeout handling" value="Verify provider first" structural />
        <Row label="Changed financial terms" value="Require approval" structural />
        <Row label="Recovery authorization" value="Required" structural />
        <Row label="Authorization validity" value={`${p.authorizationValidityMinutes} min`} />

        <p className="flex items-start gap-1.5 border-t border-border pt-3 text-[11px] text-ink-faint">
          <Lock size={11} className="mt-0.5 shrink-0" />
          Rows marked with a lock are structural — enforced by the code path itself, not a per-merchant setting. A
          timeout is never treated as a failure: an UNKNOWN payment must be reconciled against the provider before
          any retry is even considered.
        </p>
      </CardBody>
    </Card>
  );
}
