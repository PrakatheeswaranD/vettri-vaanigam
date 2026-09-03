/**
 * Where the buyer's payment actually is — read from the server, never
 * inferred by a client.
 *
 * THE RULE THIS MODULE EXISTS TO ENFORCE
 *
 * A frontend cannot observe a charge. Only the provider knows whether
 * money moved, and the server only believes the provider after verifying
 * a signature. So nothing here is derived from a client callback, a
 * redirect, or an optimistic local state — every field is read back from
 * the `Payment` row the payment service owns.
 *
 * `paid` in particular is true for exactly one state: a provider-confirmed
 * capture. Not "the buyer returned from the checkout page", not "the
 * client said it worked". Simulating completion in the UI is precisely
 * how a shopper ends up looking at an order that does not exist.
 */
import type { PrismaClient } from "@prisma/client";
import type { PaymentDTO } from "@razorgrowth/contracts";
import type { BuyerCheckoutStateDTO } from "@razorgrowth/contracts";

/** The agent identity every conversational purchase is recorded against. */
const CUSTOMER_AGENT_ID = "customer-buyer-agent";

/**
 * The proposal THIS CONVERSATION priced and is waiting on.
 *
 * SCOPED TO THE CONVERSATION, NOT THE BUYER.
 *
 * The first version of this looked up the buyer's most recent pending
 * proposal. That is wrong in a way a test caught immediately: a buyer with
 * an unanswered quote in one conversation could open a fresh one, say
 * "yes" to something else entirely, and authorize the old purchase. "Yes"
 * means the thing the agent just showed *this* buyer in *this* thread, and
 * `BuyerConversation.pendingProposalId` is the only record of which thing
 * that was.
 *
 * The remaining filters are still checked, because the conversation's
 * memory can go stale: a proposal already EXECUTING, PAYMENT_PENDING or
 * settled is not something "yes" may act on again, and neither is an
 * expired or declined one. The authorization service refuses all of these
 * independently — this just makes sure the conversation never offers them.
 */
export async function findPendingProposal(
  prisma: PrismaClient,
  buyerContext: string,
  conversationId: string,
): Promise<{ id: string; computedTotalMinor: number | null; currency: string | null } | null> {
  const conversation = await prisma.buyerConversation.findUnique({
    where: { id: conversationId },
    select: { pendingProposalId: true },
  });
  if (!conversation?.pendingProposalId) return null;

  const row = await prisma.decisionRecord.findFirst({
    where: {
      id: conversation.pendingProposalId,
      // Ownership is still re-checked. A conversation id is not proof the
      // proposal belongs to this shopper, and the one place that assumes
      // it would be the one that authorizes someone else's basket.
      externalAgentId: CUSTOMER_AGENT_ID,
      protocolActorRef: buyerContext,
      settlementStatus: "PROPOSED",
      outcome: { not: "DECLINE" },
      authorizationExpiresAt: { gt: new Date() },
    },
    select: { id: true, computedTotalMinor: true, currency: true },
  });
  return row;
}

/** Remembers what this conversation just quoted, so a later "yes" has an
 * unambiguous referent. Cleared on authorization — one yes buys one thing. */
export async function setPendingProposal(
  prisma: PrismaClient,
  conversationId: string,
  pendingProposalId: string | null,
): Promise<void> {
  await prisma.buyerConversation.update({ where: { id: conversationId }, data: { pendingProposalId } });
}

/**
 * Shapes the payment row for the conversation.
 *
 * Carried verbatim from the payment service — this function computes
 * nothing about money, it only selects which already-established facts the
 * buyer is shown.
 */
export function toCheckoutState(payment: PaymentDTO): BuyerCheckoutStateDTO {
  return {
    paymentId: payment.id,
    state: payment.state,
    amountMinor: payment.amountMinor,
    currency: payment.currency,
    providerOrderId: payment.providerOrderId ?? null,
    orderId: payment.orderId ?? null,
    // CAPTURED is the only state that means the money arrived, and it is
    // set by the server after verifying the provider's signature. Every
    // other state — including AUTHORIZED — means it has not.
    paid: payment.state === "CAPTURED",
  };
}
