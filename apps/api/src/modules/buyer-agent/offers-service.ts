/**
 * OFFER EVALUATION — the stage the buyer pipeline was missing.
 *
 * WHAT WAS WRONG
 *
 * Merchants' agents author real offers: 125 `GrowthActionProposal` rows on
 * the demo merchant alone carried an offer that had reached AUTHORIZED,
 * having passed validation, the policy engine, and — where the merchant's
 * ceilings required it — a human approval.
 *
 * The Buyer Agent could not see a single one of them. It recommended
 * products at list price while a governed, merchant-authored discount sat
 * in the database attached to that exact product. The buyer paid more than
 * the merchant had already agreed to accept.
 *
 * WHAT AN OFFER MUST BE TO APPEAR HERE
 *
 * Every filter below is a refusal to invent:
 *
 *   AUTHORIZED (or beyond)  An offer still in PROPOSED or PENDING_APPROVAL
 *                           is something a merchant's agent SUGGESTED. It
 *                           is not a price anyone has agreed to, and
 *                           showing it to a buyer would be quoting a
 *                           discount that does not exist.
 *   Attached to THIS product Matched on `primaryProductId`, never on
 *                           category or similarity. "Something like this
 *                           was discounted" is not an offer on this.
 *   Still promotable        The merchant has not since marked the product
 *                           INELIGIBLE for promotion. See below.
 *
 * THE MERCHANT'S "NO" OUTLIVES THEIR AGENT'S "YES"
 *
 * `promotionEligibility` was not checked here at all, and on the seeded
 * data that was not hypothetical: Meridian Pulse Runner is marked
 * INELIGIBLE and carried five committed offers, so a buyer was quoted
 * ₹224.95 off ₹4,499 on a product its own merchant had excluded from
 * promotion. The growth engine respects the flag when DETECTING (it only
 * proposes offers for promotion-eligible products); nothing respected it
 * at the point the discount was actually shown and charged.
 *
 * Only an explicit INELIGIBLE suppresses an offer. UNKNOWN is the absence
 * of a statement, not a refusal, and an offer that already passed
 * governance should not be revoked by silence.
 *
 * EXPIRY — PART 18
 *
 * This file used to promise "an authorization that lapsed is not an
 * offer" and then not check anything, because `GrowthActionProposal` had
 * no validity window at all. The only time bound in reach was the
 * `ExecutionAuthorization`'s ten minutes, which bounds executing ONE
 * checkout and says nothing about how long a merchant's price commitment
 * stands. Rather than fake it, the promise was withdrawn — and the real
 * gap left behind was that an offer authorized months ago was still
 * quoted to a buyer as live.
 *
 * `MerchantPolicy.offerValidityHours` now exists, alongside the three
 * internal windows a merchant already sets, and every offer is stamped
 * with `offerValidUntil` when it is created. The filter below is that
 * stamp, and nothing else — no inference from the authorization's
 * lifetime, no assumption about what "recent" means.
 *
 * NULL IS NOT EXPIRED. Offers committed before the column existed carry
 * no window, and they still stand. A merchant agreed to those prices
 * under rules that had no expiry; revoking them because a column was
 * added later would be the system changing its mind about a price on the
 * merchant's behalf, which is the opposite of what this file is for.
 *
 * And the amount is read from the merchant's own `offerCalculation`, which
 * the growth pipeline computed deterministically — never recomputed here,
 * because a second derivation is a second chance to disagree.
 */
import type { PrismaClient } from "@prisma/client";
import type { BuyerVisibleOfferDTO } from "@razorgrowth/contracts";

/**
 * Statuses at which a merchant has actually committed to the offer.
 *
 * AUTHORIZED means the policy engine allowed it and an execution
 * authorization was issued. EXECUTED and VERIFIED are the Part 8 terminal
 * states — an offer that has already been applied to a basket is still a
 * live commitment for an identical one.
 */
const COMMITTED_STATUSES = ["AUTHORIZED", "EXECUTED", "VERIFIED"] as const;

/**
 * Offers a buyer may legitimately be shown for the given products.
 *
 * Returns an empty array rather than throwing when there are none — no
 * offer is the normal case, and a buyer seeing list price is correct.
 */
export async function findBuyerVisibleOffers(
  prisma: PrismaClient,
  productIds: readonly string[],
): Promise<BuyerVisibleOfferDTO[]> {
  if (productIds.length === 0) return [];

  /**
   * Products the merchant has explicitly excluded from promotion. Resolved
   * separately rather than as a relation filter because `primaryProductId`
   * is a plain column on the proposal, not a foreign key to Product.
   */
  const ineligible = new Set(
    (
      await prisma.product.findMany({
        where: { id: { in: [...productIds] }, promotionEligibility: "INELIGIBLE" },
        select: { id: true },
      })
    ).map((product) => product.id),
  );
  const promotable = productIds.filter((id) => !ineligible.has(id));
  if (promotable.length === 0) return [];

  const proposals = await prisma.growthActionProposal.findMany({
    where: {
      primaryProductId: { in: promotable },
      status: { in: [...COMMITTED_STATUSES] },
      offerKind: { not: null },
      // Still inside the merchant's own validity window, or from before
      // windows existed. See EXPIRY above for why NULL stays visible.
      OR: [{ offerValidUntil: null }, { offerValidUntil: { gt: new Date() } }],
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      merchantId: true,
      primaryProductId: true,
      actionType: true,
      offerKind: true,
      offerPercentageBps: true,
      offerAmountMinor: true,
      offerCurrency: true,
      offerCalculation: true,
      offerValidUntil: true,
      status: true,
      createdAt: true,
    },
  });

  // One offer per product: the most recent committed one. A buyer shown
  // three overlapping discounts on the same product has to work out which
  // applies, which is the merchant's job and not theirs.
  const bestByProduct = new Map<string, (typeof proposals)[number]>();
  for (const proposal of proposals) {
    if (!bestByProduct.has(proposal.primaryProductId)) bestByProduct.set(proposal.primaryProductId, proposal);
  }

  return [...bestByProduct.values()].map((proposal) => {
    const calculation = (proposal.offerCalculation ?? null) as { baseAmountMinor?: number; discountMinor?: number } | null;

    return {
      proposalId: proposal.id,
      productId: proposal.primaryProductId,
      merchantId: proposal.merchantId,
      kind: proposal.offerKind!,
      percentageBps: proposal.offerPercentageBps,
      // Read from the merchant's own deterministic calculation, never
      // recomputed. A second derivation is a second chance to disagree
      // with the number governance actually authorized.
      discountMinor: calculation?.discountMinor ?? proposal.offerAmountMinor ?? null,
      baseAmountMinor: calculation?.baseAmountMinor ?? null,
      currency: proposal.offerCurrency,
      /**
       * Stated plainly because it is the buyer's real question. This is
       * not "an offer we found" — it is one this merchant's own agent
       * proposed and their own policy authorized.
       */
      provenance: `Authorized by the merchant's policy engine on ${proposal.createdAt.toISOString().slice(0, 10)}.`,
      validUntil: proposal.offerValidUntil?.toISOString() ?? null,
      status: proposal.status,
    };
  });
}
