import { clsx } from "clsx";
import { CheckCircle2, AlertTriangle, XCircle } from "lucide-react";

const CONFIG: Record<string, { label: string; className: string; icon: typeof CheckCircle2 }> = {
  AGENT_READY: { label: "Agent Ready", className: "bg-success-subtle text-success-text", icon: CheckCircle2 },
  PARTIALLY_READY: { label: "Partially Ready", className: "bg-warning-subtle text-warning-text", icon: AlertTriangle },
  NOT_READY: { label: "Not Ready", className: "bg-danger-subtle text-danger-text", icon: XCircle },
};

/** PART 02 §96 — deliberately not "AI Approved": no external authority
 * approved anything, this is a deterministic classification. */
export function ProductReadinessBadge({ state }: { state: string }) {
  const config = CONFIG[state] ?? CONFIG.NOT_READY!;
  const Icon = config.icon;
  return (
    <span className={clsx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium", config.className)}>
      <Icon size={10} />
      {config.label}
    </span>
  );
}
