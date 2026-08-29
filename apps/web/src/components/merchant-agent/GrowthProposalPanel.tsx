/**
 * PART 04 §83, §86, §120-§123; PART 05 §77-§89 — the "GROWTH OPPORTUNITY"
 * hero panel, extended into the full governance explainability view: AI
 * Proposal → System Validation → Policy → Merchant Approval →
 * Execution Authorization. Every number here comes from deterministic
 * calculators or the real Policy Engine, never AI prose. Bounded autonomy
 * is always visible: the Merchant Agent can propose; only deterministic
 * policy, a human, and server-side authorization can move a proposal
 * further — the buttons in this component call the real backend
 * transitions, never a frontend boolean (PART 05 §26-§28, §124-§125).
 */
import { useState } from "react";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Gavel,
  KeyRound,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  ShieldX,
  Sparkles,
  XCircle,
} from "lucide-react";
import type { GrowthActionProposalDTO } from "@razorgrowth/contracts";
import { Card, CardBody, CardHeader, CardTitle } from "../ui/Card";
import { DemoDataBadge } from "../ui/DemoDataBadge";
import { PolicyDecisionBadge } from "../ui/StatusBadge";
import { formatBps, formatDateTime, formatMoney } from "../../lib/format";
import { ApiError } from "../../lib/api-client";
import { useGrowthProposal } from "../../hooks/use-merchant-agent";
import { useAgentProduct, useMerchantPolicy } from "../../hooks/use-api";
import { DiscountAuthorityBar } from "../policy/DiscountAuthorityBar";
import { useExecuteCheckout } from "../../hooks/use-commerce";
import { CheckoutSummary } from "../commerce/CheckoutSummary";
import {
  useApproveProposal,
  useEvaluatePolicy,
  useExecutionAuthorization,
  useIssueAuthorization,
  usePolicyDecision,
  useRejectProposal,
} from "../../hooks/use-policy";
import { GROWTH_REASON_CODE_TEXT, BLOCKER_CODE_TEXT } from "./growth-reason-code-text";

const ACTION_TYPE_LABEL: Record<string, string> = {
  CROSS_SELL: "Cross-sell",
  UPSELL: "Upsell",
  BUNDLE: "Bundle",
  BOUNDED_OFFER: "Bounded offer",
  RECOVERY: "Recovery",
};

const MODE_LABEL: Record<string, string> = {
  AI_PROPOSED: "Proposed by AI model",
  DETERMINISTIC_RELATIONSHIP: "Deterministic (merchant-configured relationship)",
  DETERMINISTIC_FALLBACK: "Deterministic fallback (AI unavailable or ungrounded)",
  NO_OPPORTUNITY: "No opportunity identified",
  BLOCKED_BY_DATA: "Blocked by missing commerce data",
};

const POLICY_REASON_TEXT: Record<string, string> = {
  WITHIN_AUTONOMOUS_LIMIT: "within the merchant's autonomous limits",
  DISCOUNT_REQUIRES_APPROVAL: "the requested discount exceeds the automatic threshold",
  DISCOUNT_LIMIT_EXCEEDED: "the requested discount exceeds the maximum permitted discount",
  ORDER_AMOUNT_REQUIRES_APPROVAL: "the affected order amount exceeds the automatic threshold",
  ORDER_AMOUNT_LIMIT_EXCEEDED: "the affected order amount exceeds the maximum permitted order amount",
  ACTION_TYPE_DISABLED: "this action type is currently disabled by merchant configuration",
  CURRENCY_MISMATCH: "the proposal's currency no longer matches the merchant's policy currency",
  PROPOSAL_EXPIRED: "the proposal is too old to evaluate",
  PROPOSAL_INVALID: "the proposal failed validation",
  PRODUCT_NOT_ELIGIBLE: "the product is no longer agent-visible",
  PRODUCT_NOT_AVAILABLE: "the product is no longer purchasable",
  POLICY_CONFIGURATION_INVALID: "the merchant's policy configuration is internally inconsistent",
  RECOVERY_LIMIT_EXCEEDED: "the maximum number of recovery attempts has been reached",
};

