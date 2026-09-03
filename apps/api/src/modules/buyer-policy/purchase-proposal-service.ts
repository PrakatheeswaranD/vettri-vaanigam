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
import { AppError } from "../../http/errors.js";
import { appendLedgerEvent, withLedgerConcurrencyRetry } from "../audit/ledger.js";
import { categoryPermitted, resolveBuyerPolicy } from "./resolve-policy.js";

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
}

export interface PurchaseProposalResult {
  id: string;
  amountMinor: number;
  currency: string;
  outcome: "AUTO_APPROVE" | "STEP_UP" | "DECLINE";
  explanation: string;
  requiresApproval: boolean;
  expiresAt: string;
  /** Carried for the conversation, which needs to name what it priced. */
  productId: string;
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
  const amountMinor = variant.priceMinor * input.quantity;
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

  const requiresApproval = amountMinor > policy.autonomousPurchaseLimitMinor;
  if (requiresApproval && !policy.approvalRequiredAboveLimit) reasons.push("AUTONOMOUS_LIMIT_EXCEEDED");

  const outcome = reasons.length ? "DECLINE" : requiresApproval ? "STEP_UP" : "AUTO_APPROVE";
  const explanation = reasons.length
    ? reasons.join(", ")
    : requiresApproval
      ? "Explicit buyer approval is required above the autonomous limit."
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
          { productId: variant.productId, variantId: variant.id, quantity: input.quantity, unitPriceMinor: variant.priceMinor },
        ],
        workflowId: randomUUID(),
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
  };
}
