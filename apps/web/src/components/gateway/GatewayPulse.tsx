/**
 * The gateway's pulse, on the landing page.
 *
 * WHY THIS WAS MISSING AND WHY THAT MATTERED
 *
 * Overview rendered readiness, connected systems, an activity feed and a
 * workflow strip — and nothing at all about the gateway. A merchant landed
 * on the front page of an agent-commerce product and saw no evidence that
 * agents were transacting with them. The single most important fact under
 * this thesis was the one fact the front page omitted.
 */
import { Link } from "react-router-dom";
import { Radio, ArrowRight } from "lucide-react";
import { Card, CardBody } from "../ui/Card";
import { useGatewayMetrics } from "../../hooks/use-agent-gateway";

export function GatewayPulse() {
  const metrics = useGatewayMetrics();
  const m = metrics.data;

  return (
    <Card>
      <CardBody className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Radio size={15} className="text-brand-600" />
          <p className="text-sm font-semibold text-ink">Agent gateway</p>
          <Link
            to="/merchant/governance/decisions"
            className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline"
          >
            Decision log
            <ArrowRight size={12} />
          </Link>
        </div>

        {m && m.totalDecisions > 0 ? (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <p className="text-xl font-semibold text-ink">{m.totalDecisions}</p>
                <p className="text-xs text-ink-muted">Agent purchase intents</p>
              </div>
              <div>
                <p className="text-xl font-semibold text-ink">
                  {m.autoApprovalRatePct === null ? "—" : `${m.autoApprovalRatePct}%`}
                </p>
                <p className="text-xs text-ink-muted">Auto-approved</p>
              </div>
              <div>
                <p className="text-xl font-semibold text-ink">
                  {m.medianDecisionLatencyMs === null ? "—" : `${m.medianDecisionLatencyMs}ms`}
                </p>
                <p className="text-xs text-ink-muted">Median decision</p>
              </div>
            </div>
            <p className="text-xs text-ink-faint">
              Every one carries a written reason. Nothing reached a payment API without a signed mandate and your
              policy both passing.
            </p>
          </>
        ) : (
          <p className="text-sm text-ink-muted">
            No AI buyer agent has called your gateway yet.{" "}
            <Link to="/merchant/governance/decisions" className="font-medium text-brand-600 hover:underline">
              Run the demo
            </Link>{" "}
            to send five across ACP, AP2 and x402.
          </p>
        )}
      </CardBody>
    </Card>
  );
}
