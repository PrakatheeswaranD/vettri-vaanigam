/**
 * Customer negotiation, against the database.
 *
 * The arithmetic lives in `@razorgrowth/domain`; this reads the history it
 * needs, writes the outcome, and does neither of those things in a way
 * that lets the client influence the answer.
 *
 * THREE THINGS THE CLIENT CANNOT DO
 *
 * 1. State its own history. The tier is derived here, from settled
 *    proposals in this buyer's own record. A request body carrying
 *    "tier: VIP" is ignored because there is no such field to send.
 *
 * 2. State the basket total. The discount is computed against the price
 *    the SERVER already put on this proposal, which was itself priced from
 *    the merchant's catalogue.
 *
 * 3. Negotiate twice. A proposal that has already been negotiated is
 *    refused rather than re-discounted — otherwise the obvious attack is
 *    to call this endpoint in a loop.
 */
import type { PrismaClient, Prisma } from "@prisma/client";
import {
  computeCustomerStanding,
  evaluateNegotiation,
  DEFAULT_NEGOTIATION_POLICY,
  type CustomerHistory,
  type CustomerStanding,
  type NegotiationPolicy,
  type NegotiationDecision,
  type CurrencyCode,
} from "@razorgrowth/domain";
import { AppError } from "../../http/errors.js";
import { appendLedgerEvent, withLedgerConcurrencyRetry } from "../audit/ledger.js";
import { logger } from "../../observability/logger.js";

/** The synthetic agent id every customer-initiated proposal is written under. */
export const CUSTOMER_AGENT_ID = "customer-buyer-agent";

/** Settlement states that mean the customer actually paid.
 *
 * Exported so a test resetting a shopper's history cannot drift from the
 * list this service actually counts: `customer-negotiation.test.ts` reset
 * only SETTLED and REFUNDED, missed CAPTURED — the status a REAL purchase
 * produces — and so any genuine run of the product's own demo left the
 * shared demo shopper promoted and broke three of its assertions. */
export const SETTLED_STATUSES = ["SETTLED", "CAPTURED", "PAYMENT_CAPTURED"] as const;
/** States that mean money came back, or was contested. Exported for the
 * same reason as `SETTLED_STATUSES`. */
export const DISPUTED_STATUSES = ["REFUNDED", "DISPUTED", "CHARGEBACK"] as const;

/**
 * A customer's record with this merchant, derived from proposals already
 * written. No new counter, nothing to keep in sync, and nothing a client
 * can assert.
 */
export async function loadCustomerHistory(
  prisma: PrismaClient,
  buyerContext: string,
  merchantId: string,
): Promise<CustomerHistory> {
  const where: Prisma.DecisionRecordWhereInput = {
    externalAgentId: CUSTOMER_AGENT_ID,
    protocolActorRef: buyerContext,
    merchantId,
  };

  const [settled, disputed] = await Promise.all([
    prisma.decisionRecord.findMany({
      where: { ...where, settlementStatus: { in: [...SETTLED_STATUSES] } },
      select: { computedTotalMinor: true },
    }),
    prisma.decisionRecord.count({
      where: { ...where, settlementStatus: { in: [...DISPUTED_STATUSES] } },
    }),
  ]);

  return {
    settledOrders: settled.length,
    lifetimeSpendMinor: settled.reduce((sum, row) => sum + (row.computedTotalMinor ?? 0), 0),
    disputedOrders: disputed,
  };
}

/**
 * The merchant's negotiation envelope.
 *
 * An unconfigured merchant gets the conservative library defaults rather
 * than an open door — the same rule the gateway policy follows.
 */
