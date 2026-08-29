/**
 * CommerceExecutionService (PART 06 §52-§53, §158-§159).
 *
 * The ONLY place an `ExecutionAuthorization` becomes real commerce state.
 * Reuses PART 05's authorization/proposal machinery for validation and
 * consumption (never a second authorization system, §159) and PART 05's
 * ledger writer for every event. Never imports an AI provider, never
 * calls a payment provider, never accepts a client-submitted price,
 * discount, or total (§6, §91).
 */
import { randomUUID } from "node:crypto";
import type { GrowthActionProposal, Prisma, PrismaClient } from "@prisma/client";
import type { CheckoutResponseDTO, CommerceExecutionRequestDTO } from "@razorgrowth/contracts";
import {
  CHECKOUT_VALIDITY_MINUTES,
  isPurchasable,
  lineSourceForRole,
  orderSourceForActionType,
  resolveAuthorizedSelection,
  systemClock,
  type GrowthActionType,
  type OfferTerms,
  type ResolvedCommerceLine,
} from "@razorgrowth/domain";
import { AppError } from "../../http/errors.js";
import { logger } from "../../observability/logger.js";
import { appendLedgerEvent, withLedgerConcurrencyRetry } from "../audit/ledger.js";
import {
  consumeExecutionAuthorization,
  findExecutionAuthorizationById,
  findLatestPolicyEvaluation,
  findProposalForGovernance,
} from "../policy/repository.js";
import { fingerprintFromProposal } from "../policy/service.js";
import { createCommerceGateway, type AuthoritativeCommerceVariant } from "./gateway.js";
import { calculateCartTotals } from "./pricing-service.js";
import { computeOrderFingerprint, ORDER_FINGERPRINT_VERSION } from "./order-fingerprint.js";
import { createCartWithItems, updateCartStatus } from "./cart-repository.js";
import { createOrderWithItems, setOrderFingerprint } from "./order-repository.js";
import { createCheckoutSession, updateCheckoutStatus } from "./checkout-repository.js";
import {
  COMMERCE_CHECKOUT_OPERATION,
  computeIdempotencyFingerprint,
  createIdempotencyRecord,
  findIdempotencyRecord,
  isIdempotencyUniqueConflict,
} from "./idempotency.js";

/** Signals a real, expected conflict from inside the transaction (an
 * authorization consumed by a concurrent request) — distinct from a
 * ledger sequence race, which `withLedgerConcurrencyRetry` retries
 * automatically; this must propagate as a 409, never be retried away. */
class AuthorizationConsumedRaceError extends Error {}

interface RehydratedLine extends ResolvedCommerceLine {
  variantId: string;
  productName: string;
  variantTitle: string;
  unitPriceMinor: number;
  currency: string;
  /** The product-level reference price PART 04/05 actually authorized
   * against — see `AuthoritativeCommerceProduct.priceRangeMinMinor`. Used
   * only for staleness comparison, never for the actual charged amount. */
  priceRangeMinMinor: number | null;
}

async function rehydrateLine(
  gateway: ReturnType<typeof createCommerceGateway>,
  merchantId: string,
  line: ResolvedCommerceLine,
  buyerSelection: { productId: string; variantId: string },
): Promise<RehydratedLine> {
  const product = await gateway.getAuthoritativeProduct(merchantId, line.productId);
  if (!product) {
    throw new AppError("PRODUCT_NOT_ELIGIBLE", `Product ${line.productId} is no longer agent-visible or does not belong to this merchant.`);
  }

  let variant: AuthoritativeCommerceVariant | undefined;
  if (line.productId === buyerSelection.productId) {
    // The buyer's own explicit variant choice — never substituted.
    variant = product.variants.find((v) => v.variantId === buyerSelection.variantId);
    if (!variant) {
      throw new AppError("PRODUCT_NOT_ELIGIBLE", `Selected variant is not a valid variant of ${product.name}.`);
    }
  } else {
    // An authorized added/replacement product the buyer never chose a
    // specific variant for — deterministically pick the CHEAPEST active,
    // purchasable variant (ties broken by variantId). This matches
    // exactly how PART 04/05 derived this same product's price when the
    // proposal/policy evaluation ran (`commerce.priceRange.minMinor`,
    // `agent-commerce/mapper.ts`) — picking any other variant here would
    // make the current subtotal disagree with what was actually
    // authorized for no real reason.
    const purchasable = product.variants.filter((v) => v.active && isPurchasable(v.availabilityState));
    variant = purchasable.sort((a, b) => a.priceMinor - b.priceMinor || a.variantId.localeCompare(b.variantId))[0];
    if (!variant) {
      throw new AppError("INSUFFICIENT_INVENTORY", `No purchasable variant is currently available for ${product.name}.`);
    }
  }

  if (!variant.active) {
    throw new AppError("PRODUCT_NOT_ELIGIBLE", `${product.name}'s selected variant is no longer active.`);
  }
  if ((variant.availableQuantity ?? 0) < line.quantity) {
    throw new AppError("INSUFFICIENT_INVENTORY", `Insufficient inventory for ${product.name} (${variant.title}): requested ${line.quantity}.`);
  }

  return {
    ...line,
    variantId: variant.variantId,
    productName: product.name,
    variantTitle: variant.title,
    unitPriceMinor: variant.priceMinor,
    currency: variant.currency,
    priceRangeMinMinor: product.priceRangeMinMinor,
  };
}