function ExplainabilityStrip({ status }: { status: string }) {
  const steps: { label: string; done: boolean; active: boolean }[] = [
    { label: "AI Proposal", done: true, active: false },
    { label: "Validation", done: true, active: false },
    { label: "Policy", done: status !== "PROPOSED", active: status === "PROPOSED" },
    {
      label: "Approval",
      done: ["APPROVED", "APPROVAL_REJECTED", "AUTHORIZED"].includes(status),
      active: status === "PENDING_APPROVAL",
    },
    { label: "Authorization", done: status === "AUTHORIZED", active: status === "APPROVED" || status === "ALLOWED" },
  ];
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      {steps.map((step, i) => (
        <span key={step.label} className="flex items-center gap-1.5">
          <span
            className={
              step.done
                ? "rounded-full bg-success-subtle px-2 py-0.5 font-medium text-success-text"
                : step.active
                  ? "rounded-full bg-info-subtle px-2 py-0.5 font-medium text-info-text"
                  : "rounded-full bg-surface-sunken px-2 py-0.5 font-medium text-ink-faint"
            }
          >
            {step.label}
          </span>
          {i < steps.length - 1 ? <span className="text-ink-faint">→</span> : null}
        </span>
      ))}
    </div>
  );
}

/** Truncated, monospace rendering of a proposal fingerprint — never the
 * full hash inline (it's long and not meant to be read character-by-
 * character), just enough to visually compare two fingerprints side by
 * side (PART 05 §31-§32, §44). */
function FingerprintTag({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-sunken px-2 py-0.5 text-[11px] text-ink-muted">
      {label}: <span className="font-mono text-ink">{value.slice(0, 8)}…{value.slice(-4)}</span>
    </span>
  );
}

function PolicyDecisionCard({ proposalId }: { proposalId: string }) {
  const { data: proposal } = useGrowthProposal(proposalId);
  const { data: decision } = usePolicyDecision(proposal?.latestPolicyDecisionId ?? null);
  const { data: policy } = useMerchantPolicy();
  if (!decision) return null;

  return (
    <Card className={decision.outcome === "DENY" ? "border-danger/40" : decision.outcome === "REQUIRE_APPROVAL" ? "border-warning/40" : "border-success/40"}>
      <CardHeader className="flex flex-wrap items-center gap-2">
        <CardTitle>Policy decision</CardTitle>
        <PolicyDecisionBadge decision={decision.outcome} />
        <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-[11px] font-medium text-ink-muted">
          policy v{decision.evaluatedPolicyVersion}
        </span>
        <FingerprintTag label="Proposal fingerprint" value={decision.proposalFingerprint} />
      </CardHeader>
      <CardBody className="space-y-3">
        {policy && decision.evaluatedValues.requestedDiscountBps !== null ? (
          <div className="rounded-card bg-surface-subtle p-3">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-faint">Discount authority</p>
            <DiscountAuthorityBar
              autoApprovalBps={policy.autoApprovalDiscountBps}
              maxBps={policy.maxDiscountBps}
              requestedBps={decision.evaluatedValues.requestedDiscountBps}
            />
          </div>
        ) : null}
        <ul className="space-y-1">
          {decision.reasonCodes.map((code) => (
            <li key={code} className="flex items-start gap-1.5 text-sm text-ink-muted">
              {decision.outcome === "DENY" ? (
                <ShieldX size={14} className="mt-0.5 shrink-0 text-danger" />
              ) : decision.outcome === "REQUIRE_APPROVAL" ? (
                <ShieldQuestion size={14} className="mt-0.5 shrink-0 text-warning" />
              ) : (
                <ShieldCheck size={14} className="mt-0.5 shrink-0 text-success" />
              )}
              {POLICY_REASON_TEXT[code] ?? code}
            </li>
          ))}
        </ul>
        {decision.evaluatedValues.requestedDiscountBps !== null ? (
          <p className="text-xs text-ink-faint">
            Requested discount: {formatBps(decision.evaluatedValues.requestedDiscountBps)}
          </p>
        ) : null}
        {decision.evaluatedValues.orderAmountMinor !== null ? (
          <p className="text-xs text-ink-faint">
            Affected order amount: {formatMoney({ amountMinor: decision.evaluatedValues.orderAmountMinor, currency: decision.evaluatedValues.currency })}
          </p>
        ) : null}
        <p className="border-t border-border pt-2 text-sm text-ink-muted">{decision.explanation}</p>
      </CardBody>
    </Card>
  );
}

/** Client-side convenience pick only — never authoritative. The server
 * (`CommerceExecutionService`) independently rehydrates and validates
 * every product/variant regardless of what the client sends (PART 06
 * §10, §91). */
function pickPurchasableVariantId(product: { variants: { variantId: string; price: { amountMinor: number }; availability: { state: string } }[] } | undefined): string | null {
  if (!product) return null;
  const purchasable = product.variants.filter((v) => v.availability.state === "IN_STOCK" || v.availability.state === "LOW_STOCK");
  const sorted = [...purchasable].sort((a, b) => a.price.amountMinor - b.price.amountMinor);
  return sorted[0]?.variantId ?? null;
}

