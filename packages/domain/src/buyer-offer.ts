/**
 * What a merchant-authorized offer takes off a basket.
 *
 * ONE DERIVATION, USED EVERYWHERE.
 *
 * This arithmetic lived inline in `createPurchaseProposal`, which is the
 * function that decides what a buyer is actually charged. Discovery then
 * needed the same number — to rank on what a buyer would really pay, and
 * to stop rejecting a product as over-budget on its list price when a
 * governed discount brings it inside the budget.
 *
 * Copying it would have been the "second chance to disagree" this codebase
 * keeps warning about: a buyer shown ₹4,275 in the results and charged
 * ₹4,280 at checkout is a worse bug than either number alone. So it moved
 * here, pure and testable, and both callers use it.
 *
 * RULES, AND WHY EACH ONE EXISTS
 *
 *   Percentage recomputed  The merchant's stored `discountMinor` was
 *                          calculated against THEIR assumed basket. This
 *                          buyer's may be a different quantity, so copying
 *                          the absolute figure would be right only by
 *                          coincidence.
 *   Fixed amount capped    A discount larger than the basket is not a
 *                          discount, it is a refund nobody authorized.
 *   Never negative         Structurally impossible above; asserted anyway,
 *                          because a negative charge is the one arithmetic
 *                          error that must not survive a refactor.
 *   `Math.round`           Matches the convention the negotiation service
 *                          already uses, so two discount paths in the same
 *                          product cannot round in opposite directions.
 */

/** The offer shape both callers already hold. Deliberately structural
 * rather than importing a DTO: the domain package depends on nothing. */
export interface AuthorizedOfferTerms {
  percentageBps: number | null;
  discountMinor: number | null;
}

const BASIS_POINTS = 10_000;

/**
 * The discount, in integer minor units, that `offer` takes off
 * `listTotalMinor`. Returns 0 for no offer, a zero/negative offer, or an
 * empty basket — every one of which means "the buyer pays list price",
 * which is a correct answer and not an error.
 */
export function offerDiscountMinor(listTotalMinor: number, offer: AuthorizedOfferTerms | null | undefined): number {
  if (!offer) return 0;
  if (listTotalMinor <= 0) return 0;

  if (offer.percentageBps !== null && offer.percentageBps > 0) {
    return Math.min(listTotalMinor, Math.round((listTotalMinor * offer.percentageBps) / BASIS_POINTS));
  }
  if (offer.discountMinor !== null && offer.discountMinor > 0) {
    return Math.min(listTotalMinor, offer.discountMinor);
  }
  return 0;
}

/**
 * What the buyer would actually pay for `listTotalMinor` under `offer`.
 *
 * This is the number discovery must rank and budget-check on. Ranking on
 * list price meant a product whose governed discount brought it inside the
 * buyer's stated budget was rejected as over-budget — the buyer lost a
 * product they could afford, and the merchant lost the sale their own
 * agent had authorized the discount for.
 */
export function effectivePriceMinor(listTotalMinor: number, offer: AuthorizedOfferTerms | null | undefined): number {
  return Math.max(0, listTotalMinor - offerDiscountMinor(listTotalMinor, offer));
}
