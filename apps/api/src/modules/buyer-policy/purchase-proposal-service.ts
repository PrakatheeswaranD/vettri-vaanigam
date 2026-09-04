/**
 * Creating a buyer purchase proposal, extracted so there is exactly one.
 *
 * WHY IT MOVED OUT OF THE ROUTE
 *
 * It lived inline in `POST /buyer/purchase-proposals`, which was fine
 * while HTTP was the only way to reach it. Part 9 lets the buyer say "buy
 * the second one" in conversation, and a conversation that built its own
 * proposal would be a SECOND implementation of spending policy — the one
 * nobody tests, quietly diverging from the one they do.
 *
 * So both callers land here. The route parses HTTP and calls this; the
 * conversation resolves an ordinal to a variant and calls this. The
 * spending policy, the category check, the inventory check, the daily
 * limit, the ledger write and the decision record are identical, because
 * they are the same code.
 *
 * WHAT THIS FUNCTION REFUSES TO ACCEPT
 *
 * A price. An amount. A discount. A currency. The caller supplies a
 * variant id and a quantity, and every financial value is computed here
 * from the catalogue row. That was true of the route and it stays true of
 * the conversation — an agent that could name its own total would be an
 * agent that could talk itself into a cheaper one.
 */
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { offerDiscountMinor } from "@razorgrowth/domain";
import { AppError } from "../../http/errors.js";
import { appendLedgerEvent, withLedgerConcurrencyRetry } from "../audit/ledger.js";
import { categoryPermitted, resolveBuyerPolicy } from "./resolve-policy.js";
import { findBuyerVisibleOffers } from "../buyer-agent/offers-service.js";
import { executeExternalAgentPurchase, ExternalPurchaseExecutionError } from "../gateway/execution-service.js";
import { getPayment } from "../payments/payment-service.js";

export interface CreatePurchaseProposalInput {
  /** The shopper's own account. Never a merchant id. */
  buyerContext: string;
  variantId: string;
  quantity: number;
  /** An optional ceiling the buyer stated for THIS purchase, on top of
   * their standing policy. Narrows, never widens. */
  budgetMinor?: number;
  /** The external agent identity the decision is recorded against. */
  agentId: string;
  /** Milliseconds spent deciding, measured by the caller from intake.
   * Passed in rather than measured here so it covers the caller's own
   * parsing too — and so it stays honest about which work it counts. */
  decisionLatencyMs: number;
  /**
   * The workflow this purchase belongs to, when it grew out of one that
   * already exists.
   *
   * ONE JOURNEY, ONE HASH CHAIN.
   *
   * This minted a fresh id unconditionally. A conversation therefore had
   * one workflow for the search, comparison and recommendation, and the
   * purchase it produced got a second, unrelated one — so the buyer's own
   * activity showed a single journey as two disconnected halves, and no
   * chain of custody joined "you recommended this" to "you charged me for
   * it". The conversation passes its own workflow id here so the ledger
   * carries the whole story, intent through capture, on one continuous
   * hash-verifiable timeline.
   *
   * The REST route has no conversation and omits it, which still mints a
   * new one — a direct purchase genuinely is its own workflow.
   */
  workflowId?: string;
}

export interface PurchaseProposalResult {
  id: string;
  /** The FINAL total the buyer will be charged: list price × quantity,
   * minus any merchant-authorized offer. This is the figure the payment
   * provider is asked for. */
  amountMinor: number;
  currency: string;
  outcome: "AUTO_APPROVE" | "STEP_UP" | "DECLINE";
  explanation: string;
  requiresApproval: boolean;
  expiresAt: string;
  /** Carried for the conversation, which needs to name what it priced. */
  productId: string;

  // ── The breakdown a buyer is owed before they authorize ────────────
  //
  // A single total tells a shopper nothing they can check. These are the
  // parts it is made of, every one an integer in minor units, so the
  // arithmetic on screen is the arithmetic that was actually performed.
  productName: string;
  variantTitle: string;
  quantity: number;
  unitPriceMinor: number;
  /** Before any offer. `listTotalMinor - discountMinor === amountMinor`,
   * always, and a test asserts it. */
  listTotalMinor: number;
  discountMinor: number;
  /** What the discount came from, or null when the buyer pays list. Never
   * a marketing string — the merchant's own authorization. */
  appliedOffer: {
    proposalId: string;
    percentageBps: number | null;
    provenance: string;
  } | null;
}

