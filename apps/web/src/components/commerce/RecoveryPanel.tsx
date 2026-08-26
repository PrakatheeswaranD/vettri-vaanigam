/**
 * PART 08 §51-§58, §171-§178 — the failure-first recovery experience.
 * Every number/decision shown here comes from the server: eligibility,
 * the Merchant Agent's proposed action, the real Policy Engine decision,
 * and (once authorized) a real bounded retry. The Merchant Agent can
 * only propose — policy, approval, and authorization are the same
 * deterministic gates every other growth proposal goes through (PART 08
 * §22, §39).
 */
import { useState } from "react";
import { AlertTriangle, Gavel, KeyRound, RefreshCw, ShieldCheck, ShieldQuestion, ShieldX, XCircle } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "../ui/Card";
import { ApiError } from "../../lib/api-client";
import { useGrowthProposal } from "../../hooks/use-merchant-agent";
import { useApproveProposal, useEvaluatePolicy, useExecutionAuthorization, usePolicyDecision, useRejectProposal } from "../../hooks/use-policy";
import { useEvaluateRecovery, useExecuteRecovery } from "../../hooks/use-recovery";
import { PaymentPanel } from "./PaymentPanel";

const POLICY_REASON_TEXT: Record<string, string> = {
  WITHIN_AUTONOMOUS_LIMIT: "within the merchant's autonomous limits",
  ORDER_AMOUNT_REQUIRES_APPROVAL: "the order amount exceeds the automatic threshold",
  ORDER_AMOUNT_LIMIT_EXCEEDED: "the order amount exceeds the maximum permitted order amount",
  RECOVERY_LIMIT_EXCEEDED: "the maximum number of recovery attempts has been reached",
};

