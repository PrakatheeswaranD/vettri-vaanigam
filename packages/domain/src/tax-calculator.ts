/**
 * Deterministic Tax & GST Calculator.
 * Supports CGST + SGST (Intra-state) and IGST (Inter-state) calculations for INR commerce.
 */

export interface TaxLineItemInput {
  variantId: string;
  unitPriceMinor: number;
  quantity: number;
  lineDiscountMinor?: number;
  taxRateBps: number; // Basis points (e.g., 1800 for 18%, 1200 for 12%, 500 for 5%)
}

export interface TaxLineItemOutput {
  variantId: string;
  taxableAmountMinor: number;
  taxAmountMinor: number;
  totalWithTaxMinor: number;
  cgstMinor: number;
  sgstMinor: number;
  igstMinor: number;
  taxRateBps: number;
}

export interface TaxCalculationResult {
  isInterState: boolean;
  totalTaxableAmountMinor: number;
  totalTaxAmountMinor: number;
  totalCgstMinor: number;
  totalSgstMinor: number;
  totalIgstMinor: number;
  grandTotalMinor: number;
  lines: TaxLineItemOutput[];
}

export function calculateTaxes(
  items: TaxLineItemInput[],
  merchantStateCode: string = "KA",
  buyerStateCode: string = "KA",
): TaxCalculationResult {
  const isInterState = merchantStateCode.trim().toUpperCase() !== buyerStateCode.trim().toUpperCase();

  let totalTaxableAmountMinor = 0;
  let totalTaxAmountMinor = 0;
  let totalCgstMinor = 0;
  let totalSgstMinor = 0;
  let totalIgstMinor = 0;

  const lines: TaxLineItemOutput[] = items.map((item) => {
    const gross = item.unitPriceMinor * item.quantity;
    const discount = item.lineDiscountMinor ?? 0;
    const taxableAmountMinor = Math.max(0, gross - discount);

    const taxAmountMinor = Math.round((taxableAmountMinor * item.taxRateBps) / 10000);
    let cgstMinor = 0;
    let sgstMinor = 0;
    let igstMinor = 0;

    if (isInterState) {
      igstMinor = taxAmountMinor;
    } else {
      cgstMinor = Math.floor(taxAmountMinor / 2);
      sgstMinor = taxAmountMinor - cgstMinor; // Ensure sum matches taxAmountMinor exactly
    }

    totalTaxableAmountMinor += taxableAmountMinor;
    totalTaxAmountMinor += taxAmountMinor;
    totalCgstMinor += cgstMinor;
    totalSgstMinor += sgstMinor;
    totalIgstMinor += igstMinor;

    return {
      variantId: item.variantId,
      taxableAmountMinor,
      taxAmountMinor,
      totalWithTaxMinor: taxableAmountMinor + taxAmountMinor,
      cgstMinor,
      sgstMinor,
      igstMinor,
      taxRateBps: item.taxRateBps,
    };
  });

  return {
    isInterState,
    totalTaxableAmountMinor,
    totalTaxAmountMinor,
    totalCgstMinor,
    totalSgstMinor,
    totalIgstMinor,
    grandTotalMinor: totalTaxableAmountMinor + totalTaxAmountMinor,
    lines,
  };
}
