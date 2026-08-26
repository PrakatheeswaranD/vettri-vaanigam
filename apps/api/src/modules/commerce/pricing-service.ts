/**
 * CartPricingService (PART 06 §31-§33, §156-§157).
 *
 * Deterministic, integer-only, zero AI/payment dependency — the ONLY
 * place a commerce execution's line totals and cart totals are computed.
 * The Merchant Agent may have proposed an offer and the Policy Engine may
 * have authorized it, but neither computes the actual minor-unit amounts
 * applied here; `calculateOffer` (`@razorgrowth/domain`, already
 * established in PART 04/05) is reused unchanged rather than
 * reimplemented.
 */
import { calculateOffer, CART_PRICING_VERSION, type OfferTerms } from "@razorgrowth/domain";

export interface PricingLineInput {
  variantId: string;
  productId: string;
  unitPriceMinor: number;
  quantity: number;
  /** At most one line may be `true` per execution (PART 06 §30, §163). */
  offerEligible: boolean;
}

export interface PricingLineResult extends PricingLineInput {
  lineSubtotalMinor: number;
  lineDiscountMinor: number;
  lineTotalMinor: number;
}

export interface CartTotalsResult {
  currency: string;
  subtotalMinor: number;
  discountMinor: number;
  totalMinor: number;
  calculationVersion: string;
  calculatedAt: string;
  lines: PricingLineResult[];
}

/**
 * `offer` is applied to exactly the line(s) marked `offerEligible` — in
 * practice always exactly one (the caller guarantees this via
 * `@razorgrowth/domain` `resolveAuthorizedSelection`, which never marks
 * more than one line eligible). Discount can never exceed that line's own
 * subtotal (`calculateOffer` already clamps to `[0, base]`), so the final
 * cart total can never go negative (PART 06 §29).
 */
export function calculateCartTotals(
  currency: string,
  lines: PricingLineInput[],
  offer: OfferTerms | null,
  now: Date,
): CartTotalsResult {
  const resultLines: PricingLineResult[] = lines.map((line) => {
    const lineSubtotalMinor = line.unitPriceMinor * line.quantity;
    let lineDiscountMinor = 0;
    if (offer && line.offerEligible) {
      lineDiscountMinor = calculateOffer(lineSubtotalMinor, offer).discountMinor;
    }
    return {
      ...line,
      lineSubtotalMinor,
      lineDiscountMinor,
      lineTotalMinor: lineSubtotalMinor - lineDiscountMinor,
    };
  });

  const subtotalMinor = resultLines.reduce((sum, l) => sum + l.lineSubtotalMinor, 0);
  const discountMinor = resultLines.reduce((sum, l) => sum + l.lineDiscountMinor, 0);

  return {
    currency,
    subtotalMinor,
    discountMinor,
    totalMinor: subtotalMinor - discountMinor,
    calculationVersion: CART_PRICING_VERSION,
    calculatedAt: now.toISOString(),
    lines: resultLines,
  };
}
