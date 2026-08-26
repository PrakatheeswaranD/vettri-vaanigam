/**
 * Technical detail drawer for a selected Trust Trace stage (§19, §109,
 * §175). Keeps the main pipeline clean while still exposing everything a
 * technical judge would want to inspect: actor, event, reason, related
 * entity references, and per-event timestamps — never chain-of-thought,
 * never a secret.
 */
import { X } from "lucide-react";
import type { TrustTraceStage } from "./model";
import { ActorClassBadge } from "./ActorClassBadge";
import { formatDateTime } from "../../lib/format";

const ACTOR_LABEL: Record<string, string> = {
  BUYER_AGENT: "Buyer Agent",
  MERCHANT_AGENT: "Merchant Agent",
  POLICY_ENGINE: "Policy Engine",
  MERCHANT_USER: "Merchant (human)",
  CUSTOMER: "Customer",
  SYSTEM: "System",
  COMMERCE: "Commerce",
  PAYMENT_SYSTEM: "Payment System",
  RAZORPAY: "Razorpay",
};

export function TrustTraceDetailDrawer({ stage, onClose }: { stage: TrustTraceStage; onClose: () => void }) {
  return (
    <div role="dialog" aria-label={`${stage.label} details`} className="rounded-card border border-border bg-surface shadow-popover">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-ink">{stage.label}</p>
          <p className="text-xs text-ink-faint">{stage.events.length} ledger event{stage.events.length === 1 ? "" : "s"}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close stage details" className="rounded-md p-1.5 text-ink-muted hover:bg-surface-subtle">
          <X size={16} />
        </button>
      </div>
      <div className="max-h-96 divide-y divide-border overflow-y-auto">
        {stage.events.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-ink-muted">This stage was never reached — an earlier stage stopped the chain.</p>
        ) : (
          stage.events.map((event) => (
            <div key={`${event.sequence}-${event.event}`} className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-ink-faint">#{event.sequence}</span>
                <span className="text-xs font-semibold text-ink">{event.event}</span>
                <ActorClassBadge
                  actorClass={
                    event.actor === "BUYER_AGENT" || event.actor === "MERCHANT_AGENT"
                      ? "AI"
                      : event.actor === "MERCHANT_USER" || event.actor === "CUSTOMER"
                        ? "HUMAN"
                        : event.actor === "RAZORPAY"
                          ? "PROVIDER"
                          : "DETERMINISTIC"
                  }
                />
              </div>
              <p className="mt-1 text-xs text-ink-muted">{ACTOR_LABEL[event.actor] ?? event.actor}</p>
              <p className="mt-1.5 text-sm text-ink">{event.conciseReason}</p>
              <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[11px] text-ink-faint">
                <span>{formatDateTime(event.timestamp)}</span>
                {event.relatedEntityType ? (
                  <span>
                    {event.relatedEntityType}: {event.relatedEntityId?.slice(0, 8)}…
                  </span>
                ) : null}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