function offerTermsFromProposal(proposal: GrowthActionProposal): OfferTerms | null {
  if (!proposal.offerKind) return null;
  return { kind: proposal.offerKind, percentageBps: proposal.offerPercentageBps, amountMinor: proposal.offerAmountMinor };
}

export async function executeAuthorizedSelection(
  prisma: PrismaClient,
  merchantId: string,
  customerId: string | null,
  request: CommerceExecutionRequestDTO,
): Promise<CheckoutResponseDTO> {
  const requestFingerprint = computeIdempotencyFingerprint(request);

  const existingIdempotency = await findIdempotencyRecord(prisma, merchantId, COMMERCE_CHECKOUT_OPERATION, request.idempotencyKey);
  if (existingIdempotency) {
    if (existingIdempotency.requestFingerprint !== requestFingerprint) {
      throw new AppError("IDEMPOTENCY_CONFLICT", "This idempotency key was already used for a different commerce execution request.");
    }
    logger.info({ event: "commerce.idempotency_reused", merchantId, idempotencyKey: request.idempotencyKey }, "Idempotent commerce execution retry");
    return existingIdempotency.responseSnapshot as unknown as CheckoutResponseDTO;
  }

  const now = systemClock.now();
  const authorization = await findExecutionAuthorizationById(prisma, merchantId, request.authorizationId);
  if (!authorization) throw AppError.notFound(`Execution authorization not found: ${request.authorizationId}`);

  if (authorization.status === "CONSUMED") {
    throw new AppError("AUTHORIZATION_ALREADY_CONSUMED", "This execution authorization has already been consumed by a prior checkout.");
  }
  if (authorization.status !== "ACTIVE") {
    throw new AppError("AUTHORIZATION_NOT_ALLOWED", `Execution authorization is not active (status: ${authorization.status}).`);
  }
  if (authorization.expiresAt.getTime() <= now.getTime()) {
    throw new AppError("AUTHORIZATION_EXPIRED", "Execution authorization has expired.");
  }

  const proposal = await findProposalForGovernance(prisma, merchantId, authorization.proposalId);
  if (!proposal || !proposal.actionType) {
    throw AppError.conflict("The authorized proposal could not be loaded.");
  }
  if (fingerprintFromProposal(proposal) !== authorization.proposalFingerprint) {
    throw new AppError("PROPOSAL_CHANGED", "The authorized proposal has changed since authorization was issued.");
  }

  const actionType = proposal.actionType as GrowthActionType;
  const resolved = resolveAuthorizedSelection(actionType, proposal.primaryProductId, proposal.relatedProductIds as string[], {
    productId: request.selection.productId,
    quantity: request.selection.quantity,
  });
  if (!resolved.ok) {
    throw new AppError("AUTHORIZATION_NOT_ALLOWED", resolved.reason);
  }

  const financialBounds = authorization.financialBounds as { currency: string };
  const gateway = createCommerceGateway(prisma);

  const rehydratedLines: RehydratedLine[] = [];
  for (const line of resolved.lines) {
    const rehydrated = await rehydrateLine(gateway, merchantId, line, request.selection);
    if (rehydrated.currency !== financialBounds.currency) {
      throw new AppError("COMMERCE_STATE_CHANGED", `${rehydrated.productName}'s currency no longer matches the authorized currency.`);
    }
    rehydratedLines.push(rehydrated);
  }

  // PART 06 §16-§17, §95 — the authorized offer's base amount is locked to
  // the product-level reference price PART 04/05 actually evaluated
  // against (`priceRangeMinMinor` — the same "cheapest variant not
  // explicitly UNAVAILABLE" figure `agent-commerce` computes, which can
  // legitimately differ from the specific purchasable variant being
  // charged without anything having actually changed). If THAT reference
  // has moved, the offer is genuinely stale and must not silently
  // recompute against unrelated numbers; if it hasn't, the authorized
  // bps/amount is applied fresh to the real line total being charged
  // (never a client-submitted value, never re-decided by AI).
  const offerTerms = offerTermsFromProposal(proposal);
  if (offerTerms) {
    const eligibleLine = rehydratedLines.find((l) => l.offerEligible);
    const offerCalc = proposal.offerCalculation as { baseAmountMinor: number } | null;
    if (eligibleLine && offerCalc && eligibleLine.priceRangeMinMinor !== offerCalc.baseAmountMinor) {
      throw new AppError("PRICE_CHANGED", `The price of ${eligibleLine.productName} has changed since this offer was authorized.`);
    }
  }

  const totals = calculateCartTotals(
    financialBounds.currency,
    rehydratedLines.map((l) => ({ variantId: l.variantId, productId: l.productId, unitPriceMinor: l.unitPriceMinor, quantity: l.quantity, offerEligible: l.offerEligible })),
    offerTerms,
    now,
  );

  // PART 06 §95, §160 — same reference-price basis as the offer check
  // above: compare the SUM of each line's product-level reference price
  // (what policy actually evaluated) to what policy recorded, not the
  // actual purchasable-variant total being charged (which can validly
  // differ without any real change — see the comment above).
  const policyEvaluation = await findLatestPolicyEvaluation(prisma, proposal.id);
  const evaluatedOrderAmount = (policyEvaluation?.evaluatedValues as { orderAmountMinor?: number | null } | null)?.orderAmountMinor ?? null;
  if (evaluatedOrderAmount !== null) {
    const referenceSubtotal = rehydratedLines.reduce((sum, l) => sum + (l.priceRangeMinMinor ?? l.unitPriceMinor) * l.quantity, 0);
    if (referenceSubtotal !== evaluatedOrderAmount) {
      throw new AppError("COMMERCE_STATE_CHANGED", "The current basket amount no longer matches what policy evaluated for this authorization.");
    }
  }

  const workflowId = proposal.traceId;
  const traceId = randomUUID();

  try {
    const response = await withLedgerConcurrencyRetry(prisma, async (tx) => {
      await appendLedgerEvent(tx, {
        workflowId,
        merchantId,
        actorType: "CUSTOMER",
        actionType: "COMMERCE_EXECUTION_REQUESTED",
        status: "EXECUTED",
        conciseReason: `Commerce execution requested for ${actionType} authorization ${authorization.id}.`,
        relatedEntityType: "ExecutionAuthorization",
        relatedEntityId: authorization.id,
        metadata: { authorizationId: authorization.id, traceId },
        executedAt: now,
      });
      await appendLedgerEvent(tx, {
        workflowId,
        merchantId,
        actorType: "SYSTEM",
        actionType: "AUTHORIZATION_VALIDATED",
        status: "EXECUTED",
        conciseReason: "Authorization validated: ACTIVE, unexpired, fingerprint-matched against the current proposal.",
        relatedEntityType: "ExecutionAuthorization",
        relatedEntityId: authorization.id,
        executedAt: now,
      });

      const cartId = randomUUID();
      const cart = await createCartWithItems(tx, {
        id: cartId,
        merchantId,
        customerId,
        currency: financialBounds.currency,
        items: rehydratedLines.map((l) => ({
          variantId: l.variantId,
          quantity: l.quantity,
          unitPriceMinor: l.unitPriceMinor,
          lineDiscountMinor: totals.lines.find((t) => t.variantId === l.variantId)!.lineDiscountMinor,
          currency: l.currency,
          source: lineSourceForRole(l.role, actionType),
          growthProposalId: proposal.id,
        })),
      });
      await appendLedgerEvent(tx, {
        workflowId,
        merchantId,
        actorType: "COMMERCE",
        actionType: "CART_CREATED",
        status: "EXECUTED",
        conciseReason: `Cart created with ${rehydratedLines.length} line item(s).`,
        relatedEntityType: "Cart",
        relatedEntityId: cart.id,
        executedAt: now,
      });
      await updateCartStatus(tx, cart.id, "CHECKOUT_PENDING");

      if (offerTerms) {
        await appendLedgerEvent(tx, {
          workflowId,
          merchantId,
          actorType: "COMMERCE",
          actionType: "AUTHORIZED_OFFER_APPLIED",
          status: "EXECUTED",
          conciseReason: `Applied the authorized offer: discount ${totals.discountMinor} minor units.`,
          relatedEntityType: "GrowthActionProposal",
          relatedEntityId: proposal.id,
          metadata: { discountMinor: totals.discountMinor },
          executedAt: now,
        });
      }

      const consumed = await consumeExecutionAuthorization(tx, authorization.id);
      if (!consumed) {
        throw new AuthorizationConsumedRaceError("Execution authorization was consumed by a concurrent request.");
      }
      await appendLedgerEvent(tx, {
        workflowId,
        merchantId,
        actorType: "SYSTEM",
        actionType: "EXECUTION_AUTHORIZATION_CONSUMED",
        status: "EXECUTED",
        conciseReason: "Execution authorization consumed for this commerce execution.",
        relatedEntityType: "ExecutionAuthorization",
        relatedEntityId: authorization.id,
        executedAt: now,
      });

      const orderId = randomUUID();
      const order = await createOrderWithItems(tx, {
        id: orderId,
        merchantId,
        customerId,
        currency: financialBounds.currency,
        totalAmountMinor: totals.totalMinor,
        source: orderSourceForActionType(actionType),
        growthProposalId: proposal.id,
        authorizationId: authorization.id,
        items: rehydratedLines.map((l) => {
          const t = totals.lines.find((x) => x.variantId === l.variantId)!;
          return {
            variantId: l.variantId,
            productNameSnapshot: l.productName,
            variantTitleSnapshot: l.variantTitle,
            unitPriceMinor: l.unitPriceMinor,
            quantity: l.quantity,
            lineDiscountMinor: t.lineDiscountMinor,
            lineTotalMinor: t.lineTotalMinor,
            currency: l.currency,
            source: lineSourceForRole(l.role, actionType),
            growthProposalId: proposal.id,
          };
        }),
      });
      await appendLedgerEvent(tx, {
        workflowId,
        merchantId,
        actorType: "COMMERCE",
        actionType: "ORDER_CREATED",
        status: "EXECUTED",
        conciseReason: `Order created: total ${totals.totalMinor} ${financialBounds.currency} minor units.`,
        relatedEntityType: "Order",
        relatedEntityId: order.id,
        executedAt: now,
      });

      const orderFingerprint = computeOrderFingerprint({
        orderId: order.id,
        merchantId,
        currency: financialBounds.currency,
        totalAmountMinor: totals.totalMinor,
        authorizationId: authorization.id,
        lines: totals.lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity, unitPriceMinor: l.unitPriceMinor, lineDiscountMinor: l.lineDiscountMinor, lineTotalMinor: l.lineTotalMinor })),
      });
      await setOrderFingerprint(tx, order.id, orderFingerprint, ORDER_FINGERPRINT_VERSION);

      // INVENTORY IS RESERVED HERE, INSIDE THE TRANSACTION.
      //
      // The availability check happens during rehydration, BEFORE this
      // transaction opens, and nothing decremented anything. Two checkouts
      // for the last unit both passed that check and both created orders —
      // a textbook oversell that no amount of downstream governance would
      // have caught, because both orders were individually valid.
      //
      // `updateMany` with a `gte` guard makes the decrement itself the
      // check: the row is only written if the stock is still there when the
      // write lands, and a count of 0 means someone else took it first.
      for (const line of totals.lines) {
        const reserved = await tx.inventory.updateMany({
          where: { variantId: line.variantId, availableQuantity: { gte: line.quantity } },
          data: { availableQuantity: { decrement: line.quantity } },
        });

        if (reserved.count === 0) {
          // A count of 0 has TWO causes and they are not the same fact:
          //   - a row exists but no longer has the stock  -> someone won the race
          //   - no row exists at all                      -> stock was never recorded
          // Treating both as "out of stock" would refuse every variant the
          // merchant has not inventoried, which is a different (and much
          // broader) product decision than fixing an oversell.
          const tracked = await tx.inventory.findUnique({ where: { variantId: line.variantId } });
          if (tracked) {
            // Throwing inside the transaction rolls back the order and cart
            // too, so a lost race leaves nothing half-created.
            throw new AppError(
              "INSUFFICIENT_INVENTORY",
              "That stock was taken by another order while this checkout was being created. Nothing was reserved or charged.",
            );
          }
          logger.warn(
            { event: "commerce.inventory_untracked", variantId: line.variantId },
            "Checkout proceeded without reserving stock: this variant has no inventory record, so availability is genuinely unknown",
          );
        }
      }

      const checkoutId = randomUUID();
      const expiresAt = new Date(now.getTime() + CHECKOUT_VALIDITY_MINUTES * 60_000);
      const checkout = await createCheckoutSession(tx, {
        id: checkoutId,
        merchantId,
        customerId,
        cartId: cart.id,
        orderId: order.id,
        authorizationId: authorization.id,
        amountMinor: totals.totalMinor,
        currency: financialBounds.currency,
        orderFingerprint,
        fingerprintVersion: ORDER_FINGERPRINT_VERSION,
        workflowId,
        expiresAt,
      });
      await appendLedgerEvent(tx, {
        workflowId,
        merchantId,
        actorType: "COMMERCE",
        actionType: "CHECKOUT_CREATED",
        status: "EXECUTED",
        conciseReason: "Checkout session created.",
        relatedEntityType: "CheckoutSession",
        relatedEntityId: checkout.id,
        executedAt: now,
      });

      await updateCartStatus(tx, cart.id, "CONVERTED");
      await updateCheckoutStatus(tx, checkout.id, "READY_FOR_PAYMENT");
      await appendLedgerEvent(tx, {
        workflowId,
        merchantId,
        actorType: "COMMERCE",
        actionType: "CHECKOUT_READY_FOR_PAYMENT",
        status: "EXECUTED",
        conciseReason: "Checkout is ready for payment. No payment has been started.",
        relatedEntityType: "CheckoutSession",
        relatedEntityId: checkout.id,
        executedAt: now,
      });

      const responseBody: CheckoutResponseDTO = {
        schemaVersion: "1.0",
        checkoutId: checkout.id,
        orderId: order.id,
        cartId: cart.id,
        status: "READY_FOR_PAYMENT",
        totals: {
          currency: totals.currency as never,
          subtotalMinor: totals.subtotalMinor,
          discountMinor: totals.discountMinor,
          totalMinor: totals.totalMinor,
          calculationVersion: totals.calculationVersion,
          calculatedAt: totals.calculatedAt,
        },
        items: rehydratedLines.map((l) => {
          const t = totals.lines.find((x) => x.variantId === l.variantId)!;
          return {
            productId: l.productId,
            variantId: l.variantId,
            productName: l.productName,
            variantTitle: l.variantTitle,
            quantity: l.quantity,
            unitPriceMinor: l.unitPriceMinor,
            lineSubtotalMinor: t.lineSubtotalMinor,
            lineDiscountMinor: t.lineDiscountMinor,
            lineTotalMinor: t.lineTotalMinor,
            currency: l.currency as never,
            source: lineSourceForRole(l.role, actionType),
          };
        }),
        appliedOffer: offerTerms
          ? {
              actionType,
              kind: offerTerms.kind,
              percentageBps: offerTerms.percentageBps,
              amountMinor: offerTerms.amountMinor,
              discountMinor: totals.discountMinor,
              growthProposalId: proposal.id,
            }
          : null,
        authorization: { authorizationId: authorization.id, consumed: true },
        payment: { status: "NOT_STARTED" },
        orderFingerprint,
        fingerprintVersion: ORDER_FINGERPRINT_VERSION,
        expiresAt: expiresAt.toISOString(),
        createdAt: now.toISOString(),
        traceId,
      };

      await createIdempotencyRecord(tx, {
        merchantId,
        operation: COMMERCE_CHECKOUT_OPERATION,
        idempotencyKey: request.idempotencyKey,
        requestFingerprint,
        responseSnapshot: responseBody as unknown as Prisma.InputJsonValue,
      });

      return responseBody;
    });

    logger.info({ event: "commerce.checkout_ready", merchantId, checkoutId: response.checkoutId, orderId: response.orderId, totalMinor: response.totals.totalMinor }, "Checkout ready for payment");
    return response;
  } catch (err) {
    if (isIdempotencyUniqueConflict(err)) {
      const winner = await findIdempotencyRecord(prisma, merchantId, COMMERCE_CHECKOUT_OPERATION, request.idempotencyKey);
      if (winner) {
        logger.info({ event: "commerce.idempotency_reused", merchantId, idempotencyKey: request.idempotencyKey }, "Concurrent idempotent commerce execution resolved to the winning result");
        return winner.responseSnapshot as unknown as CheckoutResponseDTO;
      }
    }
    if (err instanceof AuthorizationConsumedRaceError) {
      logger.info({ event: "commerce.authorization_consumed_race", merchantId, authorizationId: request.authorizationId }, err.message);
      throw new AppError("AUTHORIZATION_ALREADY_CONSUMED", "This execution authorization was already consumed by a concurrent request.");
    }
    throw err;
  }
}
