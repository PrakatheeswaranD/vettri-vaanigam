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
import { Link } from "react-router-dom";
import { Lock, Settings as SettingsIcon } from "lucide-react";
import { useMerchantPolicy } from "../hooks/use-api";
import { useUpdateMerchantPolicy } from "../hooks/use-policy";
import { Card, CardBody, CardHeader, CardTitle } from "../components/ui/Card";
import { ErrorState, Skeleton } from "../components/ui/States";
import { formatDateTime } from "../lib/format";
import { ApiError } from "../lib/api-client";
import { CapabilitiesPanel } from "../components/capabilities/CapabilitiesPanel";
import { NamedSpecialists } from "../components/capabilities/NamedSpecialists";
import { AgentAuthorityTable } from "../components/capabilities/AgentAuthorityTable";
import { BusinessTriggers } from "../components/capabilities/BusinessTriggers";
import { CapabilityStrip } from "../components/capabilities/CapabilityStrip";
import { ConnectedSystems } from "../components/capabilities/ConnectedSystems";
import { AutonomyModes } from "../components/capabilities/AutonomyModes";
import { RecoveryGuardrails } from "../components/capabilities/RecoveryGuardrails";
import { ReviewAndActivate } from "../components/capabilities/ReviewAndActivate";
import { DiscountAuthorityBar } from "../components/policy/DiscountAuthorityBar";
import { PageHeader } from "../components/layout/PageHeader";

type SettingsTab = "commerce-data" | "capabilities" | "guardrails" | "review";

/** The merchant CONFIGURE lifecycle (spec §8): commerce data →
 * capabilities → guardrails → review. Rendered as ordered tabs rather
 * than a onboarding wizard, because every step is independently
 * re-visitable configuration, not a one-time setup flow. */
const CONFIG_STEPS: { id: SettingsTab; label: string }[] = [
  { id: "commerce-data", label: "Commerce Data" },
  { id: "capabilities", label: "Capabilities" },
  { id: "guardrails", label: "Guardrails" },
  { id: "review", label: "Review" },
];

interface FormState {
  maxDiscountPercent: string;
  autoApprovalDiscountPercent: string;
  maxOrderAmount: string;
  autoApprovalOrderAmount: string;
  maxRecoveryAttempts: string;
  proposalValidityMinutes: string;
  approvalValidityMinutes: string;
  authorizationValidityMinutes: string;
  // PART 08 boundaries. Every one is enforced by the Policy Engine on the
  // server; the controls below are how a merchant SETS them, never how
  // they are applied.
  minMarginPercent: string;
  maxAutonomousActionsPerDay: string;
  recoveryEnabled: boolean;
  prohibitedActions: string[];
  eligibleCategories: string;
  minCustomerPaidOrders: string;
}

/** The action types a merchant can forbid outright. Matches the
 * `GrowthActionType` enum the Policy Engine compares against — a name that
 * does not appear there would be a prohibition that silently never fires. */
const PROHIBITABLE_ACTIONS = [
  { value: "CROSS_SELL", label: "Cross-sell", effect: "Recommending a complementary product alongside one a buyer chose." },
  { value: "UPSELL", label: "Upsell", effect: "Offering a dearer variant of the product a buyer chose." },
  { value: "BUNDLE", label: "Bundles", effect: "Offering two or more products together at a bounded price." },
  { value: "BOUNDED_OFFER", label: "Bounded offers", effect: "Any discount, even one inside your ceiling." },
  { value: "RECOVERY", label: "Payment recovery", effect: "Retrying a failed payment through a new authorized checkout." },
] as const;

function bpsToPercentString(bps: number): string {
  return (bps / 100).toString();
}

function minorToRupeeString(minor: number): string {
  return (minor / 100).toString();
}

