/**
 * Review-First vs Governed Autonomy (Part 11 §15).
 *
 * These are NOT two configurable modes backed by a second authority
 * model — this build has exactly one authority model, the deterministic
 * Policy Engine. Which path a proposal takes is decided per-proposal by
 * where its requested discount and order amount fall relative to the
 * merchant's configured thresholds.
 *
 * So this component explains the two paths the existing policy already
 * produces, and says plainly that there is no toggle. Rendering a fake
 * mode switch here would imply a control that does not exist.
 */
import { ArrowDown, ShieldQuestion, ShieldCheck, Info } from "lucide-react";
import { useMerchantPolicy } from "../../hooks/use-api";
import { Card, CardBody, CardHeader, CardTitle } from "../ui/Card";
import { formatBps } from "../../lib/format";

function Step({ text, muted }: { text: string; muted?: boolean }) {
  return (
    <p className={muted ? "text-xs text-ink-faint" : "text-xs text-ink-muted"}>{text}</p>
  );
}

function Arrow() {
  return <ArrowDown size={12} className="my-1 text-ink-faint" />;
}

export function AutonomyModes() {
  const { data: policy } = useMerchantPolicy();

  return (
    <Card>
      <CardHeader>
        <CardTitle>How a proposal is routed</CardTitle>
      </CardHeader>
      <CardBody className="space-y-4">
        <p className="text-xs text-ink-faint">
          There is no autonomy toggle in this product, because there is only one authority model: the
          deterministic Policy Engine. Which of these two paths a proposal takes is decided per-proposal, by where
          its numbers fall against the merchant&rsquo;s configured thresholds.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-card border border-success/40 bg-success-subtle/40 p-3">
            <div className="mb-2 flex items-center gap-1.5">
              <ShieldCheck size={13} className="text-success" />
              <p className="text-sm font-semibold text-ink">Governed autonomy</p>
            </div>
            <Step text="Merchant Agent identifies an opportunity" />
            <Arrow />
            <Step text="Structured proposal + deterministic validation" />
            <Arrow />
            <Step text="Policy: within the automatic limit" />
            <Arrow />
            <Step text="Scoped execution authorization issued" />
            <Arrow />
            <Step text="Deterministic commerce execution" />
            {policy ? (
              <p className="mt-2 border-t border-success/30 pt-2 text-[11px] text-success-text">
                Applies at or below {formatBps(policy.autoApprovalDiscountBps)} discount.
              </p>
            ) : null}
          </div>

          <div className="rounded-card border border-warning/40 bg-warning-subtle/40 p-3">
            <div className="mb-2 flex items-center gap-1.5">
              <ShieldQuestion size={13} className="text-warning" />
              <p className="text-sm font-semibold text-ink">Review first</p>
            </div>
            <Step text="Merchant Agent identifies an opportunity" />
            <Arrow />
            <Step text="Structured proposal + deterministic validation" />
            <Arrow />
            <Step text="Policy: exceeds the automatic limit" />
            <Arrow />
            <Step text="A human approver decides" />
            <Arrow />
            <Step text="Only then is authorization issued" />
            {policy ? (
              <p className="mt-2 border-t border-warning/30 pt-2 text-[11px] text-warning-text">
                Applies between {formatBps(policy.autoApprovalDiscountBps)} and{" "}
                {formatBps(policy.maxDiscountBps)}. Above that, policy denies outright.
              </p>
            ) : null}
          </div>
        </div>

        <p className="flex items-start gap-1.5 rounded-card bg-surface-subtle px-3 py-2 text-[11px] text-ink-muted">
          <Info size={12} className="mt-0.5 shrink-0" />
          Governed autonomy never means skipping a gate. Both paths run the same validation, the same policy
          evaluation, the same scoped authorization, and the same provider verification — the only difference is
          whether a human decision is required in the middle.
        </p>
      </CardBody>
    </Card>
  );
}
