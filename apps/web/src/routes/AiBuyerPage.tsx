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
import { PageHeader } from "../components/layout/PageHeader";
import { Card, CardBody } from "../components/ui/Card";
import { StarterQueries } from "../components/buyer-agent/StarterQueries";
import { AgentBubble, BuyerBubble, ErrorBubble, TypingBubble } from "../components/buyer-agent/ChatTurn";
import { RawResponseToggle } from "../components/buyer-agent/RawResponseToggle";
import { useBuyerViewMode } from "../lib/buyer-view-mode";
import { BuyerReasoningPipeline } from "../components/buyer-agent/BuyerReasoningPipeline";
import { AgentTurnResult } from "../components/buyer-agent/AgentTurnResult";
import { useResetBuyerConversation, useSendBuyerMessage } from "../hooks/use-buyer-agent";
import { ApiError } from "../lib/api-client";
import { SpendingEnvelopeStrip } from "../components/buyer-agent/SpendingEnvelopeStrip";
import { CustomerProposalsSection } from "./CustomerHistoryPage";

const CAPABILITIES = [
  { icon: MessageSquare, title: "Describe the outcome", description: "Say what you need in normal language. The agent turns budget, use, preferences, and must-haves into reviewable constraints." },
  { icon: Search, title: "Then keep talking", description: "“Show cheaper ones.” “Compare these.” “I prefer waterproof.” Follow-ups refine the search you already started rather than beginning a new one." },
  { icon: ShoppingCart, title: "Buy without leaving the chat", description: "Say “buy the second one” and the agent prices it from the catalogue and puts it to your spending policy. Nothing is charged until you authorize it." },
];

