/**
 * The trust-boundary legend (§116): a compact badge distinguishing
 * AI-generated, deterministic, human-gated, and provider-verified stages.
 * This is what makes "where does AI authority stop?" visually obvious
 * without reading a single line of source code.
 */
import { clsx } from "clsx";
import { Bot, Cpu, User, ShieldCheck } from "lucide-react";
import type { TrustTraceActorClass } from "./model";

const SPEC: Record<TrustTraceActorClass, { label: string; icon: typeof Bot; className: string }> = {
  AI: { label: "AI", icon: Bot, className: "bg-brand-50 text-brand-700" },
  DETERMINISTIC: { label: "Deterministic", icon: Cpu, className: "bg-info-subtle text-info-text" },
  HUMAN: { label: "Human", icon: User, className: "bg-success-subtle text-success-text" },
  PROVIDER: { label: "Provider", icon: ShieldCheck, className: "bg-warning-subtle text-warning-text" },
};

export function ActorClassBadge({ actorClass }: { actorClass: TrustTraceActorClass | null }) {
  if (!actorClass) return null;
  const spec = SPEC[actorClass];
  const Icon = spec.icon;
  return (
    <span className={clsx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium", spec.className)}>
      <Icon size={10} />
      {spec.label}
    </span>
  );
}

export function TrustBoundaryLegend() {
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-ink-muted">
      {(Object.keys(SPEC) as TrustTraceActorClass[]).map((key) => (
        <span key={key} className="inline-flex items-center gap-1.5">
          <ActorClassBadge actorClass={key} />
          <span>
            {key === "AI" && "AI-generated"}
            {key === "DETERMINISTIC" && "Deterministic"}
            {key === "HUMAN" && "Human-gated"}
            {key === "PROVIDER" && "Provider-verified"}
          </span>
        </span>
      ))}
    </div>
  );
}
