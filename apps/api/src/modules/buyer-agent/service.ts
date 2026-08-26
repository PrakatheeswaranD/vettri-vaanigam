/**
 * Buyer Agent orchestrator (PART 03 §5-§6, §48-§53, §60, §65-§69).
 *
 * The one place that wires together: conversation state → intent
 * extraction → deterministic merge/clarification → catalog gateway →
 * deterministic eligibility → recommendation → grounding → authoritative
 * response. Every stage is logged (§65) and traced (§109-§110) without
 * ever persisting chain-of-thought (§27).
 */
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { BuyerAgentResponseDTO, BuyerConversationDTO, BuyerIntentDTO } from "@razorgrowth/contracts";
import { mergeIntentSignal, needsClarification, type BuyerIntent } from "@razorgrowth/domain";
import { AppError } from "../../http/errors.js";
import { formatMoney } from "../../lib/format.js";
import { logger } from "../../observability/logger.js";
import type { AIProvider } from "../agents/ai-provider.js";
import { getAIProvider } from "../agents/provider-factory.js";
import { appendLedgerEvent } from "../audit/ledger.js";
import { extractAndNormalizeIntent } from "./intent-extraction.js";
import { getKnownCategories, searchCandidateProducts } from "./catalog-gateway.js";
import { evaluateCandidates } from "./candidate-evaluation.js";
import { buildRecommendations, type RecommendationOutcome } from "./recommendation-service.js";
import { toDomainIntent, toIntentDTO } from "./intent-mapper.js";
import { toBuyerConversationDTO } from "./conversation-mapper.js";
import {
  appendMessage,
  createConversation,
  createRecommendationRecord,
  findConversation,
  resetConversation,
  updateConversationState,
} from "./conversation-repository.js";

const CLARIFICATION_QUESTION = "What type of product are you looking for? For example: running shoes, sportswear, or hydration gear.";

function buildAppliedConstraints(intent: BuyerIntent): string[] {
  const constraints: string[] = [];
  if (intent.category) constraints.push(`category = ${intent.category}`);
  if (intent.budget.maxMinor !== null) constraints.push(`budget ≤ ${formatMoney(intent.budget.maxMinor, intent.budget.currency)}`);
  if (intent.budget.minMinor !== null) constraints.push(`budget ≥ ${formatMoney(intent.budget.minMinor, intent.budget.currency)}`);
  for (const [key, value] of Object.entries(intent.requiredAttributes)) constraints.push(`${key} = ${value}`);
  for (const [key, values] of Object.entries(intent.excludedAttributes)) constraints.push(`${key} ≠ ${values.join(", ")}`);
  if (intent.availabilityRequirement === "PURCHASABLE_ONLY") constraints.push("must be purchasable now");
  return constraints;
}

function outcomeToStatus(outcome: RecommendationOutcome): BuyerAgentResponseDTO["status"] {
  if (outcome.mode === "NO_MATCH" || outcome.mode === "NEAR_MATCH") return "NO_EXACT_MATCH";
  return "RECOMMENDATIONS_READY";
}

function renderAgentMessage(status: BuyerAgentResponseDTO["status"], outcome: RecommendationOutcome | null): string {
  if (status === "NO_RESULTS") return "I couldn't find anything in the catalog matching that request. Could you try a different category?";
  if (status === "NO_EXACT_MATCH" && outcome && outcome.recommendations.length > 0) {
    return `No exact match was found for every requirement, but I found ${outcome.recommendations.length} close alternative${outcome.recommendations.length > 1 ? "s" : ""} — see the details below.`;
  }
  if (status === "NO_EXACT_MATCH") return "I couldn't find any close alternatives for that request either.";
  return `I found ${outcome?.recommendations.length ?? 0} product${(outcome?.recommendations.length ?? 0) === 1 ? "" : "s"} that match your request.`;
}

async function recordLedgerEvent(
  prisma: PrismaClient,
  params: {
    merchantId: string;
    workflowId: string;
    actionType: string;
    conciseReason: string;
    relatedEntityType?: string;
    relatedEntityId?: string;
  },
): Promise<void> {
  await appendLedgerEvent(prisma, {
    workflowId: params.workflowId,
    merchantId: params.merchantId,
    actorType: "BUYER_AGENT",
    actionType: params.actionType,
    conciseReason: params.conciseReason,
    relatedEntityType: params.relatedEntityType ?? null,
    relatedEntityId: params.relatedEntityId ?? null,
  });
}

export interface HandleBuyerMessageParams {
  merchantId: string;
  conversationId?: string;
  message: string;
}

/**
 * `providerOverride` exists purely for tests (PART 03 §92, §102-§104) —
 * grounding/injection/failure scenarios need a scripted provider double.
 * Production call sites (routes.ts) never pass it, so they always get the
 * one real provider chosen at startup by `getAIProvider`.
 */