export async function loadNegotiationPolicy(
  prisma: PrismaClient,
  merchantId: string,
): Promise<NegotiationPolicy & { automationEnabled: boolean }> {
  const row = await prisma.agentGatewayPolicy.findUnique({ where: { merchantId } });
  if (!row) return { ...DEFAULT_NEGOTIATION_POLICY, automationEnabled: true };

  return {
    maxNegotiableDiscountBps: row.negotiationMaxDiscountBps,
    autoApplyCeilingBps: row.negotiationAutoApplyCeilingBps,
    maxAutoApplyDiscountMinor: row.negotiationMaxAutoApplyMinor,
    // Deliberately the SAME floor the merchant-side negotiator honours.
    // Two floors would be two answers to one question.
    floorMarginBps: row.negotiatorFloorMarginBps,
    currency: row.currency as CurrencyCode,
    automationEnabled: row.negotiationAutomationEnabled,
  };
}

interface BasketLine {
  productId: string;
  variantId: string;
  quantity: number;
  unitPriceMinor: number;
  /** Server-computed money taken off this line by a negotiation. */
  lineDiscountMinor?: number;
}

/**
 * Write an applied discount ONTO the basket lines.
 *
 * Execution re-prices the basket from the catalogue and refuses to charge
 * unless the lines reproduce the authorized total exactly
 * (`executeExternalAgentPurchase`). Recording only the discounted TOTAL
 * and leaving the lines at list price makes those two disagree by exactly
 * the discount, so every successfully negotiated purchase was then
 * rejected at authorization as FINANCIAL_INTEGRITY_ERROR — the check
 * doing its job against a basket this function had failed to update.
 *
 * The discount is apportioned by line subtotal, with the rounding
 * remainder placed on the last line so the parts sum to the whole in
 * integer minor units. Nothing here is client-supplied: the total comes
 * from the deterministic policy decision, and the lines come from the
 * stored proposal.
 */
function applyLineDiscounts(lines: BasketLine[], totalDiscountMinor: number): BasketLine[] {
  if (totalDiscountMinor <= 0 || lines.length === 0) return lines;
  const subtotals = lines.map((line) => line.unitPriceMinor * line.quantity);
  const subtotal = subtotals.reduce((sum, value) => sum + value, 0);
  if (subtotal <= 0) return lines;

  let assigned = 0;
  return lines.map((line, index) => {
    const share =
      index === lines.length - 1
        ? totalDiscountMinor - assigned
        : Math.floor((totalDiscountMinor * subtotals[index]!) / subtotal);
    assigned += share;
    return { ...line, lineDiscountMinor: share };
  });
}

/**
 * What this basket cost the merchant.
 *
 * Returns null when ANY line has no recorded cost. A partially-known cost
 * is worse than an unknown one: it produces a margin figure that looks
 * authoritative and is wrong low, which is the direction that gives money
 * away.
 */
async function basketCostMinor(prisma: PrismaClient, lines: BasketLine[]): Promise<number | null> {
  if (lines.length === 0) return null;
  const variants = await prisma.productVariant.findMany({
    where: { id: { in: lines.map((line) => line.variantId) } },
    select: { id: true, costMinor: true },
  });
  const costById = new Map(variants.map((v) => [v.id, v.costMinor]));

  let total = 0;
  for (const line of lines) {
    const cost = costById.get(line.variantId);
    if (cost === null || cost === undefined) return null;
    total += cost * line.quantity;
  }
  return total;
}

export interface NegotiationResult {
  proposalId: string;
  outcome: NegotiationDecision["outcome"];
  reasonCode: NegotiationDecision["reasonCode"];
  explanation: string;
  requestedDiscountBps: number | null;
  appliedDiscountBps: number;
  appliedDiscountMinor: number;
  originalTotalMinor: number;
  finalTotalMinor: number;
  counterOfferBps: number;
  counterOfferMinor: number;
  cappedByAmount: boolean;
  standing: CustomerStanding;
  currency: string;
  /** True while a merchant still has to answer. */
  awaitingMerchant: boolean;
}

/**
 * Runs a negotiation against one proposal.
 *
 * The whole decision is taken inside a transaction that re-reads the
 * proposal, so two concurrent calls cannot both see "not yet negotiated"
 * and both apply a discount.
 */
