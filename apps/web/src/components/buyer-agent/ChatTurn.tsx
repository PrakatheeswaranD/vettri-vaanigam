/**
 * Simple mode — the shopping-assistant face of the Buyer Agent.
 *
 * The server returns the same `BuyerAgentResponseDTO` either way. The
 * difference is that this NARRATES it instead of displaying it: one natural
 * sentence, then the products, the way a shopping assistant on a retail
 * site would. Nothing about providers, candidate counts or pipelines
 * appears — not because it is hidden, but because it belongs in the trace
 * view, one click away, for the people who want it.
 *
 * The fallback copy is deliberately warm and specific. "The extraction
 * pipeline could not process that request" is accurate and useless to a
 * shopper; telling them what to try instead is the same honesty aimed at
 * someone who just wants shoes.
 */
import { useState } from "react";
import { Bot, ChevronDown, ChevronRight } from "lucide-react";
import type { BuyerAgentResponseDTO } from "@razorgrowth/contracts";
import { RecommendationCard } from "./RecommendationCard";
import { BuyerReasoningPipeline } from "./BuyerReasoningPipeline";
import { AgentTurnResult } from "./AgentTurnResult";

/**
 * One sentence a person would actually say.
 *
 * Four cases were missing here — COMPARISON_READY, PURCHASE_PROPOSED,
 * PURCHASE_DECLINED, ACTION_UNRESOLVED — which meant every one of them
 * fell through to `default` and narrated by `response.recommendations
 * .length`. That array is always empty on these turns, so a buyer who
 * said "buy it" was told **"Found 0 that fit."** — the exact turn Part 9
 * exists to support, silently broken in the view real buyers actually
 * see. The trace view had full support the whole time; nobody looks at
 * the trace view by default.
 */
function narrate(response: BuyerAgentResponseDTO): string {
  const count = response.recommendations.length;

  switch (response.status) {
    case "CLARIFICATION_REQUIRED":
      return response.clarification?.question ?? "Could you tell me a little more about what you're after?";
    case "AI_UNAVAILABLE":
    case "FAILED":
      return "Sorry — I couldn't work that one out just now. Give it another go in a moment?";
    case "NO_RESULTS":
      return "I couldn't find anything matching that in the catalogue — want to try a different size or category?";
    case "NO_EXACT_MATCH":
      return count > 0
        ? `Nothing matched every detail, but ${count === 1 ? "here's one that's close" : `here are ${count} that come close`}.`
        : "Nothing came close enough on that one — shall we relax the budget or the size?";
    case "COMPARISON_READY":
      return "Here they are side by side.";
    case "PURCHASE_PROPOSED":
      return response.purchase?.requiresAuthorization
        ? "Priced it up — nothing's been charged yet, this just needs your go-ahead."
        : "Priced it up and it's within your own limits. Nothing's charged until you authorize it.";
    case "PURCHASE_DECLINED":
      return "Your spending policy said no to that one.";
    case "ACTION_UNRESOLVED":
      // Server-composed, the same way `clarification.question` already is
      // — the client cannot reconstruct WHY a buy or compare was
      // ambiguous (wrong ordinal? nothing on the table? too few to
      // compare?) from `status` alone, so it is not asked to.
      return response.unresolvedReason ?? "Could you say which one you mean?";
    default:
      return count === 1 ? "Found one that fits." : `Found ${count} that fit.`;
  }
}

export function BuyerBubble({ message }: { message: string }) {
  return (
    <div className="flex justify-end">
      <p className="max-w-[80%] rounded-2xl rounded-br-sm bg-brand-600 px-4 py-2.5 text-sm leading-relaxed text-white">
        {message}
      </p>
    </div>
  );
}

export function TypingBubble() {
  return (
    <div className="flex items-end gap-2">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700">
        <Bot size={14} />
      </span>
      <p className="rounded-2xl rounded-bl-sm bg-surface-sunken px-4 py-2.5 text-sm text-ink-muted">
        <span className="animate-pulse-soft">Thinking…</span>
      </p>
    </div>
  );
}

export function ErrorBubble({ message }: { message: string }) {
  return (
    <div className="flex items-end gap-2">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-danger-subtle text-danger-text">
        <Bot size={14} />
      </span>
      <p className="max-w-[80%] rounded-2xl rounded-bl-sm bg-danger-subtle px-4 py-2.5 text-sm leading-relaxed text-danger-text">
        {message}
      </p>
    </div>
  );
}

export function AgentBubble({
  buyerMessage,
  response,
}: {
  buyerMessage: string;
  response: BuyerAgentResponseDTO;
}) {
  const [showReasoning, setShowReasoning] = useState(false);
  const products = response.recommendations;

  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700">
        <Bot size={14} />
      </span>

      <div className="min-w-0 flex-1 space-y-2">
        <p className="inline-block max-w-[85%] rounded-2xl rounded-bl-sm bg-surface-sunken px-4 py-2.5 text-sm leading-relaxed text-ink">
          {narrate(response)}
        </p>

        {products.length > 0 ? (
          // A carousel rather than a grid: in a chat the products belong to
          // one turn, and a grid makes each turn taller than the viewport.
          <div className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2">
            {products.map((rec) => (
              <div key={rec.productId} className="w-64 shrink-0 snap-start">
                <RecommendationCard recommendation={rec} />
              </div>
            ))}
          </div>
        ) : null}

        {/* The comparison table, the merchant's authorized offers, and the
            priced purchase card — the same component the trace view uses,
            so a buyer who never opens the trace still sees exactly what
            the agent actually did on a COMPARE or BUY turn, not just a
            narrated sentence about it. */}
        <AgentTurnResult response={response} />

        {/* The bridge to the trace view, per turn and inline — never a
            navigation that would lose the conversation. */}
        <button
          type="button"
          onClick={() => setShowReasoning((v) => !v)}
          className="inline-flex items-center gap-1 text-micro font-medium text-ink-faint transition-colors hover:text-ink"
        >
          {showReasoning ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          {showReasoning ? "Hide how this was worked out" : "See how this was worked out"}
        </button>

        {showReasoning ? (
          <div className="animate-fade-up">
            <BuyerReasoningPipeline buyerMessage={buyerMessage} response={response} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