/**
 * A JSON column is `unknown` until something checks it.
 *
 * A malformed row degrades to "no restriction configured" in one obvious
 * place rather than throwing from inside a spending decision — but note
 * which direction that fails: an unreadable RESTRICTION list becomes
 * empty, which permits. That is the correct trade-off only because these
 * columns are written by our own validated update path and never by a
 * buyer's raw input.
 */
function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

export async function createPurchaseProposal(
  prisma: PrismaClient,
  input: CreatePurchaseProposalInput,
): Promise<PurchaseProposalResult> {
  const variant = await prisma.productVariant.findFirst({
    where: { id: input.variantId, active: true, product: { status: "ACTIVE", merchant: { status: "ACTIVE" } } },
    include: { product: true, inventory: true },
  });
  if (!variant) throw AppError.notFound("Active product variant not found.");

  const policy = await resolveBuyerPolicy(input.buyerContext);
  const listTotalMinor = variant.priceMinor * input.quantity;

  /**
   * THE OFFER IS APPLIED HERE, OR THE BUYER IS QUOTED A LIE.
   *
   * Part 9 surfaced merchant-authorized offers to the buyer — a real 5%,
   * ₹224.95 off ₹4,499, traced to an AUTHORIZED governance row. It did not
   * apply them. The buyer read a discount and was charged list price,
   * which is worse than showing no offer at all.
   *
   * RECOMPUTED, NOT COPIED. The merchant's stored `discountMinor` was
   * calculated against THEIR assumed basket. This buyer's basket may be a
   * different quantity, so copying that absolute figure would be right
   * only by coincidence. A percentage offer is recomputed against this
   * actual basket; a fixed-amount offer is capped at it, because a
   * discount larger than the purchase is not a discount, it is a refund
   * nobody authorized.
   *
   * All integer minor units. `Math.round` matches the convention the
   * negotiation service already uses, so two discount paths in the same
   * product cannot round in opposite directions.
   */
  const [offer] = await findBuyerVisibleOffers(prisma, [variant.productId]);
  // PART 18 — the arithmetic moved to `@razorgrowth/domain` so discovery
  // can rank and budget-check on the SAME number the buyer is charged.
  // Two copies would be two chances to disagree, and a buyer shown one
  // price and charged another is worse than either figure alone.
  const discountMinor = offerDiscountMinor(listTotalMinor, offer ?? null);

  // Never negative, never above the basket. Both are structurally
  // impossible above; asserted here because a negative charge is the one
  // arithmetic error that must not survive a refactor.
  const amountMinor = Math.max(0, listTotalMinor - discountMinor);
  const appliedOffer =
    discountMinor > 0 && offer
      ? { proposalId: offer.proposalId, percentageBps: offer.percentageBps, provenance: offer.provenance }
      : null;

  const categories = z.array(z.string()).parse(policy.allowedCategories);

  const reasons: string[] = [];
  if (variant.currency !== policy.currency) reasons.push("POLICY_CURRENCY_MISMATCH");
  // `allowAllCategories` is a real column the shopper set deliberately —
  // never a magic word matched out of `allowedCategories`. A wildcard
  // hidden in user-supplied text is what an injection would aim for, and
  // it makes a deliberate choice indistinguishable from a typo.
  if (!categoryPermitted(policy, variant.product.category, categories)) reasons.push("CATEGORY_NOT_ALLOWED");
  if ((variant.inventory?.availableQuantity ?? 0) < input.quantity) reasons.push("INSUFFICIENT_INVENTORY");
  if (amountMinor > policy.dailyLimitMinor) reasons.push("DAILY_LIMIT_EXCEEDED");
  if (input.budgetMinor !== undefined && amountMinor > input.budgetMinor) reasons.push("BUYER_BUDGET_EXCEEDED");

  // ── PART 12 boundaries ────────────────────────────────────────────
  //
  // All DECLINE conditions, and all checked here rather than anywhere
  // else: this is the one function that prices a purchase, so it is the
  // one place a boundary can be enforced without a second copy to keep
  // in step.

  /**
   * The HARD ceiling, which is not the approval threshold.
   *
   * Above the autonomous limit the buyer is ASKED. Above this they are
   * REFUSED — "how much may the agent spend without me" and "how much am
   * I willing to spend at all" are different questions, and a purchase
   * over the hard maximum is never offered for approval, because
   * approving it was never on the table.
   */
  if (amountMinor > policy.maxPurchaseAmountMinor) reasons.push("MAX_PURCHASE_AMOUNT_EXCEEDED");

  /**
   * Restrictions BEAT permissions, always.
   *
   * Checked after `categoryPermitted` and independent of it: a category
   * on both the allow list and the restricted list is restricted. A
   * prohibition that could be undone by widening an allow list was never
   * a prohibition.
   */
  if (asStringList(policy.restrictedCategories).includes(variant.product.category)) {
    reasons.push("CATEGORY_RESTRICTED");
  }
  if (asStringList(policy.restrictedMerchantIds).includes(variant.product.merchantId)) {
    reasons.push("MERCHANT_RESTRICTED");
  }

  // `preferredCategories` is deliberately NOT consulted here. It is a
  // ranking signal, and enforcing it would silently turn "I prefer
  // running shoes" into "refuse to show me anything else".

  /**
   * Whether the agent may complete a purchase without asking at all.
   *
   * Off makes every purchase a step-up however small — the buyer wants
   * to see each one. It never DECLINES: wanting to approve each purchase
   * is not the same as refusing to make them.
   */
  const requiresApproval = amountMinor > policy.autonomousPurchaseLimitMinor || !policy.autoPurchaseEnabled;
  if (amountMinor > policy.autonomousPurchaseLimitMinor && !policy.approvalRequiredAboveLimit) {
    reasons.push("AUTONOMOUS_LIMIT_EXCEEDED");
  }

  const outcome = reasons.length ? "DECLINE" : requiresApproval ? "STEP_UP" : "AUTO_APPROVE";
  const explanation = reasons.length
    ? reasons.join(", ")
    : requiresApproval
      ? policy.autoPurchaseEnabled
        ? "Explicit buyer approval is required above the autonomous limit."
        : "You asked to approve every purchase, so this one is waiting for you."
      : "Within the saved buyer policy; ready for authorization.";

  const row = await withLedgerConcurrencyRetry(prisma, async (tx) => {
    const proposal = await tx.decisionRecord.create({
      data: {
        merchantId: variant.product.merchantId,
        externalAgentId: input.agentId,
        protocolActorRef: input.buyerContext,
        outcome,
        reasonCode: reasons[0] ?? (requiresApproval ? "BUYER_APPROVAL_REQUIRED" : "BUYER_POLICY_PASSED"),
        explanation,
        computedTotalMinor: amountMinor,
        currency: variant.currency,
        appliedCeilingMinor: policy.autonomousPurchaseLimitMinor,
        permissionType: "NONE",
        authorizationExpiresAt: new Date(Date.now() + 15 * 60_000),
        normalizedBasket: [
          {
            productId: variant.productId,
            variantId: variant.id,
            quantity: input.quantity,
            unitPriceMinor: variant.priceMinor,
            // Recorded on the line so the basket reconstructs the total
            // exactly, rather than leaving a gap between what the line
            // says and what was charged.
            lineDiscountMinor: discountMinor,
          },
        ],
        workflowId: input.workflowId ?? randomUUID(),
        settlementStatus: "PROPOSED",
        decisionLatencyMs: input.decisionLatencyMs,
      },
    });
    await appendLedgerEvent(tx, {
      merchantId: proposal.merchantId,
      workflowId: proposal.workflowId!,
      actorType: "COMMERCE",
      actionType: "BUYER_PURCHASE_PROPOSED",
      status: "EXECUTED",
      conciseReason: explanation,
      relatedEntityType: "DecisionRecord",
      relatedEntityId: proposal.id,
    });
    return proposal;
  });

  return {
    id: row.id,
    amountMinor,
    // `DecisionRecord.currency` is nullable in the schema, but this row was
    // just written with the variant's own currency. Falling back to the
    // variant rather than asserting non-null keeps the type honest without
    // inventing a currency.
    currency: row.currency ?? variant.currency,
    outcome,
    explanation,
    requiresApproval,
    expiresAt: row.authorizationExpiresAt!.toISOString(),
    productId: variant.productId,
    productName: variant.product.name,
    variantTitle: variant.title,
    quantity: input.quantity,
    unitPriceMinor: variant.priceMinor,
    listTotalMinor,
    discountMinor,
    appliedOffer,
  };
}