function ExecutionAuthorizationCard({
  authorizationId,
  primaryProductId,
  policyDecisionId,
}: {
  authorizationId: string;
  primaryProductId: string;
  policyDecisionId: string | null;
}) {
  const { data: authorization } = useExecutionAuthorization(authorizationId);
  const { data: decision } = usePolicyDecision(policyDecisionId ?? null);
  const { data: product } = useAgentProduct(primaryProductId);
  const executeCheckout = useExecuteCheckout();
  const [quantity, setQuantity] = useState(1);
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  if (!authorization) return null;

  const variantId = pickPurchasableVariantId(product);
  const alreadyConsumed = authorization.status === "CONSUMED";
  const fingerprintMatch = decision ? decision.proposalFingerprint === authorization.proposalFingerprint : null;

  return (
    <div className="space-y-4">
      <Card className="border-info/40">
        <CardHeader className="flex flex-wrap items-center gap-2">
          <CardTitle>Execution authorization</CardTitle>
          <span className="rounded-full bg-info-subtle px-2 py-0.5 text-[11px] font-medium text-info-text">{authorization.status}</span>
          <FingerprintTag label="Authorized fingerprint" value={authorization.proposalFingerprint} />
          {fingerprintMatch !== null ? (
            <span
              className={
                fingerprintMatch
                  ? "inline-flex items-center gap-1 rounded-full bg-success-subtle px-2 py-0.5 text-[11px] font-medium text-success-text"
                  : "inline-flex items-center gap-1 rounded-full bg-danger-subtle px-2 py-0.5 text-[11px] font-medium text-danger-text"
              }
            >
              <ShieldCheck size={11} />
              {fingerprintMatch ? "Matches policy decision — verified" : "FINGERPRINT MISMATCH"}
            </span>
          ) : null}
        </CardHeader>
        <CardBody className="grid gap-2 text-sm sm:grid-cols-2">
          <div className="flex items-center gap-2 text-ink-muted">
            <KeyRound size={14} className="text-info" />
            Authorized action: <span className="font-medium text-ink">{ACTION_TYPE_LABEL[authorization.authorizedActionType] ?? authorization.authorizedActionType}</span>
          </div>
          <div className="flex items-center gap-2 text-ink-muted">
            Expires: <span className="font-medium text-ink">{formatDateTime(authorization.expiresAt)}</span>
          </div>
          <div className="flex items-center gap-2 text-ink-muted sm:col-span-2">
            <Ban size={14} className="text-danger" />
            Execution:{" "}
            <span className="font-medium text-ink">
              {alreadyConsumed ? "Authorization consumed — see order below" : "NOT STARTED — commerce execution available below"}
            </span>
          </div>
        </CardBody>
        {!alreadyConsumed && !executeCheckout.data ? (
          <CardBody className="flex flex-wrap items-center gap-3 border-t border-border">
            <label className="flex items-center gap-2 text-sm text-ink-muted">
              Quantity
              <input
                type="number"
                min={1}
                max={10}
                value={quantity}
                onChange={(e) => setQuantity(Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
                className="w-16 rounded-md border border-border bg-surface px-2 py-1 text-sm text-ink"
              />
            </label>
            <button
              type="button"
              disabled={!variantId || executeCheckout.isPending}
              onClick={() =>
                variantId &&
                executeCheckout.mutate({
                  authorizationId,
                  selection: { productId: primaryProductId, variantId, quantity },
                  idempotencyKey,
                })
              }
              className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ShieldCheck size={14} />
              {executeCheckout.isPending ? "Executing…" : "Execute authorized checkout"}
            </button>
            {!variantId ? <span className="text-xs text-warning-text">No purchasable variant found for this product.</span> : null}
            {executeCheckout.isError ? (
              <span className="text-sm text-danger-text">{executeCheckout.error instanceof ApiError ? executeCheckout.error.message : "Checkout failed."}</span>
            ) : null}
          </CardBody>
        ) : null}
      </Card>

      {executeCheckout.data ? <CheckoutSummary checkout={executeCheckout.data} /> : null}
    </div>
  );
}

function GovernanceControls({ proposal }: { proposal: GrowthActionProposalDTO }) {
  const evaluatePolicy = useEvaluatePolicy();
  const approve = useApproveProposal();
  const reject = useRejectProposal();
  const issueAuthorization = useIssueAuthorization();
  const [reason, setReason] = useState("");

  if (proposal.status === "PROPOSED") {
    return (
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => evaluatePolicy.mutate(proposal.id)}
          disabled={evaluatePolicy.isPending}
          className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Gavel size={14} />
          {evaluatePolicy.isPending ? "Evaluating…" : "Evaluate policy"}
        </button>
        {evaluatePolicy.isError ? (
          <p className="text-sm text-danger-text">{evaluatePolicy.error instanceof ApiError ? evaluatePolicy.error.message : "Could not evaluate policy."}</p>
        ) : null}
      </div>
    );
  }

  if (proposal.status === "PENDING_APPROVAL") {
    return (
      <div className="space-y-3 rounded-card border border-warning/40 bg-warning-subtle p-3">
        <p className="text-sm font-medium text-warning-text">Merchant decision required</p>
        <label className="block">
          <span className="text-xs text-ink-faint">Reason (optional)</span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            rows={2}
            className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-ink focus:border-brand-500"
            placeholder="e.g. Loyal customer, worth the discount."
          />
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => approve.mutate({ proposalId: proposal.id, reason: reason || undefined })}
            disabled={approve.isPending || reject.isPending}
            className="inline-flex items-center gap-1.5 rounded-md bg-success px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <CheckCircle2 size={14} />
            {approve.isPending ? "Approving…" : "Approve"}
          </button>
          <button
            type="button"
            onClick={() => reject.mutate({ proposalId: proposal.id, reason: reason || undefined })}
            disabled={approve.isPending || reject.isPending}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-ink hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-50"
          >
            <XCircle size={14} />
            {reject.isPending ? "Rejecting…" : "Reject"}
          </button>
        </div>
        {approve.isError ? (
          <p className="text-sm text-danger-text">{approve.error instanceof ApiError ? approve.error.message : "Could not approve."}</p>
        ) : null}
        {reject.isError ? (
          <p className="text-sm text-danger-text">{reject.error instanceof ApiError ? reject.error.message : "Could not reject."}</p>
        ) : null}
      </div>
    );
  }

  if ((proposal.status === "ALLOWED" || proposal.status === "APPROVED") && !proposal.executionAuthorizationId) {
    return (
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => issueAuthorization.mutate(proposal.id)}
          disabled={issueAuthorization.isPending}
          className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <KeyRound size={14} />
          {issueAuthorization.isPending ? "Requesting…" : "Request execution authorization"}
        </button>
        {issueAuthorization.isSuccess && "denied" in issueAuthorization.data ? (
          <p className="rounded-card bg-danger-subtle px-3 py-2 text-sm text-danger-text">
            Not authorized: {issueAuthorization.data.explanation}
          </p>
        ) : null}
      </div>
    );
  }

  return null;
}

