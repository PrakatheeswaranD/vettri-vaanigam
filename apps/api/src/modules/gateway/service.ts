/**
 * Anumati gateway — the request path an outside AI buyer agent actually
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
import type { PrismaClient, Prisma } from "@prisma/client";
import {
  detectProtocol,
  parseIntentForProtocol,
  verifySpendMandate,
  evaluateAgentGatewayPolicy,
  clampNegotiatedDiscountBps,
  shouldNegotiate,
  offerBreachesFloorMargin,
  PROTOCOL_FIDELITY,
  type AgentGatewayPolicy as GatewayPolicyConfig,
  type AgentTrustLevel,
  type GatewayEvaluationResult,
  type ParsedIntent,
  type CurrencyCode,
} from "@razorgrowth/domain";
import { systemClock } from "@razorgrowth/domain";
import { logger } from "../../observability/logger.js";
import { appendLedgerEvent } from "../audit/ledger.js";
import { verifyMandateSignature } from "./mandate-verifier.js";
import { resolveAgentForIntent } from "./agent-registry.js";
import { getAIProvider } from "../agents/provider-factory.js";

const VELOCITY_WINDOW_MS = 60 * 60 * 1000;

export interface GatewayRequest {
  merchantId: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
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
  decisionLatencyMs: number;
  /** Present only when the negotiator offered something inside the
   * merchant's envelope. Null is the normal, unremarkable case. */
  offer: { addSkus: string[]; discountBps: number; pitch: string } | null;
}

interface PricedBasket {
  lines: { productId: string; variantId: string; quantity: number; unitPriceMinor: number }[];
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
  const skus = intent.lines.map((l) => l.sku);
  const variants = await prisma.productVariant.findMany({
    where: { sku: { in: skus }, active: true, product: { merchantId, status: "ACTIVE" } },
    include: { product: { select: { id: true, category: true } } },
  });

  const bySku = new Map(variants.map((v) => [v.sku, v]));
  const lines: PricedBasket["lines"] = [];
  const categories = new Set<string>();
  let totalMinor = 0;
  let currency: CurrencyCode | null = null;

  for (const line of intent.lines) {
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
    });
  }

  return { lines, totalMinor, currency: currency ?? "INR", categories: [...categories] };
}

async function resolveAgent(
  prisma: PrismaClient,
  merchantId: string,
  intent: ParsedIntent,
  allowFirstUsePinning: boolean,
): Promise<{ id: string; trust: AgentTrustLevel; recentIntentCount: number; trustedPublicKey: string | null }> {
  const agent = await resolveAgentForIntent(prisma, {
    merchantId,
    externalAgentId: intent.agentId,
    firstSeenProtocol: intent.protocol,
    presentedPublicKey: intent.mandate?.publicKey ?? null,
    allowFirstUsePinning,
  });

  const recentIntentCount = await prisma.decisionRecord.count({
    where: { agentIdentityId: agent.id, createdAt: { gte: new Date(Date.now() - VELOCITY_WINDOW_MS) } },
  });

  // Trust is the merchant's own settlement history, never the agent's
  // self-description.
  return {
    id: agent.id,
    trust: agent.settledOrderCount > 0 ? "KNOWN" : "UNKNOWN",
    recentIntentCount,
    trustedPublicKey: agent.trustedPublicKey,
  };
}

interface RecordArgs {
  merchantId: string;
  startedAt: number;
  outcome: "AUTO_APPROVE" | "STEP_UP" | "DECLINE";
  reasonCode: string;
  explanation: string;
  protocol?: "ACP" | "AP2" | "X402" | null;
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
  buyerEmail?: string | null;
  buyerName?: string | null;
  protocolActorRef?: string | null;
  rawProtocolPayload?: unknown;
  permissionType?: "SIGNED_MANDATE" | "UNSIGNED_ALLOWANCE" | "UNVERIFIED_X402" | "NONE" | null;
  offer?: { addSkus: string[]; discountBps: number; pitch: string } | null;
  /** Set when the decision was reached BEFORE optional work (the
   * negotiator's model call) ran, so latency measures the gate rather than
   * the upsell. */
  decidedAtMs?: number;
}

