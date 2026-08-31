/**
 * The Buyer Agent's reasoning pipeline, made visible (spec §13-§14) — not
 * a chat transcript. Every step here renders a REAL trace entry the
 * server already returns (`response.trace`, PART 03 §109-§111); this
 * component only gives those same facts a pipeline shape instead of
 * burying them behind a collapsed "Agent trace" toggle. No step is shown
 * unless the underlying data for it actually exists.
 */
import { useState, type ReactNode } from "react";
import type { BuyerAgentResponseDTO, RecommendedProductDTO } from "@razorgrowth/contracts";
import { CheckCircle2, MessageSquare } from "lucide-react";
import { IntentPanel } from "./IntentPanel";
import { RecommendationCard } from "./RecommendationCard";
import { AgentTracePanel } from "./AgentTracePanel";
import { AgentBuyabilityVerdict } from "./AgentBuyabilityVerdict";
import { ProductComparisonTable } from "./ProductComparisonTable";
import { PaymentProposalModal } from "./PaymentProposalModal";

function traceDetail(response: BuyerAgentResponseDTO, stage: string): string | null {
  return response.trace.find((t) => t.stage === stage)?.detail ?? null;
}

function PipelineStep({
  index,
  label,
  detail,
  children,
}: {
  index: number;
  label: string;
  detail?: string | null;
  children?: ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-600 text-[11px] font-semibold text-white">
          {index}
        </span>
        <span className="mt-1 w-px flex-1 bg-border" />
      </div>
      <div className="min-w-0 flex-1 pb-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{label}</p>
        {detail ? <p className="mt-1 text-sm text-ink-muted">{detail}</p> : null}
        {children ? <div className="mt-2">{children}</div> : null}
      </div>
    </div>
  );
}

export function BuyerReasoningPipeline({ buyerMessage, response }: { buyerMessage: string; response: BuyerAgentResponseDTO }) {
  const [selectedForProposal, setSelectedForProposal] = useState<RecommendedProductDTO | null>(null);
  const catalogDetail = traceDetail(response, "CATALOG_FILTERED");
  const evaluationDetail = traceDetail(response, "CANDIDATES_EVALUATED");
  const groundingDetail = traceDetail(response, "RECOMMENDATION_GENERATED") ?? traceDetail(response, "RECOMMENDATION_FALLBACK");
  const groundingFailed = response.trace.some((t) => t.stage === "RECOMMENDATION_FALLBACK");

  return (
    <div className="rounded-card border border-border bg-surface p-4">
      <PipelineStep index={1} label="Buyer Request">
        <p className="flex items-start gap-2 rounded-card bg-surface-subtle px-3 py-2 text-sm text-ink">
          <MessageSquare size={14} className="mt-0.5 shrink-0 text-ink-faint" />
          &ldquo;{buyerMessage}&rdquo;
        </p>
      </PipelineStep>

      {response.intent ? (
        <PipelineStep index={2} label="Interpreted Intent">
          <IntentPanel intent={response.intent} />
        </PipelineStep>
      ) : null}

      {catalogDetail ? (
        <PipelineStep index={3} label="Catalog Search & Deterministic Filtering" detail={catalogDetail} />
      ) : null}

      {evaluationDetail ? <PipelineStep index={4} label="Candidate Evaluation" detail={evaluationDetail} /> : null}

      {groundingDetail ? (
        <PipelineStep
          index={5}
          label={groundingFailed ? "Grounding Validation — AI ranking rejected, deterministic fallback used" : "AI Ranking & Grounding Validation"}
          detail={groundingDetail}
        />
      ) : null}

      {response.recommendations.length > 0 ? (
        <PipelineStep index={6} label="Grounded Product Matches & Comparison">
          <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-success-subtle px-2 py-0.5 text-[11px] font-medium text-success-text">
            <CheckCircle2 size={11} />
            Grounding verified — every result is a real, currently-available catalog product
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {response.recommendations.map((rec) => (
              <RecommendationCard key={rec.productId} recommendation={rec} />
            ))}
          </div>

          <ProductComparisonTable
            recommendations={response.recommendations}
            onSelectProduct={(rec) => setSelectedForProposal(rec)}
          />

          <div className="mt-3">
            <AgentBuyabilityVerdict recommendations={response.recommendations} />
          </div>
        </PipelineStep>
      ) : null}

      <div className="pl-9">
        <AgentTracePanel trace={response.trace} traceId={response.traceId} />
      </div>

      {selectedForProposal && (
        <PaymentProposalModal
          recommendation={selectedForProposal}
          buyerBudgetMinor={response.intent?.budget?.maxMinor ?? undefined}
          onClose={() => setSelectedForProposal(null)}
        />
      )}
    </div>
  );
}