const PROVIDER_MODE_LABEL: Record<BuyerAgentResponseDTO["aiProviderMode"], string> = {
  LIVE_ANTHROPIC: "Live Anthropic model",
  LIVE_GEMINI: "Live Gemini model",
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
        The extraction pipeline could not process that request right now. Please try again in a moment.
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
  // Part 9 — these four statuses never carry `recommendations`, so falling
  // through to the default banner below would say "Found 0 products that
  // match your request" on a COMPARE or BUY turn. The actual result
  // renders separately via `AgentTurnResult`; this banner only needs to
  // say what KIND of turn this was.
  if (response.status === "COMPARISON_READY") {
    return (
      <div className="rounded-card bg-success-subtle px-4 py-3 text-sm text-success-text">
        Compared {response.comparison?.productIds.length ?? 0} products on catalogue facts — see the table below.
      </div>
    );
  }
  if (response.status === "PURCHASE_PROPOSED") {
    return (
      <div className="rounded-card bg-success-subtle px-4 py-3 text-sm text-success-text">
        Priced and proposed to your spending policy. Nothing has been charged.
      </div>
    );
  }
  if (response.status === "PURCHASE_DECLINED") {
    return (
      <div className="flex items-start gap-2 rounded-card bg-danger-subtle px-4 py-3 text-sm text-danger-text">
        <AlertTriangle size={16} className="mt-0.5 shrink-0" />
        Your spending policy declined this purchase.
      </div>
    );
  }
  if (response.status === "ACTION_UNRESOLVED") {
    return (
      <div className="flex items-start gap-2 rounded-card bg-info-subtle px-4 py-3 text-sm text-info-text">
        <HelpCircle size={16} className="mt-0.5 shrink-0" />
        {response.unresolvedReason ?? "Could you say which one you mean?"}
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
  const [viewMode, setViewMode] = useBuyerViewMode();
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
          message: err instanceof ApiError ? err.message : "Something went wrong reaching the extraction pipeline.",
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
          <PageHeader
            title={"AI Buyer Agent"}
            lead={"Describe the outcome you want. Your agent clarifies, compares grounded options, and proposes a purchase inside your spending policy."}
          />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* The toggle is part of the pitch, not a settings checkbox:
              switching to the trace mid-demo IS the demonstration. */}
          <div className="inline-flex rounded-md border border-border bg-surface p-0.5" role="tablist" aria-label="Buyer agent view">
            {([
              ["buyer", "Buyer view"],
              ["trace", "Agent trace"],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={viewMode === value}
                onClick={() => setViewMode(value)}
                className={
                  "rounded px-3 py-1.5 text-sm font-medium transition-colors " +
                  (viewMode === value ? "bg-brand-600 text-white" : "text-ink-muted hover:text-ink")
                }
              >
                {label}
              </button>
            ))}
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
      </div>

      {/* What the agent may spend, next to the box you type into. This was
          a separate "Home" screen whose other three cards only restated
          the navigation; the envelope is the part that changes what you
          can ask for, so it sits with the asking. */}
      <SpendingEnvelopeStrip />

      {turns.length === 0 ? (
        <>
          <Card className="border-brand-200/80 bg-gradient-to-br from-brand-50/60 to-surface">
            <CardBody className="flex flex-col items-center gap-3 py-10 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-600 text-white shadow-md">
                <Bot size={28} />
              </div>
              <h2 className="text-xl font-bold tracking-tight text-ink">What should your Buyer Agent solve for?</h2>
              <p className="max-w-lg text-sm text-ink-muted leading-relaxed">
                Recommendations are grounded in structured price, inventory, variant, and policy data from the
                Agent-Readable Catalog. The model interprets your language; deterministic filters, your spending policy,
                and explicit authorization keep the recommendation and purchase bounded.
              </p>
              {/* Follow-ups shown here too: a buyer reading the empty
                  state is exactly who needs to learn the vocabulary,
                  and one who never learns it keeps operating the site
                  by hand. */}
              <StarterQueries onSelect={handleSend} showFollowUps />
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
        <div className={viewMode === "buyer" ? "space-y-4" : "space-y-6"}>
          {turns.map((turn, i) => {
            const precedingMessage =
              i > 0 && turns[i - 1]!.role === "BUYER" ? (turns[i - 1] as { content: string }).content : "";

            // ── Simple mode: a conversation ──────────────────────────────
            if (viewMode === "buyer") {
              if (turn.role === "BUYER") return <BuyerBubble key={turn.id} message={turn.content} />;
              if (turn.role === "AGENT_ERROR") return <ErrorBubble key={turn.id} message={turn.message} />;
              return <AgentBubble key={turn.id} buyerMessage={precedingMessage} response={turn.response} />;
            }

            // ── Trace mode: the audit view, unchanged ────────────────────
            if (turn.role === "BUYER") return null; // rendered as step 1 inside the following pipeline

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
                {/* The reasoning pipeline explains a SEARCH. A comparison,
                    an offer or a purchase proposal is what the agent
                    produced when asked to DO something, and renders in
                    its own right. */}
                <BuyerReasoningPipeline buyerMessage={precedingMessage} response={response} />
                <AgentTurnResult response={response} />
                <div className="flex flex-wrap items-center gap-2 pl-1 text-xs text-ink-faint">
                  <span className="rounded-full bg-surface-sunken px-2 py-0.5">{PROVIDER_MODE_LABEL[response.aiProviderMode]}</span>
                  {response.recommendationMode ? (
                    <span className="rounded-full bg-surface-sunken px-2 py-0.5">{RECOMMENDATION_MODE_LABEL[response.recommendationMode]}</span>
                  ) : null}
                  <span>{response.candidateCount} candidate{response.candidateCount === 1 ? "" : "s"} considered</span>
                </div>
                <RawResponseToggle response={response} />
              </div>
            );
          })}

          {sendMessage.isPending && viewMode === "buyer" ? <TypingBubble /> : null}
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
          Ask what an agent would understand
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

      {/* Baskets this agent prepared and nobody has authorized yet. This
          was "Cart & Offers", its own nav destination — but a proposal is
          the output of the conversation above it, not somewhere a shopper
          navigates to, and splitting the two meant authorizing a purchase
          happened on a different screen from asking for it. */}
      <CustomerProposalsSection />
    </div>
  );
}
