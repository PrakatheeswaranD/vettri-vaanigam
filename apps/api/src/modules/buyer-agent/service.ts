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
import { classifyBuyerTurn } from "@razorgrowth/domain";
import { findBuyerVisibleOffers } from "./offers-service.js";
import { buildComparison, loadConversationCandidates, resolveBuyTarget, toPurchaseOutcome } from "./turn-actions.js";
import { authorizePurchaseProposal, createPurchaseProposal } from "../buyer-policy/purchase-proposal-service.js";
import { findPendingProposal, setPendingProposal, toCheckoutState } from "./checkout-state.js";
import { CUSTOMER_AGENT_ID } from "../buyer-policy/negotiation-service.js";
import type { AIProvider } from "../agents/ai-provider.js";
import { getAIProvider } from "../agents/provider-factory.js";
import { createDemoRuleBasedProvider } from "../agents/providers/demo-rule-based-provider.js";
import { appendLedgerEvent } from "../audit/ledger.js";
import { discoverMarketplace } from "../marketplace/service.js";
import { extractAndNormalizeIntent } from "./intent-extraction.js";
import { CATALOG_SEARCH_LIMIT, getKnownCategories, getMarketplaceCategories, getKnownAttributes, searchCandidateProducts } from "./catalog-gateway.js";
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
  /**
   * The SHOPPER, and the owner of the conversation.
   *
   * This was one field with `merchantId` below, and it did two jobs: it
   * owned the conversation AND scoped the catalogue. That only worked
   * because a shopper was filed under a synthetic merchant, so the same
   * id was a legal value for both. It is not one field any more, and the
   * foreign key on `BuyerConversation` now refuses to let it become one
   * again.
   */
  customerAccountId: string;
  /**
   * The merchant context this exchange is recorded under: the catalogue a
   * non-marketplace search is scoped to, and the tenant the ledger events
   * are written against. In marketplace mode the search spans every
   * active merchant and this is the buyer's own identity context — the
   * ledger is merchant-scoped by design and a marketplace conversation
   * has no single seller to attribute to.
   */
  merchantId: string;
  conversationId?: string;
  message: string;
  marketplace?: boolean;
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
  let provider = providerOverride ?? getAIProvider();

  let conversationRow = params.conversationId
    ? await findConversation(prisma, params.customerAccountId, params.conversationId)
    : null;
  if (!conversationRow) {
    const created = await createConversation(prisma, params.customerAccountId);
    conversationRow = { ...created, messages: [] };
  }
  const conversationId = conversationRow.id;
  /**
   * The workflow every ledger write on this turn goes into.
   *
   * PART 13 — this used to be `traceId`, which is minted per REQUEST. A
   * buyer who searched in one turn and bought two turns later therefore
   * wrote three unrelated hash chains, and their own activity page showed
   * one journey as three disconnected cards. The pipeline this product
   * promises spans turns by definition, so the workflow has to belong to
   * the conversation rather than to the request that happens to be in
   * flight.
   *
   * `traceId` is unchanged and still per-turn — it correlates logs and
   * the response with one request, which is a different job it was only
   * doing this one by accident. Falls back to `traceId` for conversations
   * created before the column existed, so nothing already recorded is
   * re-parented.
   */
  const workflowId = conversationRow.workflowId ?? traceId;

  const userMessage = await appendMessage(prisma, conversationId, "BUYER", params.message);
  logger.info({ event: "buyer_agent.request_received", conversationId, traceId }, "Buyer Agent request received");

  // VOCABULARY IS NOT THE COMPARISON WINDOW.
  //
  // This used to build the marketplace vocabulary from `discoverMarketplace`,
  // which deliberately keeps at most FIVE merchants — a sensible bound on
  // what a shopper compares, and the wrong basis for "which category names
  // are legal". Merchants come back ordered by name, so the fixture sellers
  // ("00 Buyer Agent Seller A/B", "Apex Athletics", "ByteStore",
  // "ElectroHub") filled the window and pushed Meridian Athletics — the
  // demo catalogue — out of it. The vocabulary then offered `Shoes` but
  // never `Running Shoes`, so "running shoes for daily road running"
  // normalized to NO category, `needsClarification` fired, and the agent
  // asked what the shopper was looking for however plainly they answered.
  // The customer journey could not reach a product at all.
  //
  // A category the shopper can buy must be nameable even when its seller
  // sorts sixth, so the vocabulary spans every active merchant. Narrowing
  // to five still happens where it belongs — on the search below, after a
  // category is known.
  const [knownCategories, knownAttributes] = params.marketplace
    ? await Promise.all([getMarketplaceCategories(prisma), getKnownAttributes(prisma, null)])
    : await Promise.all([getKnownCategories(prisma, params.merchantId), getKnownAttributes(prisma, params.merchantId)]);
  /**
   * WHAT DID THE BUYER JUST ASK FOR?
   *
   * Deterministic, never a model call — see `classifyBuyerTurn`. Deciding
   * whether a message can move money is not an understanding, and a model
   * that could be talked into reading "show me cheaper ones" as BUY would
   * be a prompt-injection surface wired to a payment path.
   *
   * `hasContext` is whether anything is on the table. A purchase phrase
   * with nothing recommended is a search, not an error.
   */
  const candidates = await loadConversationCandidates(prisma, conversationId);
  /**
   * A proposal this buyer priced and has not yet authorized.
   *
   * This is what makes "yes" mean something. Without a pending proposal
   * the AUTHORIZE vocabulary is not even consulted, so an ordinary "ok"
   * cannot create a payment order — see `classifyBuyerTurn`.
   */
  const pendingProposal = await findPendingProposal(prisma, params.customerAccountId, conversationId);
  const turn = classifyBuyerTurn(params.message, {
    hasCandidates: candidates.productIds.length > 0,
    hasPendingProposal: pendingProposal !== null,
  });
  if (turn.matched) {
    trace.push({ stage: "TURN_CLASSIFIED", detail: `Read as ${turn.action} from the phrase "${turn.matched}".` });
  }

  // ── AUTHORIZE ───────────────────────────────────────────────────────
  //
  // The buyer said yes to a proposal the agent priced. This calls the SAME
  // `authorizePurchaseProposal` the REST route calls — the daily-allowance
  // reservation, the re-checked spending policy, and the ambiguous-failure
  // handling are not reimplemented here, because a second implementation
  // of money-moving authorization is the one that eventually double-charges.
  //
  // What this creates is a payment ORDER, not a charge. The buyer still has
  // to complete the provider's own checkout, which returns a signature the
  // server verifies. Nothing here concludes that a purchase completed.
  if (turn.action === "AUTHORIZE" && pendingProposal) {
    try {
      const payment = await authorizePurchaseProposal(prisma, {
        buyerContext: params.customerAccountId,
        proposalId: pendingProposal.id,
        agentId: CUSTOMER_AGENT_ID,
      });
      // One yes buys one thing. Clearing this before returning means a
      // second "yes" has nothing to refer to, rather than reaching for
      // whatever else happens to be pending.
      await setPendingProposal(prisma, conversationId, null);
      const checkout = toCheckoutState(payment);
      const message =
        "Authorized. I've created the payment order — nothing is charged until you complete the payment step, and the result comes back from the provider, not from me.";
      await appendMessage(prisma, conversationId, "AGENT", message);
      trace.push({
        stage: "CHECKOUT_INITIATED",
        detail: `Payment ${checkout.paymentId} created in state ${checkout.state}. No charge has been made.`,
      });

      return {
        conversationId,
        messageId: userMessage.id,
        status: "CHECKOUT_READY" as const,
        intent: (conversationRow.currentIntent as unknown as BuyerIntentDTO | null) ?? null,
        recommendations: [],
        recommendationMode: null,
        recommendationId: candidates.recommendationId,
        clarification: null,
        appliedConstraints: [],
        candidateCount: candidates.productIds.length,
        aiProviderMode: provider.mode,
        dataFreshness: new Date().toISOString(),
        traceId,
        trace,
        turnAction: turn.action,
        offers: [],
        comparison: null,
        purchase: null,
        unresolvedReason: null,
        checkout,
      };
    } catch (error) {
      // The server's own refusal, carried verbatim. An expired proposal, a
      // policy that changed underneath it, or an exhausted daily allowance
      // are all things the buyer needs to read exactly as stated.
      const reason =
        error instanceof AppError
          ? error.message
          : "That authorization could not be completed. Nothing has been charged.";
      await appendMessage(prisma, conversationId, "AGENT", reason);
      trace.push({ stage: "AUTHORIZATION_REFUSED", detail: reason });

      return {
        conversationId,
        messageId: userMessage.id,
        status: "AUTHORIZATION_REFUSED" as const,
        intent: (conversationRow.currentIntent as unknown as BuyerIntentDTO | null) ?? null,
        recommendations: [],
        recommendationMode: null,
        recommendationId: candidates.recommendationId,
        clarification: null,
        appliedConstraints: [],
        candidateCount: candidates.productIds.length,
        aiProviderMode: provider.mode,
        dataFreshness: new Date().toISOString(),
        traceId,
        trace,
        turnAction: turn.action,
        offers: [],
        comparison: null,
        purchase: null,
        unresolvedReason: reason,
        checkout: null,
      };
    }
  }

  // ── COMPARE ─────────────────────────────────────────────────────────
  //
  // Answered entirely from catalogue rows the agent already recommended.
  // No model call, because a comparison is a table of facts — and one the
  // model wrote would be a second recommendation wearing a table's
  // clothes.
  if (turn.action === "COMPARE") {
    /**
     * WHICH ones to compare.
     *
     * "Compare 1 and 3" named two products, and this used to compare
     * whatever the first four candidates happened to be — answering a
     * question the buyer did not ask. Positions are resolved against the
     * conversation's own recommendation order, and an out-of-range
     * position is dropped rather than wrapped around, so "compare 2 and 9"
     * on a three-item list compares the second against nothing rather
     * than silently against the third.
     */
    const selected =
      turn.ordinals.length >= 2
        ? turn.ordinals
            .map((position) => candidates.productIds[position - 1])
            .filter((id): id is string => Boolean(id))
        : candidates.productIds;

    // The buyer's own stated requirements, so the table can say how each
    // product fits what they asked for rather than laying fields side by
    // side and leaving them to remember.
    const statedIntent = toDomainIntent((conversationRow.currentIntent as unknown as BuyerIntentDTO | null) ?? null);
    const comparison = await buildComparison(prisma, selected, statedIntent);
    const offers = await findBuyerVisibleOffers(prisma, selected);

    const narrowed = turn.ordinals.length >= 2 && selected.length >= 2;
    const message = comparison
      ? `Here ${narrowed ? `${comparison.productNames.join(" and ")} are` : "they are"} side by side. ${comparison.rows.filter((r) => r.differs).length} of ${comparison.rows.length} things actually differ.`
      : turn.ordinals.length >= 2
        ? "I could not find both of those in what I showed you. Say which positions you mean — for example \"compare 1 and 2\"."
        : "I need at least two options on the table to compare. Tell me what you are looking for and I will find some.";
    await appendMessage(prisma, conversationId, "AGENT", message);
    trace.push({
      stage: "COMPARISON_BUILT",
      detail: comparison
        ? `Compared ${comparison.productIds.length} product(s) the buyer named, on ${comparison.rows.length} catalogue fields.`
        : "Fewer than two comparable products.",
    });

    // A trace stage lives only in this response. The Agent Activity view
    // reads the LEDGER, so a comparison that wrote no ledger event was a
    // real action the buyer could never see afterwards.
    if (comparison) {
      await recordLedgerEvent(prisma, {
        merchantId: params.merchantId,
        workflowId,
        actionType: "COMPARISON_BUILT",
        conciseReason: `Compared ${comparison.productIds.length} products on ${comparison.rows.length} published catalogue fields; ${comparison.rows.filter((r) => r.differs).length} actually differ.`,
        relatedEntityType: "BuyerConversation",
        relatedEntityId: conversationId,
      });
    }

    return {
      conversationId,
      messageId: userMessage.id,
      status: comparison ? ("COMPARISON_READY" as const) : ("ACTION_UNRESOLVED" as const),
      intent: (conversationRow.currentIntent as unknown as BuyerIntentDTO | null) ?? null,
      recommendations: [],
      recommendationMode: null,
      recommendationId: candidates.recommendationId,
      clarification: null,
      appliedConstraints: [],
      candidateCount: candidates.productIds.length,
      aiProviderMode: provider.mode,
      dataFreshness: new Date().toISOString(),
      traceId,
      trace,
      turnAction: turn.action,
      offers,
      comparison,
      purchase: null,
      // The same sentence just persisted as the AGENT message, exposed as
      // a typed field rather than left for the client to reconstruct —
      // see the field's own doc comment for why that matters here.
      unresolvedReason: comparison ? null : message,
      checkout: null,
    };
  }

  // ── BUY ─────────────────────────────────────────────────────────────
  //
  // Resolves against what the agent ITSELF recommended, by position —
  // never a product id or name from the message, and never something the
  // model produced. Then straight into `createPurchaseProposal`, the same
  // function the REST route calls, so the buyer's spending policy decides
  // exactly as it would have. No money moves here either way.
  if (turn.action === "BUY") {
    const decisionStartedAt = performance.now();
    const target = await resolveBuyTarget(prisma, candidates.candidates, turn.ordinal);

    if (!target.resolved) {
      // Ambiguity is ASKED about, never resolved by picking the first
      // result. An agent that guesses here eventually buys the wrong
      // thing, and the buyer finds out from their bank.
      await appendMessage(prisma, conversationId, "AGENT", target.reason);
      trace.push({ stage: "PURCHASE_UNRESOLVED", detail: target.reason });
      return {
        conversationId,
        messageId: userMessage.id,
        status: "ACTION_UNRESOLVED" as const,
        intent: (conversationRow.currentIntent as unknown as BuyerIntentDTO | null) ?? null,
        recommendations: [],
        recommendationMode: null,
        recommendationId: candidates.recommendationId,
        clarification: null,
        appliedConstraints: [],
        candidateCount: candidates.productIds.length,
        aiProviderMode: provider.mode,
        dataFreshness: new Date().toISOString(),
        traceId,
        trace,
        turnAction: turn.action,
        offers: [],
        comparison: null,
        purchase: null,
        unresolvedReason: target.reason,
        checkout: null,
      };
    }

    const proposal = await createPurchaseProposal(prisma, {
      buyerContext: params.customerAccountId,
      variantId: target.variantId,
      quantity: 1,
      agentId: CUSTOMER_AGENT_ID,
      decisionLatencyMs: Math.max(0, Math.round(performance.now() - decisionStartedAt)),
      // The same workflow the search, comparison and recommendation were
      // written under. Without this the purchase started a second,
      // unrelated chain and the buyer's own journey appeared as two
      // disconnected halves with nothing joining the recommendation to
      // the charge.
      workflowId,
    });
    const purchase = toPurchaseOutcome(proposal, target.productId, target.variantId, 1);
    // Remember what was quoted, but only when it is actually authorizable.
    // A declined proposal is not something "yes" may act on.
    await setPendingProposal(prisma, conversationId, purchase.outcome === "DECLINE" ? null : proposal.id);
    const offers = await findBuyerVisibleOffers(prisma, [target.productId]);

    // The policy's own words, never a restatement — a softened decline is
    // a decline the buyer might not notice.
    const message =
      purchase.outcome === "DECLINE"
        ? `Your spending policy declined this: ${purchase.explanation}`
        : purchase.requiresAuthorization
          ? `Priced and proposed. ${purchase.explanation} Nothing has been charged — authorize it and I will complete the checkout.`
          : `Priced and proposed, and it sits inside your own limits. Nothing has been charged yet; authorize it to complete the checkout.`;
    await appendMessage(prisma, conversationId, "AGENT", message);
    trace.push({ stage: "PURCHASE_PROPOSED", detail: `Buyer policy returned ${purchase.outcome}. No money has moved.` });

    return {
      conversationId,
      messageId: userMessage.id,
      status: purchase.outcome === "DECLINE" ? ("PURCHASE_DECLINED" as const) : ("PURCHASE_PROPOSED" as const),
      intent: (conversationRow.currentIntent as unknown as BuyerIntentDTO | null) ?? null,
      recommendations: [],
      recommendationMode: null,
      recommendationId: candidates.recommendationId,
      clarification: null,
      appliedConstraints: [],
      candidateCount: candidates.productIds.length,
      aiProviderMode: provider.mode,
      dataFreshness: new Date().toISOString(),
      traceId,
      trace,
      turnAction: turn.action,
      offers,
      comparison: null,
      purchase,
      unresolvedReason: null,
      checkout: null,
    };
  }

  const priorIntent = toDomainIntent((conversationRow.currentIntent as unknown as BuyerIntentDTO | null) ?? null);

  let extraction = await extractAndNormalizeIntent(provider, params.message, knownCategories, knownAttributes);

  // A configured cloud model can be temporarily unreachable. Shopping must
  // remain usable, but the fallback must never masquerade as the live model.
  // Retry with the explicitly-labelled deterministic extractor and report
  // DEMO_RULE_BASED in the response so the customer can see what happened.
  if (!extraction.ok && provider.mode !== "DEMO_RULE_BASED" && !providerOverride) {
    logger.warn({ event: "buyer_agent.live_provider_fallback", failedMode: provider.mode, errorCode: extraction.errorCode }, "Live provider unavailable; using labelled deterministic fallback");
    provider = createDemoRuleBasedProvider();
    extraction = await extractAndNormalizeIntent(provider, params.message, knownCategories, knownAttributes);
  }

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
      // Part 9 defaults. An early return means SEARCH with nothing to
      // show, so these are the honest values rather than placeholders.
      turnAction: "SEARCH" as const,
      offers: [],
      comparison: null,
      purchase: null,
      unresolvedReason: null,
      checkout: null,
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

  // Once intent is known, perform category-aware merchant selection. This
  // prevents unrelated catalogs from consuming the five-merchant comparison
  // window and hiding a valid seller.
  // THE COMPARISON WINDOW IS MERCHANTS, NOT PRODUCTS.
  //
  // `discoverMarketplace`'s default per-merchant page is a BROWSE bound —
  // how many tiles a shopper sees on a discovery screen. Reusing it here
  // made the agent's candidate set narrower than the merchant-scoped
  // search it replaced: this catalogue has 46 active Running Shoes and the
  // agent was only ever offered the first 20, so a deterministic filter on
  // colour + size + budget could refuse a product the merchant genuinely
  // sells. Bounding the number of SELLERS compared is a product decision
  // and stays; bounding how much of a chosen seller's catalogue the filter
  // may see is just an accidental blind spot.
  const marketplace = params.marketplace
    ? await discoverMarketplace(prisma, {
        category: mergedIntent.category ?? undefined,
        limitPerMerchant: CATALOG_SEARCH_LIMIT,
      })
    : null;
  const marketplaceProducts = marketplace?.merchants.flatMap((merchant) => merchant.products);

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
      // Part 9 defaults. An early return means SEARCH with nothing to
      // show, so these are the honest values rather than placeholders.
      turnAction: "SEARCH" as const,
      offers: [],
      comparison: null,
      purchase: null,
      unresolvedReason: null,
      checkout: null,
      clarification: { required: true, reasonCode: "MISSING_CATEGORY", question: CLARIFICATION_QUESTION },
      appliedConstraints: buildAppliedConstraints(mergedIntent),
      candidateCount: 0,
      aiProviderMode: provider.mode,
      dataFreshness: new Date().toISOString(),
      traceId,
      trace,
    };
  }

  const products = marketplaceProducts ? marketplaceProducts.filter((product) => !mergedIntent.category || product.identity.category === mergedIntent.category) : await searchCandidateProducts(prisma, params.merchantId, {
    category: mergedIntent.category,
  });
  if (marketplace) trace.push({ stage: "MARKETPLACE_DISCOVERED", detail: `Compared published catalog candidates across ${marketplace.merchantCount} active merchants; conversation remains private to the authenticated buyer context.` });
  trace.push({ stage: "CATALOG_FILTERED", detail: `${products.length} candidate(s) from deterministic category/price filter` });
  logger.info({ event: "buyer_agent.catalog_searched", conversationId, traceId, candidateCount: products.length }, "Catalog searched");

  await recordLedgerEvent(prisma, {
    merchantId: params.merchantId,
    workflowId,
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
      workflowId,
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
      // Part 9 defaults. An early return means SEARCH with nothing to
      // show, so these are the honest values rather than placeholders.
      turnAction: "SEARCH" as const,
      offers: [],
      comparison: null,
      purchase: null,
      unresolvedReason: null,
      checkout: null,
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
    workflowId,
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
    recommendedVariantIds: outcome.recommendations.map((r) => r.variantId),
    mode: outcome.mode,
    aiProviderMode: provider.mode,
    traceId,
  });

  await recordLedgerEvent(prisma, {
    merchantId: params.merchantId,
    workflowId,
    actionType: "RECOMMENDATION_PROPOSED",
    conciseReason: `Proposed ${outcome.recommendations.length} recommendation(s) in ${outcome.mode} mode${outcome.groundingFailed ? " (AI ranking failed grounding, deterministic fallback used)" : ""}.`,
    relatedEntityType: "RecommendationRecord",
    relatedEntityId: recommendationRecord.id,
  });

  const agentMessage = renderAgentMessage(status, outcome);
  await appendMessage(prisma, conversationId, "AGENT", agentMessage);
  logger.info({ event: "buyer_agent.response_completed", conversationId, traceId, status }, "Buyer Agent response completed");

  // OFFER EVALUATION — the stage that was missing entirely.
  //
  // Merchant agents author real, governed offers; 125 of them sat
  // AUTHORIZED on the demo merchant while the Buyer Agent recommended the
  // same products at list price. Only offers a merchant's own policy
  // engine actually authorized appear here.
  const offers = await findBuyerVisibleOffers(
    prisma,
    outcome.recommendations.map((r) => r.productId),
  );
  // Recorded whether or not any offer applied. "We checked and there
  // were none" and "we never checked" are different facts, and only one
  // of them means the buyer saw list price for a good reason.
  trace.push({
    stage: "OFFERS_EVALUATED",
    detail:
      offers.length > 0
        ? `${offers.length} merchant-authorized offer(s) apply to these products.`
        : "No merchant-authorized offer applies to these products.",
  });
  await recordLedgerEvent(prisma, {
    merchantId: params.merchantId,
    workflowId,
    actionType: "OFFERS_EVALUATED",
    conciseReason:
      offers.length > 0
        ? `Checked ${outcome.recommendations.length} recommended product(s) for merchant-authorized offers; ${offers.length} apply.`
        : `Checked ${outcome.recommendations.length} recommended product(s) for merchant-authorized offers; none apply.`,
    relatedEntityType: "RecommendationRecord",
    relatedEntityId: recommendationRecord.id,
  });

  return {
    conversationId,
    messageId: userMessage.id,
    status,
    intent: intentDTO,
    recommendations: outcome.recommendations,
    turnAction: turn.action,
    offers,
    comparison: null,
    purchase: null,
    unresolvedReason: null,
    checkout: null,
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
