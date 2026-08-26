import { CheckCircle2, CircleDashed, ShieldX, XCircle, type LucideIcon } from "lucide-react";
import type { SandboxStageStatusDTO } from "@razorgrowth/contracts";

export const SANDBOX_STAGE_STATUS_SPEC: Record<SandboxStageStatusDTO, { label: string; icon: LucideIcon; className: string }> = {
  BLOCKED: { label: "Blocked", icon: ShieldX, className: "bg-danger-subtle text-danger-text" },
  DENIED: { label: "Denied", icon: ShieldX, className: "bg-danger-subtle text-danger-text" },
  REJECTED: { label: "Rejected", icon: XCircle, className: "bg-danger-subtle text-danger-text" },
  NOT_ISSUED: { label: "Not Issued", icon: CircleDashed, className: "bg-surface-sunken text-ink-muted" },
  NOT_AVAILABLE: { label: "Occurred", icon: CheckCircle2, className: "bg-info-subtle text-info-text" },
  NOT_REACHED: { label: "Not Reached", icon: CircleDashed, className: "bg-surface-sunken text-ink-muted" },
};

export const ATTACK_CATEGORY_LABEL: Record<string, string> = {
  FINANCIAL_LIMIT: "Financial Limit",
  APPROVAL_BYPASS: "Approval Bypass",
  PRODUCT_HALLUCINATION: "Product Hallucination",
  PAYMENT_FORGERY: "Payment Forgery",
  RECOVERY_ABUSE: "Recovery Abuse",
  VISIBILITY_BYPASS: "Visibility Bypass",
};
