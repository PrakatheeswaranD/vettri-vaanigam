import { clsx } from "clsx";
import { CheckCircle2, AlertTriangle, AlertCircle, XCircle } from "lucide-react";

const LEVEL_CONFIG: Record<string, { label: string; className: string; icon: typeof CheckCircle2 }> = {
  AGENT_READY: { label: "Agent Ready", className: "bg-success-subtle text-success-text", icon: CheckCircle2 },
  NEARLY_READY: { label: "Nearly Ready", className: "bg-info-subtle text-info-text", icon: AlertCircle },
  PARTIALLY_READY: { label: "Partially Ready", className: "bg-warning-subtle text-warning-text", icon: AlertTriangle },
  NOT_READY: { label: "Not Ready", className: "bg-danger-subtle text-danger-text", icon: XCircle },
};

export function ReadinessLevelBadge({ level }: { level: string }) {
  const config = LEVEL_CONFIG[level] ?? LEVEL_CONFIG.NOT_READY!;
  const Icon = config.icon;
  return (
    <span className={clsx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium", config.className)}>
      <Icon size={12} />
      {config.label}
    </span>
  );
}