export function GrowthProposalPanel({ proposal: initialProposal }: { proposal: GrowthActionProposalDTO }) {
  const { data: proposal = initialProposal } = useGrowthProposal(initialProposal.id, initialProposal);
  const isProposed = proposal.status !== "REJECTED_VALIDATION" && proposal.status !== "POLICY_DENIED" && proposal.status !== "APPROVAL_REJECTED";

  return (
    <div className="space-y-4">
      <Card className={isProposed ? undefined : "border-danger/40"}>
        <CardHeader className="flex flex-wrap items-center gap-2">
          <CardTitle>{isProposed ? "Growth Opportunity" : proposal.status === "REJECTED_VALIDATION" ? "Proposal Rejected" : "Denied"}</CardTitle>
          {proposal.actionType ? (
            <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700">
              {ACTION_TYPE_LABEL[proposal.actionType] ?? proposal.actionType}
            </span>
          ) : null}
          <span
            className={
              isProposed
                ? "rounded-full bg-success-subtle px-2 py-0.5 text-[11px] font-medium text-success-text"
                : "rounded-full bg-danger-subtle px-2 py-0.5 text-[11px] font-medium text-danger-text"
            }
          >
            {proposal.status.replace(/_/g, " ")}
          </span>
          <DemoDataBadge />
        </CardHeader>
        <CardBody className="space-y-3">
          <ExplainabilityStrip status={proposal.status} />

          {proposal.status === "REJECTED_VALIDATION" || proposal.status === "POLICY_DENIED" || proposal.status === "APPROVAL_REJECTED" ? (
            <div className="flex items-start gap-2 rounded-card bg-danger-subtle px-3 py-2 text-sm text-danger-text">
              <XCircle size={16} className="mt-0.5 shrink-0" />
              {proposal.rejectionReason ?? "This proposal did not proceed."}
            </div>
          ) : null}

          {isProposed && proposal.opportunity ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-card bg-surface-subtle p-3">
                <p className="text-xs text-ink-faint">Current basket</p>
                <p className="text-lg font-semibold text-ink">
                  {formatMoney({ amountMinor: proposal.opportunity.currentBasketMinor, currency: proposal.opportunity.currency })}
                </p>
              </div>
              <div className="rounded-card bg-surface-subtle p-3">
                <p className="text-xs text-ink-faint">Potential basket</p>
                <p className="text-lg font-semibold text-ink">
                  {formatMoney({ amountMinor: proposal.opportunity.potentialBasketMinor, currency: proposal.opportunity.currency })}
                </p>
              </div>
              <div className="rounded-card bg-info-subtle p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-info-text">Opportunity</p>
                <p className="text-lg font-semibold text-info-text">
                  +{formatMoney({ amountMinor: proposal.opportunity.opportunityDeltaMinor, currency: proposal.opportunity.currency })}
                </p>
              </div>
            </div>
          ) : null}

          {isProposed && proposal.offer && proposal.offerCalculation ? (
            <div className="rounded-card border border-border px-3 py-2 text-sm">
              <p className="font-medium text-ink">Requested offer terms (not yet authorized)</p>
              <p className="text-ink-muted">
                {proposal.offer.kind === "PERCENTAGE" ? formatBps(proposal.offer.percentageBps ?? 0) : formatMoney({ amountMinor: proposal.offer.amountMinor ?? 0, currency: proposal.offerCalculation.currency })}{" "}
                discount → final amount{" "}
                {formatMoney({ amountMinor: proposal.offerCalculation.finalAmountMinor, currency: proposal.offerCalculation.currency })}
              </p>
            </div>
          ) : null}

          {isProposed ? <GovernanceControls proposal={proposal} /> : null}
        </CardBody>
      </Card>

      {proposal.latestPolicyDecisionId ? <PolicyDecisionCard proposalId={proposal.id} /> : null}
      {proposal.executionAuthorizationId ? (
        <ExecutionAuthorizationCard
          authorizationId={proposal.executionAuthorizationId}
          primaryProductId={proposal.primaryProductId}
          policyDecisionId={proposal.latestPolicyDecisionId}
        />
      ) : null}

      {proposal.reasonCodes.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Why this action</CardTitle>
          </CardHeader>
          <CardBody>
            <ul className="space-y-1.5">
              {proposal.reasonCodes.map((code) => (
                <li key={code} className="flex items-start gap-1.5 text-sm text-ink-muted">
                  <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-success" />
                  {GROWTH_REASON_CODE_TEXT[code]}
                </li>
              ))}
            </ul>
            {proposal.explanation ? <p className="mt-3 border-t border-border pt-3 text-sm text-ink-muted">{proposal.explanation}</p> : null}
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Merchant Agent boundary</CardTitle>
        </CardHeader>
        <CardBody className="grid gap-3 text-sm sm:grid-cols-2">
          <div className="flex items-center gap-2">
            <Sparkles size={14} className="text-brand-600" />
            <span className="text-ink-muted">Proposal mode:</span>
            <span className="font-medium text-ink">{MODE_LABEL[proposal.mode] ?? proposal.mode}</span>
          </div>
          <div className="flex items-center gap-2">
            <ShieldAlert size={14} className="text-warning" />
            <span className="text-ink-muted">Policy status:</span>
            <span className="font-medium text-ink">{proposal.policyStatus.replace(/_/g, " ")}</span>
          </div>
          <div className="flex items-center gap-2">
            <Ban size={14} className="text-danger" />
            <span className="text-ink-muted">Execution authority:</span>
            <span className="font-medium text-ink">{proposal.status === "AUTHORIZED" ? "Authorized for execution — not yet executed" : "None — agent cannot move money"}</span>
          </div>
        </CardBody>
      </Card>

      {proposal.blockedOpportunities.length > 0 ? (
        <Card className="border-warning/40">
          <CardHeader>
            <CardTitle>Blocked growth opportunities</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3">
            {proposal.blockedOpportunities.map((b) => (
              <div key={b.productId} className="flex items-start gap-2 rounded-card bg-warning-subtle px-3 py-2 text-sm text-warning-text">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <div>
                  <p>
                    {ACTION_TYPE_LABEL[b.actionType] ?? b.actionType} blocked: {BLOCKER_CODE_TEXT[b.blockerCode] ?? b.blockerCode}
                  </p>
                  <p className="mt-0.5 text-xs opacity-80">Fix: {b.remediation}</p>
                  {b.relatedReadinessDimension && b.currentReadinessDimensionScore !== null ? (
                    <p className="mt-1 text-xs font-medium opacity-90">
                      Current {b.relatedReadinessDimension}: {b.currentReadinessDimensionScore}/100 — fixing this
                      product raises that dimension's evidence the next time readiness is recalculated.
                    </p>
                  ) : null}
                </div>
              </div>
            ))}
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
