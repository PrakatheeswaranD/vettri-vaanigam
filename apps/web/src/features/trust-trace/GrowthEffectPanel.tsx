/**
 * Trust Trace growth effect (Part 11 §47).
 *
 * Shows what this one workflow was worth, with the potential and the
 * realized kept visually separate and separately labelled. The captured
 * figure appears only when a provider-verified CAPTURED payment exists;
 * until then the panel says so plainly rather than showing a zero that
 * could be misread as a loss, or a potential figure that could be
 * misread as revenue.
 *
 * No uplift percentage is shown anywhere: attributing the captured
 * basket TO the agent would need a control group this build does not
 * have.
 */
import type { WorkflowGrowthEffectDTO } from "@razorgrowth/contracts";
import { Card, CardBody, CardHeader, CardTitle } from "../../components/ui/Card";
import { ValueTag } from "../../components/ui/ValueTag";
import { formatMoney } from "../../lib/format";

export function GrowthEffectPanel({ effect }: { effect: WorkflowGrowthEffectDTO }) {
  const money = (amountMinor: number) => formatMoney({ amountMinor, currency: effect.currency });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Growth effect</CardTitle>
      </CardHeader>
      <CardBody className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-card bg-surface-subtle p-3">
            <p className="text-xs text-ink-faint">Base basket</p>
            <p className="text-lg font-semibold text-ink">{money(effect.baseBasketMinor)}</p>
          </div>
          <div className="rounded-card bg-surface-subtle p-3">
            <p className="text-xs text-ink-faint">Growth opportunity</p>
            <p className="text-lg font-semibold text-ink">
              {effect.opportunityDeltaMinor >= 0 ? "+" : ""}
              {money(effect.opportunityDeltaMinor)}
            </p>
          </div>
          <div className="rounded-card bg-surface-subtle p-3">
            <p className="text-xs text-ink-faint">Potential basket</p>
            <p className="text-lg font-semibold text-ink">{money(effect.potentialBasketMinor)}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded-card bg-surface-subtle px-3 py-2">
          <ValueTag classification="OPPORTUNITY" />
          <span className="text-xs text-ink-muted">
            The three figures above are the Merchant Agent&rsquo;s own calculation. They are potential, not revenue.
          </span>
        </div>

        {effect.capturedBasketMinor !== null ? (
          <div className="rounded-card bg-success-subtle p-3">
            <div className="mb-1 flex items-center gap-2">
              <ValueTag classification="OBSERVED" />
            </div>
            <p className="text-xl font-semibold text-success-text">{money(effect.capturedBasketMinor)}</p>
            <p className="mt-0.5 text-xs text-success-text/90">
              Captured basket — a real, provider-verified payment. This is what actually arrived; it is not a
              measurement of revenue the agent caused.
            </p>
          </div>
        ) : (
          <div className="rounded-card border border-border px-3 py-2">
            <p className="text-sm font-medium text-ink">No captured basket yet</p>
            <p className="mt-0.5 text-xs text-ink-muted">
              No provider-verified capture exists for this workflow, so there is no observed value to report.
            </p>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