export async function negotiateProposal(
  prisma: PrismaClient,
  args: { proposalId: string; buyerContext: string; requestedDiscountBps: number | null },
): Promise<NegotiationResult> {
  const proposal = await prisma.decisionRecord.findFirst({
    where: { id: args.proposalId, externalAgentId: CUSTOMER_AGENT_ID, protocolActorRef: args.buyerContext },
  });
  if (!proposal) throw AppError.notFound("Purchase proposal not found.");

  if (proposal.settlementStatus !== "PROPOSED") {
    throw AppError.conflict("This purchase has already been authorized. A price cannot be renegotiated after that.");
  }
  if (proposal.negotiationStatus) {
    throw AppError.conflict("This purchase has already been negotiated once. Start a fresh proposal to try again.");
  }
  if (proposal.outcome === "DECLINE") {
    throw new AppError("POLICY_DENIED", "This purchase was declined by policy, so there is no price to negotiate.");
  }

  const [history, policy] = await Promise.all([
    loadCustomerHistory(prisma, args.buyerContext, proposal.merchantId),
    loadNegotiationPolicy(prisma, proposal.merchantId),
  ]);

  const standing = computeCustomerStanding(history);
  const originalTotalMinor = proposal.computedTotalMinor ?? 0;
  const lines = (proposal.normalizedBasket as unknown as BasketLine[] | null) ?? [];
  const costMinor = await basketCostMinor(prisma, lines);

  // With automation off, every request goes to a human — modelled by an
  // auto-apply ceiling of zero rather than by a separate code path, so
  // there is only one place where the outcome is decided.
  const effectivePolicy: NegotiationPolicy = policy.automationEnabled
    ? policy
    : { ...policy, autoApplyCeilingBps: 0, maxAutoApplyDiscountMinor: 0 };

  const decision = evaluateNegotiation({
    requestedDiscountBps: args.requestedDiscountBps,
    standing,
    basketTotalMinor: originalTotalMinor,
    basketCostMinor: costMinor,
    policy: effectivePolicy,
  });

  const status =
    decision.outcome === "AUTO_APPLIED"
      ? "AUTO_APPLIED"
      : decision.outcome === "PROPOSED_TO_MERCHANT"
        ? "PENDING_MERCHANT"
        : "DECLINED";

  await withLedgerConcurrencyRetry(prisma, async (tx) => {
    // Re-read inside the transaction: two concurrent calls must not both
    // find this un-negotiated and both apply a discount.
    const fresh = await tx.decisionRecord.findUniqueOrThrow({ where: { id: proposal.id } });
    if (fresh.negotiationStatus) {
      throw AppError.conflict("This purchase has already been negotiated once.");
    }
    if (fresh.settlementStatus !== "PROPOSED") {
      throw AppError.conflict("This purchase has already been authorized.");
    }

    await tx.decisionRecord.update({
      where: { id: proposal.id },
      data: {
        negotiationRequestedBps: args.requestedDiscountBps,
        negotiationStatus: status,
        negotiationExplanation: decision.explanation,
        customerTierAtDecision: standing.tier,
        // Always recorded, even when nothing was applied, so the baseline
        // is present on every negotiated row rather than only the
        // discounted ones.
        preNegotiationTotalMinor: originalTotalMinor,
        ...(decision.outcome === "AUTO_APPLIED"
          ? {
              negotiatedDiscountBps: decision.appliedDiscountBps,
              computedTotalMinor: decision.finalTotalMinor,
              // The authorization envelope has to move with the price, or
              // the later authorize step compares against a stale number.
              authorizationMaxAmountMinor: decision.finalTotalMinor,
              // ...and so does the BASKET. Execution re-prices from the
              // catalogue and refuses any basket that does not reproduce
              // the authorized total, so a discount recorded only as a
              // total is a purchase that can never be executed.
              normalizedBasket: applyLineDiscounts(
                lines,
                originalTotalMinor - decision.finalTotalMinor,
              ) as unknown as Prisma.InputJsonValue,
            }
          : {}),
      },
    });

    await appendLedgerEvent(tx, {
      merchantId: proposal.merchantId,
      workflowId: proposal.workflowId ?? `negotiation-${proposal.id}`,
      // POLICY_ENGINE, not COMMERCE: this is a deterministic policy
      // decision about what may be given away, not an execution step.
      actorType: "POLICY_ENGINE",
      actionType:
        decision.outcome === "AUTO_APPLIED"
          ? "CUSTOMER_NEGOTIATION_AUTO_APPLIED"
          : decision.outcome === "PROPOSED_TO_MERCHANT"
            ? "CUSTOMER_NEGOTIATION_PROPOSED"
            : "CUSTOMER_NEGOTIATION_DECLINED",
      status: "EXECUTED",
      conciseReason: decision.explanation,
      relatedEntityType: "DecisionRecord",
      relatedEntityId: proposal.id,
      metadata: {
        tier: standing.tier,
        requestedBps: args.requestedDiscountBps,
        entitledBps: decision.entitledDiscountBps,
        appliedBps: decision.appliedDiscountBps,
        appliedMinor: decision.appliedDiscountMinor,
        cappedByAmount: decision.cappedByAmount,
        reasonCode: decision.reasonCode,
      },
    });
  });

  logger.info(
    {
      event: "vettri_vaanigam.customer_negotiation",
      proposalId: proposal.id,
      tier: standing.tier,
      requestedBps: args.requestedDiscountBps,
      appliedBps: decision.appliedDiscountBps,
      outcome: decision.outcome,
      cappedByAmount: decision.cappedByAmount,
    },
    decision.explanation,
  );

  return {
    proposalId: proposal.id,
    outcome: decision.outcome,
    reasonCode: decision.reasonCode,
    explanation: decision.explanation,
    requestedDiscountBps: args.requestedDiscountBps,
    appliedDiscountBps: decision.appliedDiscountBps,
    appliedDiscountMinor: decision.appliedDiscountMinor,
    originalTotalMinor,
    finalTotalMinor: decision.finalTotalMinor,
    counterOfferBps: decision.counterOfferBps,
    counterOfferMinor: decision.counterOfferMinor,
    cappedByAmount: decision.cappedByAmount,
    standing,
    currency: proposal.currency ?? "INR",
    awaitingMerchant: decision.outcome === "PROPOSED_TO_MERCHANT",
  };
}