export default function SettingsPage() {
  const [tab, setTab] = useState<SettingsTab>("commerce-data");
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
      minMarginPercent: bpsToPercentString(policy.minMarginBps),
      maxAutonomousActionsPerDay: String(policy.maxAutonomousActionsPerDay),
      recoveryEnabled: policy.recoveryEnabled,
      prohibitedActions: policy.prohibitedActions,
      // A comma-separated list rather than a picker: the merchant's own
      // category names are free text in this catalogue, so a fixed list
      // would be wrong the moment they add a category.
      eligibleCategories: policy.eligibleCategories.join(", "),
      minCustomerPaidOrders: String(policy.minCustomerPaidOrders),
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
      minMarginBps: Math.round(Number(form.minMarginPercent) * 100),
      maxAutonomousActionsPerDay: Math.round(Number(form.maxAutonomousActionsPerDay)),
      recoveryEnabled: form.recoveryEnabled,
      prohibitedActions: form.prohibitedActions,
      eligibleCategories: form.eligibleCategories
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
      minCustomerPaidOrders: Math.round(Number(form.minCustomerPaidOrders)),
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <PageHeader
          title={"Rules"}
          lead={"The limits a human has set. These are read by the real system on every decision — nothing here is display-only."}
        />
        <p className="mt-2 max-w-2xl rounded-card border border-border bg-surface-subtle px-3 py-2 text-sm text-ink-muted">
          These govern this merchant&rsquo;s <span className="font-medium text-ink">own</span> agents. What{" "}
          <span className="font-medium text-ink">outside</span> buyer agents may do — ceilings, blocked categories, the
          negotiator envelope, velocity — is a separate policy in the{" "}
          <Link to="/merchant/governance/decisions" className="font-medium text-brand-600 hover:underline">
            Agent Gateway
          </Link>
          . Two audiences, two policies, deliberately not merged.
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

      {/* The CONFIGURE lifecycle, as four ordered steps (spec §8) */}
      <div className="flex gap-1 overflow-x-auto border-b border-border">
        {CONFIG_STEPS.map((step, i) => (
          <button
            key={step.id}
            type="button"
            onClick={() => setTab(step.id)}
            className={
              "flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium " +
              (tab === step.id ? "border-brand-600 text-brand-700" : "border-transparent text-ink-muted hover:text-ink")
            }
          >
            <span
              className={
                "flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-semibold " +
                (tab === step.id ? "bg-brand-600 text-white" : "bg-surface-sunken text-ink-faint")
              }
            >
              {i + 1}
            </span>
            {step.label}
          </button>
        ))}
      </div>

      {tab === "commerce-data" ? (
        <div className="space-y-6">
          <ConnectedSystems />
          <Card>
            <CardHeader>
              <CardTitle>System Capability Summary</CardTitle>
            </CardHeader>
            <CardBody>
              <CapabilityStrip />
            </CardBody>
          </Card>
        </div>
      ) : tab === "capabilities" ? (
        <div className="space-y-6">
          <NamedSpecialists />
          <CapabilitiesPanel />
          <div className="grid gap-6 lg:grid-cols-2">
            <BusinessTriggers />
            <AgentAuthorityTable />
          </div>
          <AutonomyModes />
        </div>
      ) : tab === "review" ? (
        <ReviewAndActivate />
      ) : isLoading || !form ? (
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
              <CardTitle>Discount authority</CardTitle>
              <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-[11px] font-medium text-ink-muted">
                Policy version {policy.policyVersion}
              </span>
            </CardHeader>
            <CardBody>
              <DiscountAuthorityBar
                autoApprovalBps={policy.autoApprovalDiscountBps}
                maxBps={policy.maxDiscountBps}
              />
            </CardBody>
          </Card>

          <RecoveryGuardrails />

          <Card>
            <CardHeader>
              <CardTitle>Discount boundaries</CardTitle>
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
              <NumberField
                label="Minimum margin (%)"
                value={form.minMarginPercent}
                onChange={(v) => setForm({ ...form, minMarginPercent: v })}
              />
              <NumberField
                label="Maximum unattended actions per day"
                value={form.maxAutonomousActionsPerDay}
                onChange={(v) => setForm({ ...form, maxAutonomousActionsPerDay: v })}
              />
              <NumberField
                label="Minimum paid orders before targeting a customer"
                value={form.minCustomerPaidOrders}
                onChange={(v) => setForm({ ...form, minCustomerPaidOrders: v })}
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

          <Card>
            <CardHeader>
              <CardTitle>What the agent may never do</CardTitle>
            </CardHeader>
            <CardBody className="space-y-4">
              <p className="text-xs leading-relaxed text-ink-muted">
                A prohibition is not a threshold. Anything listed here is refused outright by the policy engine — it is
                never sent to you for approval, and enabling the same feature elsewhere cannot re-permit it.
              </p>
              <div className="divide-y divide-border-hair">
                {PROHIBITABLE_ACTIONS.map((action) => {
                  const prohibited = form.prohibitedActions.includes(action.value);
                  return (
                    <label key={action.value} className="flex cursor-pointer items-start gap-3 py-3 first:pt-0 last:pb-0">
                      <input
                        type="checkbox"
                        checked={prohibited}
                        onChange={(event) =>
                          setForm({
                            ...form,
                            prohibitedActions: event.target.checked
                              ? [...form.prohibitedActions, action.value]
                              : form.prohibitedActions.filter((entry) => entry !== action.value),
                          })
                        }
                        className="mt-0.5 h-4 w-4 shrink-0 rounded border-border text-danger"
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-ink">Never {action.label.toLowerCase()}</span>
                        <span className="mt-0.5 block text-xs leading-snug text-ink-muted">{action.effect}</span>
                      </span>
                    </label>
                  );
                })}
              </div>

              <label className="flex cursor-pointer items-start gap-3 border-t border-border-hair pt-4">
                <input
                  type="checkbox"
                  checked={form.recoveryEnabled}
                  onChange={(event) => setForm({ ...form, recoveryEnabled: event.target.checked })}
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-border text-brand-600"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-ink">Allow automated payment recovery</span>
                  <span className="mt-0.5 block text-xs leading-snug text-ink-muted">
                    Separate from the retry limit above. Off means no automated retry ever happens, without you having to
                    set a limit of zero and leave the intention ambiguous.
                  </span>
                </span>
              </label>

              <div className="border-t border-border-hair pt-4">
                <label className="block text-sm font-medium text-ink" htmlFor="eligible-categories">
                  Categories the agent may act on
                </label>
                <input
                  id="eligible-categories"
                  type="text"
                  value={form.eligibleCategories}
                  onChange={(event) => setForm({ ...form, eligibleCategories: event.target.value })}
                  placeholder="Leave empty to permit every category"
                  className="mt-1.5 w-full rounded-md border border-border-hair bg-surface px-2.5 py-2 text-sm text-ink"
                />
                <p className="mt-1 text-xs leading-snug text-ink-faint">
                  Comma-separated, and matched exactly against your product categories. Empty means all — naming even one
                  excludes every category you did not name.
                </p>
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
