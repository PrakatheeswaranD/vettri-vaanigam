/**
 * Vaanigam gateway — the request path an outside AI buyer agent actually
 * hits.
 *
 * ORDER OF OPERATIONS IS THE DESIGN
 *
 *   detect protocol → adapter parses → resolve SKUs against the catalogue
 *   → price the basket OURSELVES → identify the agent → verify the buyer's
 *   mandate → evaluate the merchant's policy → decide → record
 *
 * Two properties matter more than anything else here:
 *
 * 1. The basket is priced from the merchant's own catalogue before any
 *    check runs. Every one of these protocols states a price on the wire
 *    and none of them is believed — the agent's figure is kept only so a
 *    disagreement can be surfaced rather than silently resolved in the
 *    agent's favour.
 *
 * 2. Every path writes a DecisionRecord with a plain-English sentence,
/**
 * Vaanigam gateway — the request path an outside AI buyer agent actually
 * hits.
 *
 * ORDER OF OPERATIONS IS THE DESIGN
 *
 *   detect protocol → adapter parses → resolve SKUs against the catalogue
 *   → price the basket OURSELVES → identify the agent → verify the buyer's
 *   mandate → evaluate the merchant's policy → decide → record
 *
 * Two properties matter more than anything else here:
 *
 * 1. The basket is priced from the merchant's own catalogue before any
 *    check runs. Every one of these protocols states a price on the wire
 *    and none of them is believed — the agent's figure is kept only so a
 *    disagreement can be surfaced rather than silently resolved in the
 *    agent's favour.
 *
 * 2. Every path writes a DecisionRecord with a plain-English sentence,
 *    including the ones that fail early. A request that could not even be
 *    parsed is exactly the kind of thing a merchant should be able to see,
 *    so it is recorded rather than dropped at the door.
 */
import { randomUUID } from "node:crypto";
import type { PrismaClient, Prisma } from "@prisma/client";
import {
  detectProtocol,
  parseIntentForProtocol,
  verifySpendMandate,
  evaluateAgentGatewayPolicy,
  clampNegotiatedDiscountBps,
  computeAgentTrust,
  effectiveCeilingMinor,
  ATTACK_REASON_CODES,
  POLICY_DECLINE_REASON_CODES,
  TRUST_PENALTY_WINDOW_DAYS,
  shouldNegotiate,
  offerBreachesFloorMargin,
  PROTOCOL_FIDELITY,
  type AgentGatewayPolicy as GatewayPolicyConfig,
  type AgentTrustLevel,
  type TrustBand,
  type AgentProtocol,
  type GatewayEvaluationResult,
  type ParsedIntent,
  type CurrencyCode,
  systemClock,
} from "@razorgrowth/domain";
import { logger } from "../../observability/logger.js";
import { appendLedgerEvent } from "../audit/ledger.js";
import { verifyMandateSignature } from "./mandate-verifier.js";
import { resolveAgentForIntent } from "./agent-registry.js";
import { getAIProvider } from "../agents/provider-factory.js";
import { maskEmail, maskPersonName, redactProtocolPayload } from "../privacy/redaction.js";
import { issueGatewayStatusToken } from "./status-token.js";
import { ExternalPurchaseExecutionError } from "./execution-service.js";

const VELOCITY_WINDOW_MS = 60 * 60 * 1000;

export interface GatewayRequest {
  merchantId: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
  /** Server-attested x402 state. This deliberately lives outside `body`:
   * a public caller must never be able to assert facilitator verification
   * by placing a boolean in JSON. */
  settlementAttestation?: "VERIFIED_X402" | "UNVERIFIED_X402";
  /** Set only by the authenticated ACP route after delegated-payment
   * validation. Unsigned allowances on the public mesh are otherwise denied. */
  authorizationAttestation?: "TRUSTED_ACP_DELEGATION";
  /** Dedicated x402 has already converted its atomic quote into catalog
   * minor units; a public caller cannot set this server-only value. */
  authoritativeClaimedTotalMinor?: number;
  /** A prior STEP_UP for this exact basket was approved and verified by
   * the protocol route using its opaque continuation capability. */
  humanApprovalAttestation?: boolean;
  /** Whether to accept any negotiated upsell/bundle offer automatically in execution. */
  acceptNegotiation?: boolean;
}

export interface GatewayResponse {
  decisionId: string;
  outcome: "AUTO_APPROVE" | "STEP_UP" | "DECLINE";
  reasonCode: string;
  explanation: string;
  protocol: string | null;
  protocolFidelity: string | null;
  computedTotalMinor: number | null;
  currency: string | null;
  stepUpUrl: string | null;
  /** Present on an approval: a REAL Razorpay order the agent can now pay.
   * An approval that produced nothing payable would leave the gateway
   * deciding but never transacting. */
  providerOrderId: string | null;
  internalOrderId: string | null;
  internalPaymentId: string | null;
  statusToken: string;
  decisionLatencyMs: number;
  /** Present only when the negotiator offered something inside the
   * merchant's envelope. Null is the normal, unremarkable case. */
  offer: { addSkus: string[]; discountBps: number; pitch: string } | null;
  /** The adaptive trust score that set this call's ceiling. Null when the
   * request failed before an agent could be identified. */
  trustScore: number | null;
  trustBand: string | null;
  appliedCeilingMinor: number | null;
}

interface PricedBasket {
  lines: { productId: string; variantId: string; quantity: number; unitPriceMinor: number; unitCostMinor: number | null }[];
  totalMinor: number;
  currency: CurrencyCode;
  categories: string[];
}

function singleHeader(headers: GatewayRequest["headers"]): Record<string, string | undefined> {
  const flat: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(headers)) {
    flat[key.toLowerCase()] = Array.isArray(value) ? value[0] : value;
  }
  return flat;
}