export function RecoveryPanel({ paymentId }: { paymentId: string }) {
  const [proposalId, setProposalId] = useState<string | null>(null);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [recoveredCheckoutId, setRecoveredCheckoutId] = useState<string | null>(null);

  const evaluateRecovery = useEvaluateRecovery();
  const evaluatePolicy = useEvaluatePolicy();
  const approve = useApproveProposal();
  const reject = useRejectProposal();
  const executeRecovery = useExecuteRecovery();

  const { data: proposal } = useGrowthProposal(proposalId ?? "", undefined);
  const { data: decision } = usePolicyDecision(proposal?.latestPolicyDecisionId ?? null);
  const { data: authorization } = useExecutionAuthorization(proposal?.executionAuthorizationId ?? null);

  if (recoveredCheckoutId) {
    return (
      <div className="space-y-3">
        <div className="rounded-card border border-info/40 bg-info-subtle px-3 py-2 text-sm text-info-text">
          Recovery attempt in progress — a new bounded retry authorized by the same governance pipeline.
        </div>
        <PaymentPanel checkoutId={recoveredCheckoutId} />
      </div>
    );
  }

  if (!proposalId) {
    return (
      <Card className="border-danger/40">
        <CardHeader className="flex items-center gap-2">
          <AlertTriangle size={16} className="text-danger" />
          <CardTitle>Recovery</CardTitle>
        </CardHeader>
        <CardBody className="space-y-2 text-sm">
          <p className="text-ink-muted">Check whether this failed payment is eligible for a bounded recovery attempt.</p>
          <button
            type="button"
            disabled={evaluateRecovery.isPending}
            onClick={() => evaluateRecovery.mutate(paymentId, { onSuccess: (data) => setProposalId(data.id) })}
            className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw size={14} />
            {evaluateRecovery.isPending ? "Analyzing…" : "Analyze recovery"}
          </button>
          {evaluateRecovery.isError ? (
            <p className="text-danger-text">{evaluateRecovery.error instanceof ApiError ? evaluateRecovery.error.message : "Could not evaluate recovery."}</p>
          ) : null}
        </CardBody>
      </Card>
    );
  }

  if (!proposal) return null;

  if (proposal.status === "REJECTED_VALIDATION") {
    return (
      <Card className="border-danger/40">
        <CardHeader className="flex items-center gap-2">
          <ShieldX size={16} className="text-danger" />
          <CardTitle>Recovery unavailable</CardTitle>
        </CardHeader>
        <CardBody className="text-sm text-ink-muted">{proposal.rejectionReason}</CardBody>
      </Card>
    );
  }

  return (
    <Card className="border-info/40">
      <CardHeader className="flex flex-wrap items-center gap-2">
        <ShieldCheck size={16} className="text-info" />
        <CardTitle>Merchant Agent recovery proposal</CardTitle>
        <span className="rounded-full bg-info-subtle px-2 py-0.5 text-[11px] font-medium text-info-text">{proposal.recoveryAction ?? "RETRY_SAME_CHECKOUT"}</span>
      </CardHeader>
      <CardBody className="space-y-3 text-sm">
        <ul className="space-y-1">
          <li className="flex items-start gap-1.5 text-ink-muted">
            <ShieldCheck size={14} className="mt-0.5 shrink-0 text-success" />
            Previous attempt verified FAILED for a retryable reason.
          </li>
          <li className="flex items-start gap-1.5 text-ink-muted">
            <ShieldCheck size={14} className="mt-0.5 shrink-0 text-success" />
            A recovery attempt remains available under merchant policy.
          </li>
        </ul>
        <p className="text-xs text-ink-faint">Proposed by: {proposal.mode === "AI_PROPOSED" ? "Merchant Agent (AI)" : "Deterministic fallback"}</p>

        {proposal.status === "PROPOSED" ? (
          <button
            type="button"
            onClick={() => evaluatePolicy.mutate(proposal.id)}
            disabled={evaluatePolicy.isPending}
            className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Gavel size={14} />
            {evaluatePolicy.isPending ? "Evaluating…" : "Evaluate policy"}
          </button>
        ) : null}

        {decision ? (
          <div className="rounded-card border border-border px-3 py-2">
            <p className="font-medium text-ink">
              Policy: <span className={decision.outcome === "DENY" ? "text-danger-text" : decision.outcome === "REQUIRE_APPROVAL" ? "text-warning-text" : "text-success-text"}>{decision.outcome.replace(/_/g, " ")}</span>
            </p>
            <ul className="mt-1 space-y-0.5">
              {decision.reasonCodes.map((code) => (
                <li key={code} className="flex items-start gap-1.5 text-xs text-ink-muted">
                  <ShieldQuestion size={12} className="mt-0.5 shrink-0" />
                  {POLICY_REASON_TEXT[code] ?? code}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {proposal.status === "PENDING_APPROVAL" ? (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => approve.mutate({ proposalId: proposal.id })}
              disabled={approve.isPending || reject.isPending}
              className="inline-flex items-center gap-1.5 rounded-md bg-success px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ShieldCheck size={14} />
              Approve recovery
            </button>
            <button
              type="button"
              onClick={() => reject.mutate({ proposalId: proposal.id })}
              disabled={approve.isPending || reject.isPending}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-ink hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-50"
            >
              <XCircle size={14} />
              Reject
            </button>
          </div>
        ) : null}

        {proposal.executionAuthorizationId && authorization?.status === "ACTIVE" ? (
          <div className="space-y-2 border-t border-border pt-3">
            <p className="flex items-center gap-1.5 text-xs text-ink-faint">
              <KeyRound size={12} /> Recovery authorization ACTIVE — server-issued, one-time use.
            </p>
            <button
              type="button"
              disabled={executeRecovery.isPending}
              onClick={() =>
                executeRecovery.mutate(
                  { authorizationId: proposal.executionAuthorizationId!, idempotencyKey },
                  { onSuccess: (data) => setRecoveredCheckoutId(data.checkoutId) },
                )
              }
              className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw size={14} />
              {executeRecovery.isPending ? "Starting retry…" : "Retry payment"}
            </button>
            {executeRecovery.isError ? (
              <p className="text-sm text-danger-text">{executeRecovery.error instanceof ApiError ? executeRecovery.error.message : "Could not start the retry."}</p>
            ) : null}
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