/**
 * A merchant answering a negotiation that was escalated to them.
 *
 * Approving grants the amount the CUSTOMER ASKED FOR, re-checked against
 * the merchant's hard maximum at the moment of approval — a policy tightened
 * while the request was queued must bind, otherwise the queue becomes a way
 * to lock in yesterday's looser rules.
 */
export async function decideNegotiation(
  prisma: PrismaClient,
  args: { proposalId: string; merchantId: string; approve: boolean; decidedByUserId: string },
): Promise<{ proposalId: string; status: string; appliedDiscountBps: number; finalTotalMinor: number; explanation: string }> {
  const policy = await loadNegotiationPolicy(prisma, args.merchantId);

  return withLedgerConcurrencyRetry(prisma, async (tx) => {
    const proposal = await tx.decisionRecord.findFirst({
      where: { id: args.proposalId, merchantId: args.merchantId, externalAgentId: CUSTOMER_AGENT_ID },
    });
    if (!proposal) throw AppError.notFound("Negotiation not found.");
    if (proposal.negotiationStatus !== "PENDING_MERCHANT") {
      throw AppError.conflict("This negotiation is not waiting on you.");
    }
    if (proposal.settlementStatus !== "PROPOSED") {
      throw AppError.conflict("This purchase has already been authorized.");
    }

    const original = proposal.preNegotiationTotalMinor ?? proposal.computedTotalMinor ?? 0;

    if (!args.approve) {
      const explanation = "The merchant reviewed this request and kept the original price.";
      await tx.decisionRecord.update({
        where: { id: proposal.id },
        data: { negotiationStatus: "MERCHANT_REJECTED", negotiationExplanation: explanation },
      });
      await appendLedgerEvent(tx, {
        merchantId: args.merchantId,
        workflowId: proposal.workflowId ?? `negotiation-${proposal.id}`,
        actorType: "MERCHANT_USER",
        actionType: "CUSTOMER_NEGOTIATION_REJECTED",
        status: "EXECUTED",
        conciseReason: explanation,
        relatedEntityType: "DecisionRecord",
        relatedEntityId: proposal.id,
        metadata: { decidedByUserId: args.decidedByUserId, requestedBps: proposal.negotiationRequestedBps },
      });
      return { proposalId: proposal.id, status: "MERCHANT_REJECTED", appliedDiscountBps: 0, finalTotalMinor: original, explanation };
    }

    // Re-clamped at approval time, not at request time.
    const requested = proposal.negotiationRequestedBps ?? 0;
    const granted = Math.max(0, Math.min(requested, policy.maxNegotiableDiscountBps));
    const discountMinor = Math.round((original * granted) / 10_000);
    const finalTotalMinor = original - discountMinor;

    const explanation =
      granted < requested
        ? `The merchant approved this, reduced to the ${(granted / 100).toFixed(0)}% they will negotiate to.`
        : `The merchant approved ${(granted / 100).toFixed(0)}% off this order.`;

    await tx.decisionRecord.update({
      where: { id: proposal.id },
      data: {
        negotiationStatus: "MERCHANT_APPROVED",
        negotiationExplanation: explanation,
        negotiatedDiscountBps: granted,
        computedTotalMinor: finalTotalMinor,
        authorizationMaxAmountMinor: finalTotalMinor,
      },
    });

    await appendLedgerEvent(tx, {
      merchantId: args.merchantId,
      workflowId: proposal.workflowId ?? `negotiation-${proposal.id}`,
      actorType: "MERCHANT_USER",
      actionType: "CUSTOMER_NEGOTIATION_APPROVED",
      status: "EXECUTED",
      conciseReason: explanation,
      relatedEntityType: "DecisionRecord",
      relatedEntityId: proposal.id,
      metadata: {
        decidedByUserId: args.decidedByUserId,
        requestedBps: requested,
        grantedBps: granted,
        givenAwayMinor: discountMinor,
      },
    });

    return { proposalId: proposal.id, status: "MERCHANT_APPROVED", appliedDiscountBps: granted, finalTotalMinor, explanation };
  });
}

/** Negotiations waiting on this merchant. */
export async function listPendingNegotiations(prisma: PrismaClient, merchantId: string) {
  const rows = await prisma.decisionRecord.findMany({
    where: { merchantId, negotiationStatus: "PENDING_MERCHANT" },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      negotiationRequestedBps: true,
      negotiationExplanation: true,
      customerTierAtDecision: true,
      preNegotiationTotalMinor: true,
      computedTotalMinor: true,
      currency: true,
      createdAt: true,
    },
  });

  return rows.map((row) => {
    const original = row.preNegotiationTotalMinor ?? row.computedTotalMinor ?? 0;
    const requestedBps = row.negotiationRequestedBps ?? 0;
    return {
      id: row.id,
      requestedDiscountBps: requestedBps,
      // Shown in rupees as well as percent: a merchant decides on what
      // leaves their account, not on a percentage.
      requestedDiscountMinor: Math.round((original * requestedBps) / 10_000),
      originalTotalMinor: original,
      wouldBecomeMinor: original - Math.round((original * requestedBps) / 10_000),
      customerTier: row.customerTierAtDecision,
      explanation: row.negotiationExplanation,
      currency: row.currency,
      createdAt: row.createdAt.toISOString(),
    };
  });
}