/* ═══════════════════════════════════════════════════════════════════════
 * AUTHORIZATION — the stage that creates a real payment order
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * The stored basket, as execution will re-price it.
 *
 * `lineDiscountMinor` is part of the shape because a discount is recorded
 * ON the line. Zod strips unknown keys, so omitting it here once silently
 * dropped the discount between proposal and execution, and every
 * discounted purchase was refused as FINANCIAL_INTEGRITY_ERROR. Read from
 * the server's own DecisionRecord, never from a request body.
 */
const authorizationBasketSchema = z
  .array(
    z.object({
      productId: z.string().uuid(),
      variantId: z.string().uuid(),
      quantity: z.number().int().positive(),
      unitPriceMinor: z.number().int().nonnegative(),
      lineDiscountMinor: z.number().int().nonnegative().optional(),
    }),
  )
  .length(1);

/**
 * Carries a priced proposal to a real payment order.
 *
 * WHY THIS IS A SERVICE AND NOT A ROUTE BODY
 *
 * Part 10 lets a buyer say "yes, authorize it" in conversation. A
 * conversation that ran its own version of this would be a SECOND
 * implementation of the daily-allowance reservation, the re-checked
 * spending policy, and the ambiguous-execution handling below — and the
 * one nobody tests is the one that double-charges. Both callers land
 * here.
 *
 * WHAT THIS DOES AND DOES NOT DO
 *
 * It creates an order and a payment in CREATED state with a provider
 * order id. It does NOT take money: the charge requires the buyer to
 * complete the provider's own checkout, which returns a signature the
 * server verifies separately. Authorizing is consent to be asked for
 * payment.
 *
 * Every guard here is preserved exactly as it was in the route: the
 * serializing policy row update, the settlement-status check, the expiry
 * check, the re-checked category and currency and ceiling, the daily
 * allowance including pending purchases, and the deliberate distinction
 * between a rolled-back failure and a genuinely ambiguous one.
 */