async function loadGatewayPolicy(prisma: PrismaClient, merchantId: string): Promise<GatewayPolicyConfig> {
  const row = await prisma.agentGatewayPolicy.findUnique({ where: { merchantId } });
  if (row) {
    return {
      policyVersion: row.policyVersion,
      currency: row.currency as CurrencyCode,
      unknownAgentCeilingMinor: row.unknownAgentCeilingMinor,
      knownAgentCeilingMinor: row.knownAgentCeilingMinor,
      blockedCategories: row.blockedCategories,
      maxNegotiationDiscountBps: row.maxNegotiationDiscountBps,
      negotiatorMinBundleItems: row.negotiatorMinBundleItems,
      negotiatorFloorMarginBps: row.negotiatorFloorMarginBps,
      velocityMaxIntentsPerHour: row.velocityMaxIntentsPerHour,
      allowFirstUseKeyPinning: row.allowFirstUseKeyPinning,
    };
  }
  // A merchant with no gateway policy configured is NOT wide open. The
  // defaults are the same conservative ones the schema declares, so an
  // unconfigured merchant behaves as if it had the strictest sensible
  // setup rather than accepting anything.
  return {
    policyVersion: 0,
    currency: "INR",
    unknownAgentCeilingMinor: 1_000_000,
    knownAgentCeilingMinor: 5_000_000,
    blockedCategories: [],
    maxNegotiationDiscountBps: 1000,
    negotiatorMinBundleItems: 2,
    negotiatorFloorMarginBps: 2000,
    velocityMaxIntentsPerHour: 20,
    // Unconfigured means STRICTER, never more permissive.
    allowFirstUseKeyPinning: false,
  };
}

/**
 * Prices the basket from the merchant's own catalogue.
 *
 * Returns null when any SKU cannot be resolved: a partially-resolvable
 * basket is refused rather than silently shortened, because quietly
 * dropping a line changes what the buyer agreed to buy.
 */
async function priceBasket(
  prisma: PrismaClient,
  merchantId: string,
  intent: ParsedIntent,
): Promise<PricedBasket | null> {
  const quantityBySku = new Map<string, number>();
  for (const line of intent.lines) {
    const quantity = (quantityBySku.get(line.sku) ?? 0) + line.quantity;
    // Duplicate lines are normalized, but cannot be used to bypass the
    // protocol's per-SKU quantity bound.
    if (!Number.isSafeInteger(quantity) || quantity > 999) return null;
    quantityBySku.set(line.sku, quantity);
  }
  const normalizedLines = [...quantityBySku].map(([sku, quantity]) => ({ sku, quantity }));
  const skus = normalizedLines.map((line) => line.sku);
  const variants = await prisma.productVariant.findMany({
    where: { sku: { in: skus }, active: true, product: { merchantId, status: "ACTIVE" } },
    include: { product: { select: { id: true, category: true } } },
  });

  const bySku = new Map(variants.map((v) => [v.sku, v]));
  const lines: PricedBasket["lines"] = [];
  const categories = new Set<string>();
  let totalMinor = 0;
  let currency: CurrencyCode | null = null;

  for (const line of normalizedLines) {
    const variant = bySku.get(line.sku);
    if (!variant) return null;
    if (currency && variant.currency !== currency) return null;
    currency = variant.currency as CurrencyCode;
    totalMinor += variant.priceMinor * line.quantity;
    categories.add(variant.product.category);
    lines.push({
      productId: variant.product.id,
      variantId: variant.id,
      quantity: line.quantity,
      unitPriceMinor: variant.priceMinor,
      unitCostMinor: variant.costMinor,
    });
  }

  return { lines, totalMinor, currency: currency ?? "INR", categories: [...categories] };
}

export interface ResolvedAgent {
  id: string;
  trust: AgentTrustLevel;
  recentIntentCount: number;
  trustedPublicKey: string | null;
  /** The adaptive score derived from this agent's own record with THIS
   * merchant, and the ceiling it produces. */
  adaptiveTrust: { score: number; band: TrustBand; ceilingMinor: number; collapsed: boolean };
  trustExplanation: string;
  history: { settledOrders: number; declines: number; flaggedAttacks: number };
}

