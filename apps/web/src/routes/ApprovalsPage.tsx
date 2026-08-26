/**
 * Approval Center (PART 05 §77-§79). Every proposal shown here is real,
 * persisted, and currently `PENDING_APPROVAL` — this is the human gate
 * PART 05 requires before a `REQUIRE_APPROVAL` proposal can ever receive
 * execution authorization. Reuses `GrowthProposalPanel` so the same
 * explainability view (AI Proposal → Validation → Policy → Approval →
 * Authorization) appears here as it does on the Growth page.
 */
import { ShieldQuestion } from "lucide-react";
import { usePendingApprovals } from "../hooks/use-policy";
import { Card } from "../components/ui/Card";
import { EmptyState, ErrorState, Skeleton } from "../components/ui/States";
import { ApiError } from "../lib/api-client";
import { GrowthProposalPanel } from "../components/merchant-agent/GrowthProposalPanel";

export default function ApprovalsPage() {
  const { data, isLoading, isError, error, refetch } = usePendingApprovals();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Approval Center</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-muted">
          Growth proposals that deterministic policy has gated for human review — nothing here has been executed,
          and nothing here is authorized until you decide.
        </p>
      </div>

      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : isError ? (
        <Card>
          <ErrorState
            message={error instanceof ApiError ? error.message : "Could not load pending approvals."}
            onRetry={() => refetch()}
          />
        </Card>
      ) : !data || data.items.length === 0 ? (
        <Card>
          <EmptyState
            icon={<ShieldQuestion size={18} />}
            title="Nothing awaiting approval"
            description="Proposals appear here only when the Policy Engine decides REQUIRE_APPROVAL — a discount or order amount above the automatic threshold, but still within the merchant's hard limit."
          />
        </Card>
      ) : (
        <div className="space-y-6">
          {data.items.map((item) => (
            <GrowthProposalPanel key={item.proposal.id} proposal={item.proposal} />
          ))}
        </div>
      )}
    </div>
  );
}