export async function authorizePurchaseProposal(
  prisma: PrismaClient,
  input: { buyerContext: string; proposalId: string; agentId: string },
) {
  const row = await prisma.decisionRecord.findFirst({
    where: { id: input.proposalId, externalAgentId: input.agentId, protocolActorRef: input.buyerContext },
  });
  if (!row) throw AppError.notFound("Purchase proposal not found.");

  // Idempotent: a proposal that already produced a payment returns that
  // payment rather than creating a second one.
  if (row.internalPaymentId) return getPayment(prisma, row.merchantId, row.internalPaymentId);

  const lines = authorizationBasketSchema.parse(row.normalizedBasket);

  await withLedgerConcurrencyRetry(prisma, async (tx) => {
    // This row update serializes all purchases for one buyer context before
    // reserving daily allowance, including simultaneous cross-merchant buys.
    const policy = await tx.buyerSpendingPolicy.update({
      where: { customerAccountId: input.buyerContext },
      data: { updatedAt: new Date() },
    });
    const current = await tx.decisionRecord.findUniqueOrThrow({ where: { id: input.proposalId } });
    if (current.settlementStatus !== "PROPOSED") {
      throw AppError.conflict("This proposal was already attempted. Check payment status; do not retry.");
    }
    if (current.outcome === "DECLINE") throw new AppError("POLICY_DENIED", current.explanation);
    if (!current.authorizationExpiresAt || current.authorizationExpiresAt <= new Date()) {
      throw new AppError("AUTHORIZATION_EXPIRED", "Create a fresh proposal; this authorization has expired.");
    }

    const variant = await tx.productVariant.findUniqueOrThrow({
      where: { id: lines[0]!.variantId },
      include: { product: true },
    });
    /**
     * The policy is re-read and re-checked HERE, against the row as it
     * stands now — not as it stood when the proposal was priced.
     *
     * A buyer who restricts a category, lowers their ceiling, or turns
     * off automatic purchasing after a proposal was created must have
     * that apply to the proposal still in flight. Checking only at
     * pricing time would leave a window in which the old policy still
     * governed, and that window is exactly when someone changes their
     * mind.
     *
     * Every PART 12 boundary is re-checked for the same reason.
     */
    const totalMinor = current.computedTotalMinor ?? 0;
    const policyNoLongerPermits =
      !categoryPermitted(policy, variant.product.category, z.array(z.string()).parse(policy.allowedCategories)) ||
      policy.currency !== current.currency ||
      (totalMinor > policy.autonomousPurchaseLimitMinor && !policy.approvalRequiredAboveLimit) ||
      totalMinor > policy.maxPurchaseAmountMinor ||
      asStringList(policy.restrictedCategories).includes(variant.product.category) ||
      asStringList(policy.restrictedMerchantIds).includes(variant.product.merchantId);

    if (policyNoLongerPermits) {
      throw new AppError("POLICY_CHANGED", "The current buyer policy no longer permits this purchase.");
    }

    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);
    const reserved = await tx.decisionRecord.aggregate({
      where: {
        externalAgentId: input.agentId,
        protocolActorRef: input.buyerContext,
        stepUpDecidedAt: { gte: dayStart },
        settlementStatus: { notIn: ["PROPOSED", "FAILED"] },
      },
      _sum: { computedTotalMinor: true },
    });
    if ((reserved._sum.computedTotalMinor ?? 0) + (current.computedTotalMinor ?? 0) > policy.dailyLimitMinor) {
      throw new AppError("POLICY_DENIED", "Daily spending allowance is exhausted, including pending purchases.");
    }

    await tx.decisionRecord.update({
      where: { id: input.proposalId },
      data: {
        settlementStatus: "EXECUTING",
        permissionType: "EXPLICIT_BUYER_APPROVAL",
        stepUpDecidedAt: new Date(),
        authorizationMaxAmountMinor: current.computedTotalMinor,
        authorizationCurrency: current.currency,
        authorizationMerchantScope: current.merchantId,
      },
    });
    await appendLedgerEvent(tx, {
      merchantId: row.merchantId,
      workflowId: row.workflowId!,
      actorType: "COMMERCE",
      actionType: "BUYER_PURCHASE_AUTHORIZED",
      status: "EXECUTED",
      conciseReason: "Buyer explicitly authorized the server-priced basket; daily allowance reserved.",
      relatedEntityType: "DecisionRecord",
      relatedEntityId: input.proposalId,
    });
  });

  try {
    const result = await executeExternalAgentPurchase(prisma, {
      merchantId: row.merchantId,
      decisionId: input.proposalId,
      workflowId: row.workflowId!,
      currency: row.currency!,
      amountMinor: row.computedTotalMinor!,
      lines,
    });
    await prisma.decisionRecord.update({
      where: { id: input.proposalId },
      data: {
        internalOrderId: result.orderId,
        internalPaymentId: result.paymentId,
        providerOrderId: result.providerOrderId,
        settlementStatus: "PAYMENT_PENDING",
      },
    });
    return getPayment(prisma, row.merchantId, result.paymentId);
  } catch (error) {
    // Ambiguous execution consumes the proposal: never re-submit a charge.
    //
    // But only genuinely ambiguous execution. `executeExternalAgentPurchase`
    // raises a plain `AppError` only from inside its opening transaction —
    // repricing, eligibility, stock — which ROLLS BACK, so no cart, order,
    // checkout, payment or reservation exists and no provider was ever
    // called. Filing that as UNKNOWN was wrong twice over: it claims a
    // charge might exist when the rollback proves none does, and because
    // reserved daily allowance counts every status except PROPOSED and
    // FAILED, it permanently consumed the shopper's daily limit for a
    // purchase that never happened. Anything past that transaction arrives
    // as ExternalPurchaseExecutionError carrying the status the payment
    // evidence actually supports; anything else stays UNKNOWN, because an
    // unrecognised failure after a provider call is exactly the case where
    // guessing is unsafe.
    const settlementStatus =
      error instanceof ExternalPurchaseExecutionError
        ? error.executionStatus
        : error instanceof AppError
          ? "FAILED"
          : "UNKNOWN";
    await prisma.decisionRecord.update({
      where: { id: input.proposalId },
      data: {
        settlementStatus,
        ...(error instanceof ExternalPurchaseExecutionError
          ? {
              internalOrderId: error.refs.orderId,
              internalPaymentId: error.refs.paymentId,
              providerOrderId: error.refs.providerOrderId,
            }
          : {}),
      },
    });
    throw error;
  }
}