async function resolveAgent(
  prisma: PrismaClient,
  merchantId: string,
  intent: ParsedIntent,
  policy: GatewayPolicyConfig,
): Promise<ResolvedAgent> {
  const agent = await resolveAgentForIntent(prisma, {
    merchantId,
    externalAgentId: intent.agentId,
    firstSeenProtocol: intent.protocol,
    presentedPublicKey: intent.mandate?.publicKey ?? null,
    allowFirstUsePinning: policy.allowFirstUseKeyPinning,
  });

  // Penalties are counted over a trailing window, never over all time. A
  // score nothing can fall off is a ban rather than a score, and it would
  // leave an agent that fixed its integration permanently throttled with
  // no route back.
  const penaltyWindowStart = new Date(Date.now() - TRUST_PENALTY_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const [recentIntentCount, declines, flaggedAttacks] = await Promise.all([
    prisma.decisionRecord.count({
      where: { agentIdentityId: agent.id, createdAt: { gte: new Date(Date.now() - VELOCITY_WINDOW_MS) } },
    }),
    // Only declines where the agent OVERSTEPPED. An unresolvable SKU or a
    // malformed mandate is a badly-wired integration, not a risk signal,
    // and is deliberately not scored — see POLICY_DECLINE_REASON_CODES.
    prisma.decisionRecord.count({
      where: {
        agentIdentityId: agent.id,
        createdAt: { gte: penaltyWindowStart },
        reasonCode: { in: [...POLICY_DECLINE_REASON_CODES] },
      },
    }),
    prisma.decisionRecord.count({
      where: {
        agentIdentityId: agent.id,
        createdAt: { gte: penaltyWindowStart },
        reasonCode: { in: [...ATTACK_REASON_CODES] },
      },
    }),
  ]);

  // A pure derived view over Decision Records already written — no new
  // write path, exactly as the feature spec describes.
  const history = { settledOrders: agent.settledOrderCount, declines, flaggedAttacks };
  const trust = computeAgentTrust(history);
  const ceiling = effectiveCeilingMinor({
    trustScore: trust.score,
    unknownAgentCeilingMinor: policy.unknownAgentCeilingMinor,
    knownAgentCeilingMinor: policy.knownAgentCeilingMinor,
  });

  // Trust is the merchant's own settlement history, never the agent's
  // self-description.
  return {
    id: agent.id,
    trust: agent.settledOrderCount > 0 ? "KNOWN" : "UNKNOWN",
    recentIntentCount,
    trustedPublicKey: agent.trustedPublicKey,
    adaptiveTrust: {
      score: trust.score,
      band: trust.band,
      ceilingMinor: ceiling.ceilingMinor,
      collapsed: ceiling.collapsed,
    },
    trustExplanation: trust.explanation,
    history,
  };
}

interface RecordArgs {
  decisionId?: string;
  workflowId?: string;
  merchantId: string;
  startedAt: number;
  outcome: "AUTO_APPROVE" | "STEP_UP" | "DECLINE";
  reasonCode: string;
  explanation: string;
  protocol?: AgentProtocol | null;
  protocolVersion?: string | null;
  detectedVia?: string | null;
  externalAgentId?: string | null;
  agentIdentityId?: string | null;
  agentTrust?: AgentTrustLevel | null;
  computedTotalMinor?: number | null;
  claimedTotalMinor?: number | null;
  appliedCeilingMinor?: number | null;
  currency?: CurrencyCode | null;
  stepUpPaymentLinkId?: string | null;
  stepUpPaymentLinkUrl?: string | null;
  stepUpStatus?: string | null;
  negotiatedDiscountBps?: number | null;
  providerOrderId?: string | null;
  internalOrderId?: string | null;
  internalPaymentId?: string | null;
  normalizedBasket?: PricedBasket["lines"] | null;
  buyerEmail?: string | null;
  buyerName?: string | null;
  protocolActorRef?: string | null;
  rawProtocolPayload?: unknown;
  permissionType?: "SIGNED_MANDATE" | "UNSIGNED_ALLOWANCE" | "VERIFIED_X402" | "UNVERIFIED_X402" | "NONE" | null;
  authorizationExpiresAt?: Date | null;
  authorizationMaxAmountMinor?: number | null;
  authorizationCurrency?: CurrencyCode | null;
  authorizationMerchantScope?: string | null;
  offer?: { addSkus: string[]; discountBps: number; pitch: string } | null;
  negotiatorRawProposal?: NegotiationOutcome["raw"];
  decidedAtMs?: number;
  /** Snapshot, not a live read: the console must show the score as it was
   * when this call was decided. */
  trustScoreAtDecision?: number | null;
  trustBandAtDecision?: string | null;
}

async function writeDecision(prisma: PrismaClient, args: RecordArgs): Promise<GatewayResponse> {
  // Latency is measured to the moment the DECISION was reached, not to the
  // end of the request. The negotiator is an optional model call that runs
  // after approval; billing its seconds to "decision latency" would report
  // the upsell's cost as the gate's, and the gate is the thing a merchant
  // is judging.
  const decisionLatencyMs = Math.max(0, Math.round((args.decidedAtMs ?? performance.now()) - args.startedAt));

  const recordId = args.decisionId ?? randomUUID();
  const workflowId = args.workflowId ?? `agent-decision-${recordId}`;
  const data: Prisma.DecisionRecordUncheckedCreateInput = {
    id: recordId,
    merchantId: args.merchantId,
    outcome: args.outcome,
    reasonCode: args.reasonCode,
    explanation: args.explanation,
    protocol: args.protocol ?? null,
    protocolVersion: args.protocolVersion ?? null,
    detectedVia: args.detectedVia ?? null,
    externalAgentId: args.externalAgentId ?? null,
    agentIdentityId: args.agentIdentityId ?? null,
    agentTrust: args.agentTrust ?? null,
    computedTotalMinor: args.computedTotalMinor ?? null,
    claimedTotalMinor: args.claimedTotalMinor ?? null,
    appliedCeilingMinor: args.appliedCeilingMinor ?? null,
    trustScoreAtDecision: args.trustScoreAtDecision ?? null,
    trustBandAtDecision: args.trustBandAtDecision ?? null,
    currency: args.currency ?? null,
    stepUpPaymentLinkId: args.stepUpPaymentLinkId ?? null,
    stepUpPaymentLinkUrl: args.stepUpPaymentLinkUrl ?? null,
    stepUpStatus: args.stepUpStatus ?? (args.outcome === "STEP_UP" ? "PENDING" : null),
    negotiatedDiscountBps: args.negotiatedDiscountBps ?? null,
    negotiatorRawProposal: (args.negotiatorRawProposal ?? null) as never,
    providerOrderId: args.providerOrderId ?? null,
    internalOrderId: args.internalOrderId ?? null,
    internalPaymentId: args.internalPaymentId ?? null,
    normalizedBasket: (args.normalizedBasket ?? null) as never,
    buyerEmail: maskEmail(args.buyerEmail),
    buyerName: maskPersonName(args.buyerName),
    protocolActorRef: args.protocolActorRef ?? null,
    rawProtocolPayload: (args.rawProtocolPayload === undefined ? null : redactProtocolPayload(args.rawProtocolPayload)) as never,
    permissionType: args.permissionType ?? null,
    authorizationExpiresAt: args.authorizationExpiresAt ?? null,
    authorizationMaxAmountMinor: args.authorizationMaxAmountMinor ?? null,
    authorizationCurrency: args.authorizationCurrency ?? null,
    authorizationMerchantScope: args.authorizationMerchantScope ?? null,
    workflowId,
    decisionLatencyMs,
  };

  const record = await prisma.decisionRecord.create({ data });

  // EVERY external decision reaches the hash-chained ledger.
  //
  // The schema promises that agent activity is auditable through the same
  // tamper-evident chain as everything else, and writing only a
  // DecisionRecord quietly bypassed it: the one class of event most likely
  // to be disputed was the one class not chained. Each decision gets its
  // own workflow id, because a refused intent never becomes an order and
  // inventing a shared workflow would imply a relationship that does not
  // exist.
  //
  // A ledger failure must not lose the decision that was already made, so
  // it is logged loudly rather than thrown — the DecisionRecord remains
  // the authoritative row either way.
  try {
    await appendLedgerEvent(prisma, {
      workflowId,
      merchantId: args.merchantId,
      actorType: "POLICY_ENGINE",
      actionType:
        args.outcome === "AUTO_APPROVE"
          ? "AGENT_INTENT_APPROVED"
          : args.outcome === "STEP_UP"
            ? "AGENT_INTENT_STEPPED_UP"
            : "AGENT_INTENT_DECLINED",
      status: args.outcome === "DECLINE" ? "REJECTED" : "EXECUTED",
      conciseReason: args.explanation.slice(0, 500),
      relatedEntityType: "DecisionRecord",
      relatedEntityId: record.id,
      metadata: {
        protocol: args.protocol ?? null,
        reasonCode: args.reasonCode,
        externalAgentId: args.externalAgentId ?? null,
        computedTotalMinor: args.computedTotalMinor ?? null,
        permissionType: args.permissionType ?? null,
      },
      executedAt: new Date(),
    });
  } catch (err) {
    logger.error(
      { event: "vaanigam.ledger_append_failed", decisionId: record.id, err: err instanceof Error ? err.message : String(err) },
      "Decision recorded but could not be appended to the audit ledger",
    );
  }

  logger.info(
    { event: "vaanigam.decision", decisionId: record.id, outcome: args.outcome, reasonCode: args.reasonCode, decisionLatencyMs },
    args.explanation,
  );

  return {
    decisionId: record.id,
    outcome: args.outcome,
    reasonCode: args.reasonCode,
    explanation: args.explanation,
    protocol: args.protocol ?? null,
    protocolFidelity: args.protocol ? PROTOCOL_FIDELITY[args.protocol] : null,
    computedTotalMinor: args.computedTotalMinor ?? null,
    currency: args.currency ?? null,
    stepUpUrl: args.stepUpPaymentLinkUrl ?? null,
    providerOrderId: args.providerOrderId ?? null,
    internalOrderId: args.internalOrderId ?? null,
    internalPaymentId: args.internalPaymentId ?? null,
    statusToken: issueGatewayStatusToken(record.id),
    decisionLatencyMs,
    offer: args.offer ?? null,
    trustScore: args.trustScoreAtDecision ?? null,
    trustBand: args.trustBandAtDecision ?? null,
    appliedCeilingMinor: args.appliedCeilingMinor ?? null,
  };
}

/**
 * The Negotiator, kept strictly downstream of the decision.
 *
 * It runs ONLY after policy has already approved the basket, so a model
 * can never be the reason something was allowed — at most it changes what
 * is offered on top of something already permitted. Its discount is
 * clamped by `clampNegotiatedDiscountBps` regardless of what it returns,
 * and any failure (bad JSON, provider down, invented SKU) degrades to "no
 * offer" rather than failing the purchase the merchant already approved.
 */
export interface NegotiationOutcome {
  /** What is actually offered. Null when nothing survived the guardrails. */
  offer: { addSkus: string[]; discountBps: number; pitch: string } | null;
  /**
   * What the MODEL asked for, before clamping or grounding — kept so the
   * claim "the LLM cannot move money" is checkable from the record rather
   * than taken on trust. Null when no model call was made.
   */
  raw: {
    discountBps: number;
    addSkus: string[];
    pitch: string;
    /** True when the policy cap reduced the model's number. */
    discountWasClamped: boolean;
    /** SKUs the model named that are not in this merchant's catalogue. */
    droppedSkus: string[];
    /** Set when a proposal was made and then refused outright. */
    rejectedReason: string | null;
  } | null;
}

const NO_NEGOTIATION: NegotiationOutcome = { offer: null, raw: null };

async function negotiate(
  prisma: PrismaClient,
  merchantId: string,
  basket: PricedBasket,
  policy: GatewayPolicyConfig,
): Promise<NegotiationOutcome> {
  if (!shouldNegotiate(basket.lines.length, policy)) return NO_NEGOTIATION;

  try {
    const basketProductIds = basket.lines.map((l) => l.productId);
    const candidates = await prisma.productVariant.findMany({
      where: {
        active: true,
        product: { merchantId, status: "ACTIVE", id: { notIn: basketProductIds } },
      },
      include: { product: { select: { name: true, category: true } } },
      take: 12,
    });
    if (candidates.length === 0) return NO_NEGOTIATION;

    const basketRows = await prisma.productVariant.findMany({
      where: { id: { in: basket.lines.map((l) => l.variantId) } },
      include: { product: { select: { name: true, category: true } } },
    });

    const provider = getAIProvider();
    const raw = await provider.proposeAgentUpsell({
      basket: basketRows.map((v) => ({
        sku: v.sku,
        name: v.product.name,
        category: v.product.category,
        quantity: basket.lines.find((l) => l.variantId === v.id)?.quantity ?? 1,
      })),
      candidates: candidates.map((v) => ({ sku: v.sku, name: v.product.name, category: v.product.category })),
      maxDiscountBps: policy.maxNegotiationDiscountBps,
    });

    // Grounding: a SKU the model invented is dropped, never offered.
    const allowed = new Set(candidates.map((c) => c.sku));
    const proposedSkus = (Array.isArray(raw.addSkus) ? raw.addSkus : []).filter((sku) => typeof sku === "string");
    const addSkus = proposedSkus.filter((sku) => allowed.has(sku));
    const discountBps = clampNegotiatedDiscountBps(raw.discountBps, policy);

    const rawProposal = {
      discountBps: Number.isFinite(raw.discountBps) ? Math.round(raw.discountBps) : 0,
      addSkus: proposedSkus,
      pitch: typeof raw.pitch === "string" ? raw.pitch : "",
      discountWasClamped: Number.isFinite(raw.discountBps) && Math.floor(raw.discountBps) > discountBps,
      droppedSkus: proposedSkus.filter((sku) => !allowed.has(sku)),
      rejectedReason: null as string | null,
    };

    // A discount with nothing added is margin loss, not an upsell.
    if (addSkus.length === 0 || discountBps <= 0) {
      return {
        offer: null,
        raw: {
          ...rawProposal,
          rejectedReason:
            addSkus.length === 0
              ? "Every SKU the model named is absent from this merchant's catalogue."
              : "The model proposed no usable discount.",
        },
      };
    }

    const selected = candidates.filter((candidate) => addSkus.includes(candidate.sku));
    const revenueMinor = basket.totalMinor + selected.reduce((sum, candidate) => sum + candidate.priceMinor, 0);
    const knownBasketCost = basket.lines.every((line) => line.unitCostMinor !== null);
    const knownCandidateCost = selected.every((candidate) => candidate.costMinor !== null);
    const costMinor =
      knownBasketCost && knownCandidateCost
        ? basket.lines.reduce((sum, line) => sum + line.unitCostMinor! * line.quantity, 0) +
          selected.reduce((sum, candidate) => sum + candidate.costMinor!, 0)
        : null;

    // Below the merchant's REAL COGS-backed floor is a refusal, not a
    // smaller discount. Missing cost fails closed.
    if (offerBreachesFloorMargin({ revenueMinor, costMinor, discountBps }, policy)) {
      logger.info(
        { event: "vaanigam.offer_rejected_floor_margin", discountBps, floorMarginBps: policy.negotiatorFloorMarginBps, costKnown: costMinor !== null },
        "Negotiator offer rejected: would breach the merchant's floor margin",
      );
      return {
        offer: null,
        raw: { ...rawProposal, rejectedReason: "The offer would take the basket below the merchant's floor margin." },
      };
    }

    // The receipt: what was asked for, and what was allowed.
    if (rawProposal.discountWasClamped || rawProposal.droppedSkus.length > 0) {
      logger.info(
        {
          event: "vaanigam.negotiator_clamped",
          modelProposedBps: rawProposal.discountBps,
          enforcedBps: discountBps,
          modelProposedSkus: rawProposal.addSkus,
          droppedSkus: rawProposal.droppedSkus,
        },
        "Negotiator proposal was reduced by code before it could reach a buyer",
      );
    }

    return { offer: { addSkus, discountBps, pitch: rawProposal.pitch }, raw: rawProposal };
  } catch (err) {
    logger.warn({ event: "vaanigam.negotiator_failed", err: err instanceof Error ? err.message : String(err) }, "Negotiator failed; proceeding with no offer");
    return NO_NEGOTIATION;
  }
}

/**
 * Handles one inbound purchase intent, whatever protocol it arrived on.
 *
 * `createStepUpLink` is injected so the Step-Up Gate can be exercised
 * without a live Razorpay call in tests, and so a provider outage degrades
 * to "recorded, no link" instead of losing the decision entirely.
 */
export async function handleAgentPurchaseIntent(
  prisma: PrismaClient,
  request: GatewayRequest,
  _createStepUpLink?: (args: { amountMinor: number; currency: string; description: string }) => Promise<{ id: string; url: string } | null>,
  /** Creates the provider order an approved intent becomes payable through.
   * Injected for the same reasons as the step-up link: testable without a
   * live provider, and a provider outage degrades instead of losing the
   * decision. */
  executeApprovedPurchase?: (args: {
    decisionId: string;
    workflowId: string;
    amountMinor: number;
    currency: string;
    lines: PricedBasket["lines"];
  }) => Promise<{ providerOrderId: string; orderId: string; paymentId: string } | null>,
): Promise<GatewayResponse> {
  const startedAt = performance.now();
  const headers = singleHeader(request.headers);
  const base = { merchantId: request.merchantId, startedAt };

  const detection = detectProtocol(request.headers, request.body);
  if (detection.protocol === "UNKNOWN") {
    return writeDecision(prisma, {
      ...base,
      outcome: "DECLINE",
      reasonCode: "PROTOCOL_UNSUPPORTED",
      explanation:
        "This request did not identify itself as any agent-commerce protocol this gateway speaks, so its contents could not be read safely. Nothing was charged.",
      detectedVia: detection.source,
    });
  }

  const parsed = parseIntentForProtocol(detection.protocol, request.body, headers, detection.version);
  if (!parsed.ok) {
    return writeDecision(prisma, {
      ...base,
      outcome: "DECLINE",
      reasonCode: parsed.code,
      explanation: `${parsed.detail} Nothing was charged.`,
      protocol: detection.protocol,
      protocolVersion: detection.version,
      detectedVia: detection.source,
    });
  }

  const intent: ParsedIntent = {
    ...parsed.intent,
    claimedTotalMinor: request.authoritativeClaimedTotalMinor ?? parsed.intent.claimedTotalMinor,
    verifiedSettlement: request.settlementAttestation === "VERIFIED_X402",
    unverifiedSettlement: request.settlementAttestation === "UNVERIFIED_X402",
  };
  const policy = await loadGatewayPolicy(prisma, request.merchantId);
  const agent = await resolveAgent(prisma, request.merchantId, intent, policy);
  const agentContext = {
    protocol: detection.protocol,
    protocolVersion: detection.version,
    detectedVia: detection.source,
    externalAgentId: intent.agentId,
    agentIdentityId: agent.id,
    agentTrust: agent.trust,
    claimedTotalMinor: intent.claimedTotalMinor,
    buyerEmail: intent.buyer?.email ?? null,
    buyerName: intent.buyer?.name ?? null,
    protocolActorRef: intent.protocolActorRef,
    rawProtocolPayload: request.body,
    // Recorded distinctly: an ACP Allowance is checked on its terms but not
    // on any signature, and calling that a verified mandate in the console
    // would overstate what actually happened.
    permissionType: intent.mandate
      ? ("SIGNED_MANDATE" as const)
      : intent.unsignedAllowance
        ? ("UNSIGNED_ALLOWANCE" as const)
        : intent.verifiedSettlement
          ? ("VERIFIED_X402" as const)
        : intent.unverifiedSettlement
          ? ("UNVERIFIED_X402" as const)
          : ("NONE" as const),
    authorizationExpiresAt: intent.mandate?.expiresAt ?? intent.unsignedAllowance?.expiresAt ?? null,
    authorizationMaxAmountMinor: intent.mandate?.maxAmountMinor ?? intent.unsignedAllowance?.maxAmountMinor ?? null,
    authorizationCurrency: (intent.mandate?.currency ?? intent.unsignedAllowance?.currency ?? null) as CurrencyCode | null,
    authorizationMerchantScope: intent.mandate?.merchantScope ?? intent.unsignedAllowance?.scope ?? null,
  };

  const basket = await priceBasket(prisma, request.merchantId, intent);
  if (!basket) {
    return writeDecision(prisma, {
      ...base,
      ...agentContext,
      outcome: "DECLINE",
      reasonCode: "UNRESOLVABLE_ITEMS",
      explanation:
        "At least one item in this basket does not match a currently-available product in your catalogue, so the order could not be priced. Nothing was charged.",
    });
  }

  // The buyer's consent, checked before the merchant's. A mandate failure
  // is the more specific thing to tell an agent, and it costs nothing to
  // find out first.
  const nonceAlreadyUsed = intent.mandate
    ? (await prisma.spendMandateNonce.count({
        where: { merchantId: request.merchantId, nonce: intent.mandate.nonce },
      })) > 0
    : false;

  // ACP carries its OWN spend authorisation (an `Allowance`), so an agent
  // on that protocol is not asked to also mint an Vaanigam mandate. The
  // allowance is checked on the same terms — amount, currency, expiry,
  // merchant scope — but it is NOT signed, so it is never reported as a
  // verified mandate and the Decision Record says which one applied.
  if (!intent.mandate && intent.unsignedAllowance) {
    const allowance = intent.unsignedAllowance;
    if (request.authorizationAttestation !== "TRUSTED_ACP_DELEGATION") {
      return writeDecision(prisma, {
        ...base,
        ...agentContext,
        outcome: "DECLINE",
        reasonCode: "ALLOWANCE_UNAUTHENTICATED",
        explanation: "An unsigned ACP allowance is accepted only from the authenticated ACP delegated-payment route. Nothing was charged.",
        computedTotalMinor: basket.totalMinor,
        currency: basket.currency,
      });
    }

    // SCOPE IS CHECKED, NOT JUST PARSED.
    //
    // An earlier version read `merchant_id` and never compared it, so an
    // allowance issued for any merchant — or for none — was spendable
    // here. An allowance that does not name this merchant is refused; one
    // that names nobody is refused too, because an unscoped spending
    // authorisation is not a scoped one with the scope left blank.
    const failure =
      !allowance.scope
        ? "This allowance does not say which merchant it is for, so it cannot be spent anywhere."
        : allowance.scope !== request.merchantId
          ? "This allowance was issued for a different merchant and cannot be spent here."
          : allowance.expiresAt && allowance.expiresAt.getTime() <= systemClock.now().getTime()
            ? "This allowance expired before the purchase was completed."
            : allowance.currency !== basket.currency
              ? `The allowance authorises ${allowance.currency} but this order is priced in ${basket.currency}.`
              : basket.totalMinor > allowance.maxAmountMinor
                ? `The order total exceeds the amount this allowance authorises (${allowance.maxAmountMinor} minor units).`
                : null;

    if (failure) {
      return writeDecision(prisma, {
        ...base,
        ...agentContext,
        outcome: "DECLINE",
        reasonCode: "ALLOWANCE_INVALID",
        explanation: `${failure} Nothing was charged.`,
        computedTotalMinor: basket.totalMinor,
        currency: basket.currency,
      });
    }
  }

  // Three ways an intent can carry permission, and they are NOT equivalent:
  //   1. a signed mandate      — verified against a registered key
  //   2. an ACP allowance      — terms checked, signature absent
  //   3. an x402 authorisation — present, but unverifiable without a
  //      facilitator, so it grants nothing and forces a human decision
  // Only (1) is a verified permission; the other two are recorded as what
  // they are and (3) can never auto-approve.
  const mandateResult = (intent.unsignedAllowance || intent.unverifiedSettlement || intent.verifiedSettlement) && !intent.mandate
    ? ({ valid: true } as const)
    : verifySpendMandate(intent.mandate, {
    merchantId: request.merchantId,
    callerAgentId: intent.agentId,
    orderTotalMinor: basket.totalMinor,
    currency: basket.currency,
    now: systemClock.now(),
    nonceAlreadyUsed,
    verifySignature: verifyMandateSignature,
    trustedPublicKey: agent.trustedPublicKey,
  });

  if (!mandateResult.valid) {
    return writeDecision(prisma, {
      ...base,
      ...agentContext,
      outcome: "DECLINE",
      reasonCode: mandateResult.code,
      explanation: `${mandateResult.detail} Nothing was charged.`,
      computedTotalMinor: basket.totalMinor,
      currency: basket.currency,
    });
  }

  const evaluation: GatewayEvaluationResult = evaluateAgentGatewayPolicy(policy, {
    agentTrust: agent.trust,
    orderTotalMinor: basket.totalMinor,
    claimedTotalMinor: intent.claimedTotalMinor,
    currency: basket.currency,
    categories: basket.categories,
    lineCount: basket.lines.length,
    recentIntentCount: agent.recentIntentCount,
    protocolSupported: true,
    adaptiveTrust: agent.adaptiveTrust,
  });

  // A platform's own fraud system flagging this purchase is evidence the
  // ceiling cannot capture. It can only ever make the outcome MORE
  // cautious — never less — so it upgrades an approval to a step-up and
  // leaves a decline alone.
  const riskFlagged = intent.riskFlags.length > 0;

  // An unverifiable settlement can never be auto-approved. x402 without a
  // facilitator means nobody has checked the money exists; charging on that
  // basis would be trusting the buyer's word for a payment. It escalates to
  // a human, which is the honest outcome — not a refusal, because the
  // purchase may be perfectly good, and not an approval, because we do not
  // know that.
  const unverifiable = intent.unverifiedSettlement;
  const cautiousDecision =
    (riskFlagged || unverifiable) && evaluation.decision === "AUTO_APPROVE"
      ? ("STEP_UP" as const)
      : evaluation.decision;
  const effectiveDecision =
    request.humanApprovalAttestation && cautiousDecision === "STEP_UP"
      ? ("AUTO_APPROVE" as const)
      : cautiousDecision;

  const shared = {
    ...base,
    ...agentContext,
    reasonCode:
      request.humanApprovalAttestation && effectiveDecision === "AUTO_APPROVE"
        ? "HUMAN_APPROVAL_APPLIED"
        : effectiveDecision !== evaluation.decision
        ? unverifiable
          ? "SETTLEMENT_UNVERIFIED"
          : "RISK_SIGNAL_REVIEW"
        : evaluation.reasonCode,
    explanation: request.humanApprovalAttestation && effectiveDecision === "AUTO_APPROVE"
      ? `${evaluation.explanation} An authenticated merchant approver previously approved this exact basket, and the fresh x402 authorization may now proceed on the original payment rail.`
      : unverifiable
      ? `${evaluation.explanation} However, this agent pays over x402 and no settlement facilitator is configured, so nobody has verified the money actually exists. It is going to you for approval rather than being charged on the buyer's word.`
      : riskFlagged
        ? `${evaluation.explanation} The calling platform also flagged this purchase for review (${intent.riskFlags.join(", ")}), so it is going to you rather than through automatically.`
        : evaluation.explanation,
    computedTotalMinor: basket.totalMinor,
    currency: basket.currency,
    appliedCeilingMinor: evaluation.appliedCeilingMinor,
    trustScoreAtDecision: evaluation.trustScore,
    trustBandAtDecision: evaluation.trustBand,
  };

  if (effectiveDecision === "DECLINE") {
    return writeDecision(prisma, { ...shared, outcome: "DECLINE" });
  }

  // Only a decision that will actually proceed consumes the mandate. A
  // decline must not burn a single-use nonce the buyer would then have to
  // re-issue for an order they never got.
  if (intent.mandate) {
    try {
      await prisma.spendMandateNonce.create({
        data: {
          merchantId: request.merchantId,
          nonce: intent.mandate.nonce,
          mandateId: intent.mandate.mandateId,
          buyerAgentId: intent.mandate.buyerAgentId,
        },
      });
    } catch {
      // Lost a race with a concurrent request presenting the same mandate.
      // The unique constraint is the authority on single-use, not the
      // earlier read — so this is a replay, decided here rather than
      // depending on read-then-write staying atomic.
      return writeDecision(prisma, {
        ...shared,
        outcome: "DECLINE",
        reasonCode: "MANDATE_NONCE_REPLAYED",
        explanation: "This mandate has already been spent; mandates are single-use. Nothing was charged.",
      });
    }
  }

  if (effectiveDecision === "STEP_UP") {
    return writeDecision(prisma, {
      ...shared,
      outcome: "STEP_UP",
      // Built from `shared.explanation`, NOT from `evaluation.explanation`:
      // a risk-signal upgrade has already added its sentence there, and
      // rebuilding from the raw evaluation would silently drop the reason
      // this became a step-up in the first place.
      explanation: `${shared.explanation} No payment object has been created; this is waiting for an authenticated owner or approver in the console.`,
      normalizedBasket: basket.lines,
      stepUpStatus: "PENDING",
    });
  }

  const decidedAtMs = performance.now();
  const decisionId = randomUUID();
  const workflowId = `agent-decision-${decisionId}`;
  const negotiation = await negotiate(prisma, request.merchantId, basket, policy);
  const offer = negotiation.offer;

  // Persist the policy decision BEFORE executing it. Payment/order ledger
  // entries can therefore never appear earlier than the authorization that
  // caused them. Execution then enriches this record with internal/provider
  // identifiers, or safely changes the final outcome to STEP_UP on failure.
  const approved = await writeDecision(prisma, {
    ...shared,
    decisionId,
    workflowId,
    outcome: "AUTO_APPROVE",
    decidedAtMs,
    negotiatedDiscountBps: offer?.discountBps ?? null,
    negotiatorRawProposal: negotiation.raw,
    normalizedBasket: basket.lines,
    offer,
    explanation: [
      evaluation.explanation,
      offer
        ? `The negotiator also offered ${offer.discountBps / 100}% off for adding ${offer.addSkus.length} item(s), within your configured ceiling.`
        : null,
      executeApprovedPurchase ? "The approved basket is now being turned into a payable checkout." : null,
    ]
      .filter(Boolean)
      .join(" "),
  });

  if (!executeApprovedPurchase) return approved;

  const shouldApplyOffer = Boolean(
    request.acceptNegotiation ||
    headers["x-accept-negotiation"] === "true" ||
    (typeof request.body === "object" && request.body !== null && (request.body as Record<string, unknown>).acceptNegotiation === true)
  );

  let executionLines = basket.lines;
  let executionAmountMinor = basket.totalMinor;

  if (offer && shouldApplyOffer && offer.addSkus.length > 0) {
    const additionalVariants = await prisma.productVariant.findMany({
      where: {
        sku: { in: offer.addSkus },
        active: true,
        product: { merchantId: request.merchantId, status: "ACTIVE" },
      },
      include: { product: { select: { id: true, name: true } } },
    });

    const addLines = additionalVariants.map((v) => ({
      productId: v.productId,
      variantId: v.id,
      sku: v.sku,
      title: v.title,
      unitPriceMinor: v.priceMinor,
      unitCostMinor: v.costMinor,
      quantity: 1,
      lineTotalMinor: v.priceMinor,
    }));

    const combinedLines = [...basket.lines, ...addLines];
    const totalGross = combinedLines.reduce((sum, l) => sum + l.unitPriceMinor * l.quantity, 0);
    const discountFraction = offer.discountBps / 10000;
    const totalDiscountMinor = Math.round(totalGross * discountFraction);

    let allocatedDiscount = 0;
    executionLines = combinedLines.map((line, idx) => {
      const lineGross = line.unitPriceMinor * line.quantity;
      const isLast = idx === combinedLines.length - 1;
      const lineDiscount = isLast ? totalDiscountMinor - allocatedDiscount : Math.round((lineGross / totalGross) * totalDiscountMinor);
      allocatedDiscount += lineDiscount;
      return {
        ...line,
        lineDiscountMinor: lineDiscount,
        lineTotalMinor: lineGross - lineDiscount,
      };
    });
    executionAmountMinor = totalGross - totalDiscountMinor;
  }

  // An approved intent has to become something the agent can actually pay.
  // Deliberately AFTER the decision clock stops: creating the order is
  // execution, not deciding, and billing its round trip to "decision
  // latency" would misreport the gate.
  let execution: { providerOrderId: string; orderId: string; paymentId: string } | null = null;
  let executionError: unknown = null;
  try {
    execution = await executeApprovedPurchase({
      decisionId,
      workflowId,
      amountMinor: executionAmountMinor,
      currency: basket.currency,
      lines: executionLines,
    });
  } catch (error) {
    executionError = error;
    logger.warn(
      { event: "vaanigam.approved_execution_failed", err: error instanceof Error ? error.message : String(error) },
      "Approved intent could not be turned into an internal checkout and provider order",
    );
  }

  // Execution failures never become a second approvable step-up. In
  // particular, UNKNOWN may mean the provider accepted the first order;
  // another checkout could duplicate both charge and reservation.
  if (execution === null) {
    const uncertain = executionError instanceof ExternalPurchaseExecutionError && executionError.executionStatus === "UNKNOWN";
    const refs = executionError instanceof ExternalPurchaseExecutionError ? executionError.refs : null;
    const reasonCode = uncertain ? "PAYMENT_OUTCOME_UNKNOWN" : "EXECUTION_FAILED";
    const explanation = `${evaluation.explanation} ${executionError instanceof Error ? executionError.message : "The approved checkout could not be created."} ${uncertain ? "The existing payment must be reconciled before any new authorization is accepted." : "Nothing was charged; submit a fresh intent after correcting the failure."}`;
    await prisma.decisionRecord.update({
      where: { id: decisionId },
      data: {
        outcome: "DECLINE",
        reasonCode,
        explanation,
        stepUpStatus: null,
        settlementStatus: uncertain ? "UNKNOWN" : "FAILED",
        internalOrderId: refs?.orderId ?? undefined,
        internalPaymentId: refs?.paymentId ?? undefined,
        providerOrderId: refs?.providerOrderId ?? undefined,
      },
    });
    await appendLedgerEvent(prisma, {
      workflowId,
      merchantId: request.merchantId,
      actorType: "COMMERCE",
      actionType: "AGENT_EXECUTION_FAILED_SAFE",
      status: "FAILED",
      conciseReason: explanation.slice(0, 500),
      relatedEntityType: "DecisionRecord",
      relatedEntityId: decisionId,
      executedAt: new Date(),
    });
    return {
      ...approved,
      outcome: "DECLINE",
      reasonCode,
      explanation,
      stepUpUrl: null,
      providerOrderId: refs?.providerOrderId ?? null,
      internalOrderId: refs?.orderId ?? null,
      internalPaymentId: refs?.paymentId ?? null,
    };
  }

  const explanation = `${approved.explanation} A Razorpay order was created through the internal Order, CheckoutSession, and Payment lifecycle.`;
  await prisma.decisionRecord.update({
    where: { id: decisionId },
    data: {
      providerOrderId: execution.providerOrderId,
      internalOrderId: execution.orderId,
      internalPaymentId: execution.paymentId,
      settlementStatus: "AWAITING_PAYMENT",
      explanation,
    },
  });
  return {
    ...approved,
    explanation,
    providerOrderId: execution.providerOrderId,
    internalOrderId: execution.orderId,
    internalPaymentId: execution.paymentId,
  };
}
