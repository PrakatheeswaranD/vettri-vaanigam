/**
 * Policy Center (PART 05 §74-§76). Displays the real data the Policy
 * Engine reads — the autonomous threshold and the hard maximum are always
 * shown as two distinct numbers (§10), never collapsed into one — and, if
 * edited, the change goes through full server validation, a real
 * `policyVersion` increment, and an audit ledger event. There is no
 * frontend-only save; every field shown here is exactly what
 * `evaluatePolicy` reads.
 */
import { useEffect, useState } from "react";
import { Lock, Settings as SettingsIcon } from "lucide-react";
import { useMerchantPolicy } from "../hooks/use-api";
import { useUpdateMerchantPolicy } from "../hooks/use-policy";
import { Card, CardBody, CardHeader, CardTitle } from "../components/ui/Card";
import { ErrorState, Skeleton } from "../components/ui/States";
import { formatDateTime } from "../lib/format";
import { ApiError } from "../lib/api-client";

interface FormState {
  maxDiscountPercent: string;
  autoApprovalDiscountPercent: string;
  maxOrderAmount: string;
  autoApprovalOrderAmount: string;
  maxRecoveryAttempts: string;
  proposalValidityMinutes: string;
  approvalValidityMinutes: string;
  authorizationValidityMinutes: string;
}

function bpsToPercentString(bps: number): string {
  return (bps / 100).toString();
}

function minorToRupeeString(minor: number): string {
  return (minor / 100).toString();
}

