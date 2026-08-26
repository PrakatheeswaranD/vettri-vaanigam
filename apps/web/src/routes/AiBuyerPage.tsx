/**
 * PART 03 §70-§84 — the Buyer Agent's primary experience: a real
 * conversational pipeline (natural language → structured intent →
 * deterministic catalog constraints → grounded recommendation), never a
 * generic chatbot and never hardcoded responses. Every recommendation
 * card renders authoritative catalog data; every interpreted-intent chip
 * comes from the validated, normalized `BuyerIntent` the server returns.
 */
import { useState } from "react";
import { Bot, Send, RotateCcw, Search, ShoppingCart, MessageSquare, AlertTriangle, HelpCircle } from "lucide-react";
import type { BuyerAgentResponseDTO } from "@razorgrowth/contracts";
import { Card, CardBody } from "../components/ui/Card";
import { RecommendationCard } from "../components/buyer-agent/RecommendationCard";
import { IntentPanel } from "../components/buyer-agent/IntentPanel";
import { AgentTracePanel } from "../components/buyer-agent/AgentTracePanel";
import { StarterQueries } from "../components/buyer-agent/StarterQueries";
import { RecoveryOfferPrompt } from "../components/buyer-agent/RecoveryOfferPrompt";
import { useResetBuyerConversation, useSendBuyerMessage } from "../hooks/use-buyer-agent";
import { ApiError } from "../lib/api-client";

const CAPABILITIES = [
  { icon: MessageSquare, title: "Understand purchase intent", description: "Parses a natural-language request into structured, required-vs-preferred constraints." },
  { icon: Search, title: "Discover products", description: "Queries the agent-readable catalog and applies hard constraints deterministically, in code." },
  { icon: ShoppingCart, title: "Recommend, honestly", description: "Recommends only real catalog products, and says so plainly when nothing matches exactly." },
];

const PROVIDER_MODE_LABEL: Record<BuyerAgentResponseDTO["aiProviderMode"], string> = {
  LIVE_ANTHROPIC: "Live Anthropic model",
  DEMO_RULE_BASED: "Demo rule-based extractor (no AI provider configured)",
  DISABLED: "AI provider disabled",
};

const RECOMMENDATION_MODE_LABEL: Record<NonNullable<BuyerAgentResponseDTO["recommendationMode"]>, string> = {
  AI_RANKED: "Ranked by AI model",
  DETERMINISTIC_SINGLE_MATCH: "Single exact match — no ranking needed",
  DETERMINISTIC_FALLBACK: "Deterministic fallback ranking",
  NEAR_MATCH: "Deterministic near-match ordering",
  NO_MATCH: "No candidates found",
};

type Turn =
  | { id: string; role: "BUYER"; content: string }
  | { id: string; role: "AGENT"; response: BuyerAgentResponseDTO }
  | { id: string; role: "AGENT_ERROR"; message: string };

function AgentStatusMessage({ response }: { response: BuyerAgentResponseDTO }) {
  if (response.status === "CLARIFICATION_REQUIRED" && response.clarification) {
    return (
      <div className="flex items-start gap-2 rounded-card bg-info-subtle px-4 py-3 text-sm text-info-text">
        <HelpCircle size={16} className="mt-0.5 shrink-0" />
        {response.clarification.question}
      </div>
    );
  }
  if (response.status === "AI_UNAVAILABLE" || response.status === "FAILED") {
    return (
      <div className="flex items-start gap-2 rounded-card bg-danger-subtle px-4 py-3 text-sm text-danger-text">
        <AlertTriangle size={16} className="mt-0.5 shrink-0" />
        The Buyer Agent couldn't process that request right now. Please try again in a moment.
      </div>
    );
  }
  if (response.status === "NO_RESULTS") {
    return (
      <div className="rounded-card bg-surface-subtle px-4 py-3 text-sm text-ink-muted">
        We couldn't find anything in the catalog matching that request. Try a different category or constraint.
      </div>
    );
  }
  if (response.status === "NO_EXACT_MATCH") {
    return (
      <div className="rounded-card bg-warning-subtle px-4 py-3 text-sm text-warning-text">
        {response.recommendations.length > 0
          ? `No exact match was found for every requirement, but here ${response.recommendations.length === 1 ? "is" : "are"} ${response.recommendations.length} close alternative${response.recommendations.length === 1 ? "" : "s"}.`
          : "No exact match, and no close alternative either — every option violates a required specification."}
      </div>
    );
  }
  return (
    <div className="rounded-card bg-success-subtle px-4 py-3 text-sm text-success-text">
      Found {response.recommendations.length} product{response.recommendations.length === 1 ? "" : "s"} that{" "}
      {response.recommendations.length === 1 ? "matches" : "match"} your request.
    </div>
  );
}

