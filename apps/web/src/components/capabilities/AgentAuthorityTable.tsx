/**
 * Agent authority boundaries (spec §9). A static reference table, not a
 * live per-merchant RBAC panel — it documents what this codebase's
 * architecture actually enforces (verified elsewhere in this repo: the
 * Merchant Agent only ever calls `proposeGrowthAction`, never
 * `decideApproval` or the payment gateway directly; `approverId` always
 * comes from the authenticated session, never the request body; capture
 * is only ever set from verified Razorpay webhook evidence). Shown here
 * so a merchant can see the boundary at a glance, never to imply it is
 * merchant-configurable.
 */
import { Eye, Plus, ShieldQuestion, Ban } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "../ui/Card";

type AuthorityLevel = "READ" | "CREATE" | "PROPOSE_ONLY" | "NO_ACCESS";

const LEVEL_SPEC: Record<AuthorityLevel, { label: string; className: string; icon: typeof Eye }> = {
  READ: { label: "Read", className: "bg-info-subtle text-info-text", icon: Eye },
  CREATE: { label: "Create", className: "bg-success-subtle text-success-text", icon: Plus },
  PROPOSE_ONLY: { label: "Propose Only", className: "bg-warning-subtle text-warning-text", icon: ShieldQuestion },
  NO_ACCESS: { label: "No Access", className: "bg-danger-subtle text-danger-text", icon: Ban },
};

const ROWS: { resource: string; level: AuthorityLevel }[] = [
  { resource: "Catalog", level: "READ" },
  { resource: "Inventory", level: "READ" },
  { resource: "Orders", level: "READ" },
  { resource: "Buyer intent", level: "READ" },
  { resource: "Recommendations", level: "CREATE" },
  { resource: "Cross-sell proposals", level: "CREATE" },
  { resource: "Upsell proposals", level: "CREATE" },
  { resource: "Offer proposals", level: "CREATE" },
  { resource: "Recovery proposals", level: "CREATE" },
  { resource: "Discount execution", level: "PROPOSE_ONLY" },
  { resource: "Self approval", level: "NO_ACCESS" },
  { resource: "Policy override", level: "NO_ACCESS" },
  { resource: "Payment capture", level: "NO_ACCESS" },
  { resource: "Payment state override", level: "NO_ACCESS" },
  { resource: "Unlimited retry", level: "NO_ACCESS" },
];

export function AgentAuthorityTable() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Agent Authority</CardTitle>
      </CardHeader>
      <CardBody>
        <p className="mb-3 text-xs text-ink-faint">
          What the Buyer/Merchant Agent can and cannot do, enforced by the code architecture — not a configurable
          setting. The AI can reason and propose; only deterministic policy, a human approver, and server-side
          authorization can move a proposal further.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {ROWS.map((row) => {
            const spec = LEVEL_SPEC[row.level];
            const Icon = spec.icon;
            return (
              <div key={row.resource} className="flex items-center justify-between rounded-card bg-surface-subtle px-3 py-2 text-sm">
                <span className="text-ink-muted">{row.resource}</span>
                <span className={"inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium " + spec.className}>
                  <Icon size={11} />
                  {spec.label}
                </span>
              </div>
            );
          })}
        </div>
      </CardBody>
    </Card>
  );
}
