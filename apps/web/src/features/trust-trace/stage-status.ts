/**
 * Centralized status → visual semantic mapping for Trust Trace stages
 * (§111 — no scattered conditionals). Colors follow the same domain
 * semantics as everywhere else in the product (§9): green = allow/ready,
 * amber = attention/waiting, red = deny/blocked/failed, blue = neutral
 * evidence/in-progress.
 */
import { CheckCircle2, CircleDashed, Clock, ShieldX, XCircle, type LucideIcon } from "lucide-react";
import type { TrustTraceStageStatus } from "./model";

export interface StageStatusSpec {
  label: string;
  icon: LucideIcon;
  dotClassName: string;
  badgeClassName: string;
}

export const STAGE_STATUS_SPEC: Record<TrustTraceStageStatus, StageStatusSpec> = {
  NOT_REACHED: { label: "Not Reached", icon: CircleDashed, dotClassName: "bg-surface-sunken border-2 border-border", badgeClassName: "bg-surface-sunken text-ink-muted" },
  IN_PROGRESS: { label: "In Progress", icon: Clock, dotClassName: "bg-info text-white", badgeClassName: "bg-info-subtle text-info-text" },
  OK: { label: "OK", icon: CheckCircle2, dotClassName: "bg-success text-white", badgeClassName: "bg-success-subtle text-success-text" },
  ATTENTION: { label: "Attention", icon: Clock, dotClassName: "bg-warning text-white", badgeClassName: "bg-warning-subtle text-warning-text" },
  FAILED: { label: "Failed", icon: XCircle, dotClassName: "bg-danger text-white", badgeClassName: "bg-danger-subtle text-danger-text" },
  BLOCKED: { label: "Blocked", icon: ShieldX, dotClassName: "bg-danger text-white", badgeClassName: "bg-danger-subtle text-danger-text" },
};