export default function SettingsPage() {
  const { data: policy, isLoading, isError, error, refetch } = useMerchantPolicy();
  const update = useUpdateMerchantPolicy();
  const [form, setForm] = useState<FormState | null>(null);

  useEffect(() => {
    if (!policy) return;
    setForm({
      maxDiscountPercent: bpsToPercentString(policy.maxDiscountBps),
      autoApprovalDiscountPercent: bpsToPercentString(policy.autoApprovalDiscountBps),
      maxOrderAmount: minorToRupeeString(policy.maxOrderAmount.amountMinor),
      autoApprovalOrderAmount: minorToRupeeString(policy.autoApprovalOrderAmount.amountMinor),
      maxRecoveryAttempts: String(policy.maxRecoveryAttempts),
      proposalValidityMinutes: String(policy.proposalValidityMinutes),
      approvalValidityMinutes: String(policy.approvalValidityMinutes),
      authorizationValidityMinutes: String(policy.authorizationValidityMinutes),
    });
  }, [policy]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    update.mutate({
      maxDiscountBps: Math.round(Number(form.maxDiscountPercent) * 100),
      autoApprovalDiscountBps: Math.round(Number(form.autoApprovalDiscountPercent) * 100),
      maxOrderAmountMinor: Math.round(Number(form.maxOrderAmount) * 100),
      autoApprovalOrderAmountMinor: Math.round(Number(form.autoApprovalOrderAmount) * 100),
      maxRecoveryAttempts: Math.round(Number(form.maxRecoveryAttempts)),
      proposalValidityMinutes: Math.round(Number(form.proposalValidityMinutes)),
      approvalValidityMinutes: Math.round(Number(form.approvalValidityMinutes)),
      authorizationValidityMinutes: Math.round(Number(form.authorizationValidityMinutes)),
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Policy Center</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-muted">
          Merchant-defined financial boundaries. These limits are enforced by a deterministic, independently-tested
          Policy Engine — never by the AI itself, and never by the frontend.
        </p>
      </div>

      <Card className="border-brand-100 bg-brand-50/40">
        <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
          <div className="flex items-center gap-2 text-sm font-medium text-ink">
            <SettingsIcon size={14} /> AI proposes
          </div>
          <span className="hidden text-ink-faint sm:inline">→</span>
          <div className="flex items-center gap-2 text-sm font-medium text-ink">
            <Lock size={14} /> Policy decides
          </div>
          <span className="hidden text-ink-faint sm:inline">→</span>
          <div className="text-sm font-medium text-ink">Authorized code executes</div>
        </CardBody>
      </Card>

      {isLoading || !form ? (
        <Skeleton className="h-96 w-full" />
      ) : isError || !policy ? (
        <Card>
          <ErrorState
            message={error instanceof ApiError ? error.message : "Could not load merchant policy."}
            onRetry={() => refetch()}
          />
        </Card>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-6">
          <Card>
            <CardHeader className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle>Discount boundaries</CardTitle>
              <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-[11px] font-medium text-ink-muted">
                Policy version {policy.policyVersion}
              </span>
            </CardHeader>
            <CardBody className="grid gap-4 sm:grid-cols-2">
              <PercentField
                label="Automatic approval threshold"
                hint="At or below this, a proposal is ALLOWED without a human gate."
                value={form.autoApprovalDiscountPercent}
                onChange={(v) => setForm({ ...form, autoApprovalDiscountPercent: v })}
              />
              <PercentField
                label="Maximum discount (hard limit)"
                hint="Above this, a proposal is DENIED outright — no approval can override it."
                value={form.maxDiscountPercent}
                onChange={(v) => setForm({ ...form, maxDiscountPercent: v })}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Order amount boundaries</CardTitle>
            </CardHeader>
            <CardBody className="grid gap-4 sm:grid-cols-2">
              <MoneyField
                label="Automatic approval threshold"
                value={form.autoApprovalOrderAmount}
                onChange={(v) => setForm({ ...form, autoApprovalOrderAmount: v })}
              />
              <MoneyField
                label="Maximum order amount (hard limit)"
                value={form.maxOrderAmount}
                onChange={(v) => setForm({ ...form, maxOrderAmount: v })}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Lifecycle validity</CardTitle>
            </CardHeader>
            <CardBody className="grid gap-4 sm:grid-cols-3">
              <NumberField
                label="Proposal validity (minutes)"
                value={form.proposalValidityMinutes}
                onChange={(v) => setForm({ ...form, proposalValidityMinutes: v })}
              />
              <NumberField
                label="Approval validity (minutes)"
                value={form.approvalValidityMinutes}
                onChange={(v) => setForm({ ...form, approvalValidityMinutes: v })}
              />
              <NumberField
                label="Authorization validity (minutes)"
                value={form.authorizationValidityMinutes}
                onChange={(v) => setForm({ ...form, authorizationValidityMinutes: v })}
              />
              <NumberField
                label="Maximum recovery attempts"
                value={form.maxRecoveryAttempts}
                onChange={(v) => setForm({ ...form, maxRecoveryAttempts: v })}
              />
              <div>
                <dt className="text-xs text-ink-faint">Currency</dt>
                <dd className="mt-0.5 text-sm font-medium text-ink">{policy.currency}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink-faint">Last updated</dt>
                <dd className="mt-0.5 text-sm font-medium text-ink">{formatDateTime(policy.updatedAt)}</dd>
              </div>
            </CardBody>
          </Card>

          {update.isError ? (
            <p className="rounded-card bg-danger-subtle px-3 py-2 text-sm text-danger-text">
              {update.error instanceof ApiError ? update.error.message : "Could not save policy changes."}
            </p>
          ) : null}
          {update.isSuccess ? (
            <p className="rounded-card bg-success-subtle px-3 py-2 text-sm text-success-text">
              Saved — now policy version {update.data.policyVersion}.
            </p>
          ) : null}

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={update.isPending}
              className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {update.isPending ? "Saving…" : "Save policy"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function PercentField({ label, hint, value, onChange }: { label: string; hint: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-xs text-ink-faint">{label}</span>
      <div className="mt-1 flex items-center gap-1.5">
        <input
          type="number"
          min={0}
          max={100}
          step={0.1}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-24 rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-ink focus:border-brand-500"
        />
        <span className="text-sm text-ink-muted">%</span>
      </div>
      <p className="mt-1 text-xs text-ink-faint">{hint}</p>
    </label>
  );
}

function MoneyField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-xs text-ink-faint">{label}</span>
      <div className="mt-1 flex items-center gap-1.5">
        <span className="text-sm text-ink-muted">₹</span>
        <input
          type="number"
          min={0}
          step={1}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-32 rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-ink focus:border-brand-500"
        />
      </div>
    </label>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-xs text-ink-faint">{label}</span>
      <input
        type="number"
        min={0}
        step={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-ink focus:border-brand-500"
      />
    </label>
  );
}