export async function handleBuyerMessage(
  prisma: PrismaClient,
  params: HandleBuyerMessageParams,
  providerOverride?: AIProvider,
): Promise<BuyerAgentResponseDTO> {
  const traceId = randomUUID();
  const trace: { stage: string; detail: string }[] = [];
  const provider = providerOverride ?? getAIProvider();

  let conversationRow = params.conversationId
    ? await findConversation(prisma, params.merchantId, params.conversationId)
    : null;
  if (!conversationRow) {
    const created = await createConversation(prisma, params.merchantId);
    conversationRow = { ...created, messages: [] };
  }
  const conversationId = conversationRow.id;

  const userMessage = await appendMessage(prisma, conversationId, "BUYER", params.message);
  logger.info({ event: "buyer_agent.request_received", conversationId, traceId }, "Buyer Agent request received");

  const knownCategories = await getKnownCategories(prisma, params.merchantId);
  const priorIntent = toDomainIntent((conversationRow.currentIntent as unknown as BuyerIntentDTO | null) ?? null);

  const extraction = await extractAndNormalizeIntent(provider, params.message, knownCategories);

  if (!extraction.ok) {
    logger.warn({ event: "buyer_agent.intent_extraction_unavailable", conversationId, traceId, errorCode: extraction.errorCode }, "Intent extraction unavailable");
    const message = "I'm having trouble understanding shopping requests right now — please try again shortly.";
    await appendMessage(prisma, conversationId, "AGENT", message);
    return {
      conversationId,
      messageId: userMessage.id,
      status: "AI_UNAVAILABLE",
      intent: null,
      recommendations: [],
      recommendationMode: null,
      recommendationId: null,
      clarification: null,
      appliedConstraints: [],
      candidateCount: 0,
      aiProviderMode: provider.mode,
      dataFreshness: new Date().toISOString(),
      traceId,
      trace: [...trace, { stage: "AI_UNAVAILABLE", detail: extraction.errorCode }],
    };
  }

  trace.push({ stage: "INTENT_EXTRACTED", detail: `category=${extraction.result.signal.category ?? "unknown"} (${provider.mode})` });
  logger.info({ event: "buyer_agent.intent_extracted", conversationId, traceId, aiProviderMode: provider.mode }, "Buyer intent extracted");

  const mergedIntent = mergeIntentSignal(priorIntent, extraction.result.signal);
  const intentDTO = toIntentDTO(mergedIntent, params.message, extraction.result.confidence);

  if (needsClarification(mergedIntent)) {
    await updateConversationState(prisma, conversationId, { status: "AWAITING_CLARIFICATION", currentIntent: intentDTO });
    await appendMessage(prisma, conversationId, "AGENT", CLARIFICATION_QUESTION);
    trace.push({ stage: "CLARIFICATION_REQUIRED", detail: "category and required attributes both unknown" });
    logger.info({ event: "buyer_agent.clarification_required", conversationId, traceId }, "Clarification required");

    return {
      conversationId,
      messageId: userMessage.id,
      status: "CLARIFICATION_REQUIRED",
      intent: intentDTO,
      recommendations: [],
      recommendationMode: null,
      recommendationId: null,
      clarification: { required: true, reasonCode: "MISSING_CATEGORY", question: CLARIFICATION_QUESTION },
      appliedConstraints: buildAppliedConstraints(mergedIntent),
      candidateCount: 0,
      aiProviderMode: provider.mode,
      dataFreshness: new Date().toISOString(),
      traceId,
      trace,
    };
  }

  const products = await searchCandidateProducts(prisma, params.merchantId, {
    category: mergedIntent.category,
  });
  trace.push({ stage: "CATALOG_FILTERED", detail: `${products.length} candidate(s) from deterministic category/price filter` });
  logger.info({ event: "buyer_agent.catalog_searched", conversationId, traceId, candidateCount: products.length }, "Catalog searched");

  await recordLedgerEvent(prisma, {
    merchantId: params.merchantId,
    workflowId: traceId,
    actionType: "BUYER_INTENT_EXTRACTED",
    conciseReason: `Extracted intent from buyer message via ${provider.mode}: ${buildAppliedConstraints(mergedIntent).join("; ") || "no hard constraints"}.`,
    relatedEntityType: "BuyerConversation",
    relatedEntityId: conversationId,
  });

  if (products.length === 0) {
    await updateConversationState(prisma, conversationId, { status: "ACTIVE", currentIntent: intentDTO });
    const message = renderAgentMessage("NO_RESULTS", null);
    await appendMessage(prisma, conversationId, "AGENT", message);
    trace.push({ stage: "NO_RESULTS", detail: "deterministic filter returned zero candidates" });

    await recordLedgerEvent(prisma, {
      merchantId: params.merchantId,
      workflowId: traceId,
      actionType: "PRODUCTS_DISCOVERED",
      conciseReason: "Deterministic catalog filter returned zero candidates for the requested constraints.",
      relatedEntityType: "BuyerConversation",
      relatedEntityId: conversationId,
    });

    return {
      conversationId,
      messageId: userMessage.id,
      status: "NO_RESULTS",
      intent: intentDTO,
      recommendations: [],
      recommendationMode: null,
      recommendationId: null,
      clarification: null,
      appliedConstraints: buildAppliedConstraints(mergedIntent),
      candidateCount: 0,
      aiProviderMode: provider.mode,
      dataFreshness: new Date().toISOString(),
      traceId,
      trace,
    };
  }

  const evaluated = evaluateCandidates(products, mergedIntent);
  trace.push({ stage: "CANDIDATES_EVALUATED", detail: `${evaluated.exact.length} exact match(es), ${evaluated.nearMatch.length} near-match candidate(s)` });

  await recordLedgerEvent(prisma, {
    merchantId: params.merchantId,
    workflowId: traceId,
    actionType: "PRODUCTS_DISCOVERED",
    conciseReason: `Deterministic filter found ${evaluated.exact.length} exact and ${evaluated.nearMatch.length} near-match candidate(s) among ${products.length} catalog product(s).`,
    relatedEntityType: "BuyerConversation",
    relatedEntityId: conversationId,
  });

  const outcome = await buildRecommendations(provider, evaluated, mergedIntent);
  trace.push({ stage: "RECOMMENDATION_" + (outcome.groundingFailed ? "FALLBACK" : "GENERATED"), detail: `mode=${outcome.mode}, count=${outcome.recommendations.length}` });
  logger.info(
    { event: "buyer_agent.recommendation_generated", conversationId, traceId, mode: outcome.mode, groundingFailed: outcome.groundingFailed, count: outcome.recommendations.length },
    "Recommendation generated",
  );
  if (outcome.groundingFailed) {
    logger.warn({ event: "buyer_agent.grounding_failed", conversationId, traceId }, "AI ranking failed grounding; deterministic fallback used");
  }

  const status = outcomeToStatus(outcome);
  const newConversationStatus = status === "RECOMMENDATIONS_READY" || status === "NO_EXACT_MATCH" ? "RECOMMENDATION_READY" : "ACTIVE";
  await updateConversationState(prisma, conversationId, { status: newConversationStatus, currentIntent: intentDTO });

  const recommendationRecord = await createRecommendationRecord(prisma, {
    conversationId,
    merchantId: params.merchantId,
    intentSnapshot: intentDTO,
    candidateProductIds: outcome.candidateProductIds,
    recommendedProductIds: outcome.recommendations.map((r) => r.productId),
    mode: outcome.mode,
    aiProviderMode: provider.mode,
    traceId,
  });

  await recordLedgerEvent(prisma, {
    merchantId: params.merchantId,
    workflowId: traceId,
    actionType: "RECOMMENDATION_PROPOSED",
    conciseReason: `Proposed ${outcome.recommendations.length} recommendation(s) in ${outcome.mode} mode${outcome.groundingFailed ? " (AI ranking failed grounding, deterministic fallback used)" : ""}.`,
    relatedEntityType: "RecommendationRecord",
    relatedEntityId: recommendationRecord.id,
  });

  const agentMessage = renderAgentMessage(status, outcome);
  await appendMessage(prisma, conversationId, "AGENT", agentMessage);
  logger.info({ event: "buyer_agent.response_completed", conversationId, traceId, status }, "Buyer Agent response completed");

  return {
    conversationId,
    messageId: userMessage.id,
    status,
    intent: intentDTO,
    recommendations: outcome.recommendations,
    recommendationMode: outcome.mode,
    recommendationId: recommendationRecord.id,
    clarification: null,
    appliedConstraints: buildAppliedConstraints(mergedIntent),
    candidateCount: products.length,
    aiProviderMode: provider.mode,
    dataFreshness: new Date().toISOString(),
    traceId,
    trace,
  };
}

export async function getConversation(prisma: PrismaClient, merchantId: string, conversationId: string): Promise<BuyerConversationDTO> {
  const conversation = await findConversation(prisma, merchantId, conversationId);
  if (!conversation) {
    throw AppError.notFound(`Conversation not found: ${conversationId}`);
  }
  return toBuyerConversationDTO(conversation);
}

export async function resetBuyerConversation(prisma: PrismaClient, merchantId: string, conversationId: string): Promise<void> {
  const didReset = await resetConversation(prisma, merchantId, conversationId);
  if (!didReset) {
    throw AppError.notFound(`Conversation not found: ${conversationId}`);
  }
}
