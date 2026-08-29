/**
 * What AI agents actually bought, and what the negotiator offered on it.
 *
 * REPLACES A PANEL THAT ASKED THE WRONG QUESTION
 *
 * The previous version asked the merchant to "pick a product a buyer has
 * selected" from a dropdown. That made sense when this product was a
 * merchant's own buyer agent — the merchant was simulating a selection
 * because nothing else could supply one.
 *
 * Under a gateway it is backwards. A merchant never has to guess what a
 * customer is buying: an outside agent SENDS the basket, and the negotiator
 * has already run on it inside the gate. Asking the merchant to invent a
 * basket by hand would be showing them a simulation of something the
 * system already knows for real.
 *
 * So this reads from Decision Records — real inbound baskets, real offers,
 * each one already clamped to the merchant's configured envelope.
 */
import { Bot, TrendingUp, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { Card, CardBody, CardHeader, CardTitle } from "../ui/Card";
import { useDecisionLog, useGatewayPolicy } from "../../hooks/use-agent-gateway";
import { formatMoney } from "../../lib/format";

function money(minor: number | null, currency: string | null): string {
  if (minor === null) return "—";
  return formatMoney({ amountMinor: minor, currency: currency === "USD" ? "USD" : "INR" });
}

export function AgentDrivenGrowth() {
  const decisions = useDecisionLog();
  const policy = useGatewayPolicy();

  const approved = (decisions.data?.items ?? []).filter((d) => d.outcome === "AUTO_APPROVE");
  const negotiated = approved.filter((d) => (d.negotiatedDiscountBps ?? 0) > 0);

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center gap-2">
        <Bot size={16} className="text-brand-600" />
        <CardTitle>Agent-driven growth</CardTitle>
        {policy.data ? (
          <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-surface-subtle px-2 py-0.5 text-[11px] font-medium text-ink-muted">
            <ShieldCheck size={11} />
            ceiling {(policy.data.maxNegotiationDiscountBps / 100).toFixed(0)}% · floor margin{" "}
            {(policy.data.negotiatorFloorMarginBps / 100).toFixed(0)}%
          </span>
        ) : null}
      </CardHeader>

      <CardBody className="space-y-4">
        <p className="text-sm text-ink-muted">
          You do not choose what an agent is buying — it tells you. Each basket below arrived through the gateway,
          and the negotiator ran on it automatically inside your configured envelope. It can propose an add-on and a
          bounded discount; it can never set a price, exceed your ceiling, or approve its own offer.
        </p>

        {decisions.isPending ? <p className="text-sm text-ink-muted">Loading agent activity…</p> : null}

        {!decisions.isPending && approved.length === 0 ? (
          <p className="rounded-card border border-border bg-surface-subtle px-3 py-2.5 text-sm text-ink-muted">
            No agent has completed a purchase yet, so there is nothing to negotiate on.{" "}
            <Link to="/agent-gateway" className="font-medium text-brand-600 hover:underline">
              Run the demo from the Agent Gateway
            </Link>{" "}
            to send five.
          </p>
        ) : null}

        {approved.length > 0 ? (
          <div className="space-y-2">
            {approved.slice(0, 8).map((d) => {
              const offered = (d.negotiatedDiscountBps ?? 0) > 0;
              return (
                <div key={d.id} className="rounded-card border border-border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {d.protocol ? (
                      <span className="rounded-full bg-surface-subtle px-2 py-0.5 text-[11px] font-medium text-ink-muted">
                        {d.protocol}
                      </span>
                    ) : null}
                    <span className="text-xs text-ink-faint">{d.externalAgentId ?? "unidentified agent"}</span>
                    <span className="ml-auto text-sm font-semibold text-ink">
                      {money(d.computedTotalMinor, d.currency)}
                    </span>
                  </div>

                  <p className="mt-2 text-xs text-ink-muted">
                    {offered ? (
                      <span className="inline-flex items-center gap-1 text-success-text">
                        <TrendingUp size={11} />
                        Negotiator offered {(d.negotiatedDiscountBps! / 100).toFixed(1)}% off to grow this basket
                      </span>
                    ) : (
                      // A declined upsell is a real, correct outcome, not a
                      // gap to paper over.
                      "Negotiator found nothing worth adding — no discount offered."
                    )}
                  </p>
                </div>
              );
            })}
          </div>
        ) : null}

        {approved.length > 0 ? (
          <p className="text-xs text-ink-faint">
            {negotiated.length} of {approved.length} agent purchases received an offer. Every one was clamped in code
            to your ceiling before it reached the agent — the model proposes, your policy disposes.
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}