export default function AiBuyerPage() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [inputValue, setInputValue] = useState("");
  const sendMessage = useSendBuyerMessage();
  const resetConversation = useResetBuyerConversation();

  async function handleSend(message: string) {
    const trimmed = message.trim();
    if (!trimmed || sendMessage.isPending) return;

    setTurns((t) => [...t, { id: crypto.randomUUID(), role: "BUYER", content: trimmed }]);
    setInputValue("");

    try {
      const response = await sendMessage.mutateAsync({ conversationId, message: trimmed });
      setConversationId(response.conversationId);
      setTurns((t) => [...t, { id: response.messageId, role: "AGENT", response }]);
    } catch (err) {
      setTurns((t) => [
        ...t,
        {
          id: crypto.randomUUID(),
          role: "AGENT_ERROR",
          message: err instanceof ApiError ? err.message : "Something went wrong reaching the Buyer Agent.",
        },
      ]);
    }
  }

  async function handleReset() {
    if (conversationId) {
      await resetConversation.mutateAsync(conversationId).catch(() => undefined);
    }
    setTurns([]);
    setConversationId(undefined);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold text-ink">AI Buyer</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-muted">
            Shop with an AI buyer that understands your constraints and only recommends real merchant products.
          </p>
        </div>
        {turns.length > 0 ? (
          <button
            type="button"
            onClick={handleReset}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-ink hover:bg-surface-subtle"
          >
            <RotateCcw size={14} />
            New search
          </button>
        ) : null}
      </div>

      {turns.length === 0 ? (
        <>
          <Card>
            <CardBody className="flex flex-col items-center gap-3 py-10 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600">
                <Bot size={22} />
              </div>
              <p className="text-base font-semibold text-ink">Try a real shopping request</p>
              <p className="max-w-md text-sm text-ink-muted">
                Recommendations are grounded in structured price, inventory, variant, and policy data from the
                Agent-Readable Catalog — the AI interprets your language, but never invents a product, price, or
                availability.
              </p>
              <StarterQueries onSelect={handleSend} />
            </CardBody>
          </Card>

          <div className="grid gap-4 sm:grid-cols-3">
            {CAPABILITIES.map((cap) => (
              <Card key={cap.title}>
                <CardBody className="flex gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-surface-sunken text-ink-muted">
                    <cap.icon size={16} />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-ink">{cap.title}</p>
                    <p className="mt-0.5 text-sm text-ink-muted">{cap.description}</p>
                  </div>
                </CardBody>
              </Card>
            ))}
          </div>
        </>
      ) : (
        <div className="space-y-4">
          {turns.map((turn) => {
            if (turn.role === "BUYER") {
              return (
                <div key={turn.id} className="flex justify-end">
                  <div className="max-w-lg rounded-card bg-brand-600 px-4 py-2.5 text-sm text-white">{turn.content}</div>
                </div>
              );
            }
            if (turn.role === "AGENT_ERROR") {
              return (
                <div key={turn.id} className="flex items-start gap-2 rounded-card bg-danger-subtle px-4 py-3 text-sm text-danger-text">
                  <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                  {turn.message}
                </div>
              );
            }

            const { response } = turn;
            return (
              <div key={turn.id} className="space-y-3">
                <AgentStatusMessage response={response} />

                {response.intent ? (
                  <Card>
                    <CardBody>
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">Interpreted intent</p>
                      <IntentPanel intent={response.intent} />
                    </CardBody>
                  </Card>
                ) : null}

                {response.recommendations.length > 0 ? (
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {response.recommendations.map((rec) => (
                      <RecommendationCard key={rec.productId} recommendation={rec} />
                    ))}
                  </div>
                ) : null}

                {response.recommendationMode === "NEAR_MATCH" && response.recommendationId ? (
                  <RecoveryOfferPrompt
                    conversationId={response.conversationId}
                    recommendationId={response.recommendationId}
                    primaryProductId={response.recommendations[0]!.productId}
                  />
                ) : null}

                <div className="flex flex-wrap items-center gap-2 text-xs text-ink-faint">
                  <span className="rounded-full bg-surface-sunken px-2 py-0.5">{PROVIDER_MODE_LABEL[response.aiProviderMode]}</span>
                  {response.recommendationMode ? (
                    <span className="rounded-full bg-surface-sunken px-2 py-0.5">{RECOMMENDATION_MODE_LABEL[response.recommendationMode]}</span>
                  ) : null}
                  <span>{response.candidateCount} candidate{response.candidateCount === 1 ? "" : "s"} considered</span>
                </div>

                <AgentTracePanel trace={response.trace} traceId={response.traceId} />
              </div>
            );
          })}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void handleSend(inputValue);
        }}
        className="sticky bottom-0 flex items-center gap-2 rounded-card border border-border bg-surface p-2 shadow-popover"
      >
        <label htmlFor="buyer-agent-message" className="sr-only">
          Message the Buyer Agent
        </label>
        <input
          id="buyer-agent-message"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder="e.g. Find black running shoes in size 9 under ₹6,000"
          maxLength={500}
          disabled={sendMessage.isPending}
          className="flex-1 rounded-md border-none bg-transparent px-2 py-2 text-sm text-ink placeholder:text-ink-faint focus:outline-none disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={sendMessage.isPending || !inputValue.trim()}
          className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Send size={14} />
          {sendMessage.isPending ? "Thinking…" : "Send"}
        </button>
      </form>
    </div>
  );
}