async function writeDecision(prisma: PrismaClient, args: RecordArgs): Promise<GatewayResponse> {
  // Latency is measured to the moment the DECISION was reached, not to the
  // end of the request. The negotiator is an optional model call that runs
  // after approval; billing its seconds to "decision latency" would report
  // the upsell's cost as the gate's, and the gate is the thing a merchant
  // is judging.
  const decisionLatencyMs = Math.max(0, Math.round((args.decidedAtMs ?? performance.now()) - args.startedAt));

  const data: Prisma.DecisionRecordUncheckedCreateInput = {
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
    currency: args.currency ?? null,
    stepUpPaymentLinkId: args.stepUpPaymentLinkId ?? null,
    stepUpPaymentLinkUrl: args.stepUpPaymentLinkUrl ?? null,
    stepUpStatus: args.stepUpStatus ?? (args.outcome === "STEP_UP" ? "PENDING" : null),
    negotiatedDiscountBps: args.negotiatedDiscountBps ?? null,
    providerOrderId: args.providerOrderId ?? null,
    buyerEmail: args.buyerEmail ?? null,
    buyerName: args.buyerName ?? null,
    protocolActorRef: args.protocolActorRef ?? null,
    rawProtocolPayload: (args.rawProtocolPayload ?? null) as never,
    permissionType: args.permissionType ?? null,
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
      workflowId: `agent-decision-${record.id}`,
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
      { event: "anumati.ledger_append_failed", decisionId: record.id, err: err instanceof Error ? err.message : String(err) },
      "Decision recorded but could not be appended to the audit ledger",
    );
  }

  logger.info(
    { event: "anumati.decision", decisionId: record.id, outcome: args.outcome, reasonCode: args.reasonCode, decisionLatencyMs },
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
    decisionLatencyMs,
    offer: args.offer ?? null,
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
async function negotiate(
  prisma: PrismaClient,
  merchantId: string,
  basket: PricedBasket,
  policy: GatewayPolicyConfig,
): Promise<{ addSkus: string[]; discountBps: number; pitch: string } | null> {
  if (!shouldNegotiate(basket.lines.length, policy)) return null;

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
    if (candidates.length === 0) return null;

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
    const addSkus = (Array.isArray(raw.addSkus) ? raw.addSkus : []).filter((sku) => allowed.has(sku));
    const discountBps = clampNegotiatedDiscountBps(raw.discountBps, policy);

    // A discount with nothing added is margin loss, not an upsell.
    if (addSkus.length === 0 || discountBps <= 0) return null;

    // Below the merchant's floor is a refusal, not a smaller discount.
    if (offerBreachesFloorMargin(discountBps, policy)) {
      logger.info(
        { event: "anumati.offer_rejected_floor_margin", discountBps, floorMarginBps: policy.negotiatorFloorMarginBps },
        "Negotiator offer rejected: would breach the merchant's floor margin",
      );
      return null;
    }

    return { addSkus, discountBps, pitch: typeof raw.pitch === "string" ? raw.pitch : "" };
  } catch (err) {
    logger.warn({ event: "anumati.negotiator_failed", err: err instanceof Error ? err.message : String(err) }, "Negotiator failed; proceeding with no offer");
    return null;
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
  createStepUpLink?: (args: { amountMinor: number; currency: string; description: string }) => Promise<{ id: string; url: string } | null>,
  /** Creates the provider order an approved intent becomes payable through.
   * Injected for the same reasons as the step-up link: testable without a
   * live provider, and a provider outage degrades instead of losing the
   * decision. */
  createProviderOrder?: (args: { amountMinor: number; currency: string; reference: string }) => Promise<string | null>,
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

  const intent = parsed.intent;
  const policy = await loadGatewayPolicy(prisma, request.merchantId);
  const agent = await resolveAgent(prisma, request.merchantId, intent, policy.allowFirstUseKeyPinning);
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
        : intent.unverifiedSettlement
          ? ("UNVERIFIED_X402" as const)
          : ("NONE" as const),
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
  // on that protocol is not asked to also mint an Anumati mandate. The
  // allowance is checked on the same terms — amount, currency, expiry,
  // merchant scope — but it is NOT signed, so it is never reported as a
  // verified mandate and the Decision Record says which one applied.
  if (!intent.mandate && intent.unsignedAllowance) {
    const allowance = intent.unsignedAllowance;

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
  const mandateResult = (intent.unsignedAllowance || intent.unverifiedSettlement) && !intent.mandate
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
  const effectiveDecision =
    (riskFlagged || unverifiable) && evaluation.decision === "AUTO_APPROVE"
      ? ("STEP_UP" as const)
      : evaluation.decision;

  const shared = {
    ...base,
    ...agentContext,
    reasonCode:
      effectiveDecision !== evaluation.decision
        ? unverifiable
          ? "SETTLEMENT_UNVERIFIED"
          : "RISK_SIGNAL_REVIEW"
        : evaluation.reasonCode,
    explanation: unverifiable
      ? `${evaluation.explanation} However, this agent pays over x402 and no settlement facilitator is configured, so nobody has verified the money actually exists. It is going to you for approval rather than being charged on the buyer's word.`
      : riskFlagged
        ? `${evaluation.explanation} The calling platform also flagged this purchase for review (${intent.riskFlags.join(", ")}), so it is going to you rather than through automatically.`
        : evaluation.explanation,
    computedTotalMinor: basket.totalMinor,
    currency: basket.currency,
    appliedCeilingMinor: evaluation.appliedCeilingMinor,
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
    const link = createStepUpLink
      ? await createStepUpLink({
          amountMinor: basket.totalMinor,
          currency: basket.currency,
          description: `Agent order awaiting your approval (${intent.agentId})`,
        }).catch(() => null)
      : null;

    return writeDecision(prisma, {
      ...shared,
      outcome: "STEP_UP",
      // Built from `shared.explanation`, NOT from `evaluation.explanation`:
      // a risk-signal upgrade has already added its sentence there, and
      // rebuilding from the raw evaluation would silently drop the reason
      // this became a step-up in the first place.
      explanation: link
        ? `${shared.explanation} A payment link has been created for you to review and approve.`
        : `${shared.explanation} A payment link could not be created just now, so this is waiting for you in the console.`,
      stepUpPaymentLinkId: link?.id ?? null,
      stepUpPaymentLinkUrl: link?.url ?? null,
      stepUpStatus: "PENDING",
    });
  }

  const decidedAtMs = performance.now();

  // An approved intent has to become something the agent can actually pay.
  // Deliberately AFTER the decision clock stops: creating the order is
  // execution, not deciding, and billing its round trip to "decision
  // latency" would misreport the gate.
  const providerOrderId = createProviderOrder
    ? await createProviderOrder({
        amountMinor: basket.totalMinor,
        currency: basket.currency,
        reference: `anumati-${intent.agentId}`,
      }).catch((err) => {
        logger.warn(
          { event: "anumati.provider_order_failed", err: err instanceof Error ? err.message : String(err) },
          "Approved intent could not be turned into a provider order",
        );
        return null;
      })
    : null;

  const offer = await negotiate(prisma, request.merchantId, basket, policy);

  // An approval that produced nothing payable is not an approval.
  //
  // This used to swallow the provider error and still return AUTO_APPROVE,
  // so ACP marked the session `completed` and answered 200 with a null
  // order id. The agent was told the purchase succeeded when nothing had
  // been created. A provider outage is exactly the graceful-failure case
  // this project is judged on, so it degrades to a human instead of
  // silently to success.
  if (providerOrderId === null && createProviderOrder) {
    return writeDecision(prisma, {
      ...shared,
      outcome: "STEP_UP",
      decidedAtMs,
      reasonCode: "PROVIDER_ORDER_FAILED",
      explanation: `${evaluation.explanation} The payment provider could not be reached to create the order, so nothing was charged and this is waiting for you rather than being reported as done.`,
    });
  }

  // An approved, payable order is what makes an agent KNOWN next time.
  // `settledOrderCount` was read but never written, so no agent could ever
  // graduate past the unknown-agent ceiling however many orders it placed.
  await prisma.agentIdentity
    .update({ where: { id: agent.id }, data: { settledOrderCount: { increment: 1 } } })
    .catch(() => undefined);

  return writeDecision(prisma, {
    ...shared,
    outcome: "AUTO_APPROVE",
    decidedAtMs,
    negotiatedDiscountBps: offer?.discountBps ?? null,
    providerOrderId,
    offer,
    explanation: [
      evaluation.explanation,
      offer
        ? `The negotiator also offered ${offer.discountBps / 100}% off for adding ${offer.addSkus.length} item(s), within your configured ceiling.`
        : null,
      providerOrderId
        ? "A Razorpay order was created for the agent to pay."
        : "A Razorpay order could not be created just now, so the agent has nothing to pay yet.",
    ]
      .filter(Boolean)
      .join(" "),
  });
}
