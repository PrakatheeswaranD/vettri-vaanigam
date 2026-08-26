/**
 * Centralized semantic status presentation (PART 01 §73). One badge
 * component maps every payment state / agent action status to a
 * consistent color + label + icon — never color alone, and never a
 * component-local ad hoc style.
 */
import { clsx } from "clsx";
import {
  CheckCircle2,
  Clock,
  XCircle,
  AlertCircle,
  HelpCircle,
  ShieldCheck,
  ShieldX,
  ShieldQuestion,
  Ban,
  type LucideIcon,
} from "lucide-react";

type Tone = "success" | "warning" | "danger" | "info" | "neutral";

const TONE_CLASSES: Record<Tone, string> = {
  success: "bg-success-subtle text-success-text",
  warning: "bg-warning-subtle text-warning-text",
  danger: "bg-danger-subtle text-danger-text",
  info: "bg-info-subtle text-info-text",
  neutral: "bg-surface-sunken text-ink-muted",
};

interface StatusSpec {
  label: string;
  tone: Tone;
  icon: LucideIcon;
}

const PAYMENT_STATE_SPEC: Record<string, StatusSpec> = {
  CREATED: { label: "Created", tone: "neutral", icon: Clock },
  AUTHORIZED: { label: "Authorized", tone: "info", icon: ShieldCheck },
  CAPTURED: { label: "Captured", tone: "success", icon: CheckCircle2 },
  FAILED: { label: "Failed", tone: "danger", icon: XCircle },
  CANCELLED: { label: "Cancelled", tone: "neutral", icon: Ban },
  UNKNOWN: { label: "Unknown", tone: "warning", icon: HelpCircle },
};

const AGENT_ACTION_STATUS_SPEC: Record<string, StatusSpec> = {
  PROPOSED: { label: "Proposed", tone: "neutral", icon: Clock },
  PENDING_APPROVAL: { label: "Pending Approval", tone: "warning", icon: AlertCircle },
  APPROVED: { label: "Approved", tone: "success", icon: CheckCircle2 },
  REJECTED: { label: "Rejected", tone: "danger", icon: ShieldX },
  EXPIRED: { label: "Expired", tone: "neutral", icon: Ban },
  EXECUTED: { label: "Executed", tone: "info", icon: ShieldCheck },
  FAILED: { label: "Failed", tone: "danger", icon: XCircle },
  VERIFIED: { label: "Verified", tone: "success", icon: CheckCircle2 },
};

const POLICY_DECISION_SPEC: Record<string, StatusSpec> = {
  ALLOW: { label: "Allow", tone: "success", icon: ShieldCheck },
  DENY: { label: "Deny", tone: "danger", icon: ShieldX },
  REQUIRE_APPROVAL: { label: "Requires Approval", tone: "warning", icon: ShieldQuestion },
};

function Badge({ spec }: { spec: StatusSpec }) {
  const Icon = spec.icon;
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        TONE_CLASSES[spec.tone],
      )}
    >
      <Icon size={12} />
      {spec.label}
    </span>
  );
}

export function PaymentStateBadge({ state }: { state: string }) {
  return <Badge spec={PAYMENT_STATE_SPEC[state] ?? { label: state, tone: "neutral", icon: HelpCircle }} />;
}

export function AgentActionStatusBadge({ status }: { status: string }) {
  return <Badge spec={AGENT_ACTION_STATUS_SPEC[status] ?? { label: status, tone: "neutral", icon: HelpCircle }} />;
}

export function PolicyDecisionBadge({ decision }: { decision: string }) {
  return <Badge spec={POLICY_DECISION_SPEC[decision] ?? { label: decision, tone: "neutral", icon: HelpCircle }} />;
}
