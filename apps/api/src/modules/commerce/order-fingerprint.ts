/**
 * Order/checkout financial fingerprint (PART 06 §42-§44).
 *
 * Binds an order's authoritative financial identity — what PART 07 must
 * load and trust instead of any client-submitted amount. Uses the exact
 * same canonicalization convention PART 05 already established for the
 * proposal fingerprint and ledger hash chain
 * (`@razorgrowth/domain` `canonicalStringify`), just applied to a
 * different set of fields — never a new hashing scheme.
 */
import { createHash } from "node:crypto";
import { canonicalStringify } from "@razorgrowth/domain";
import { ORDER_FINGERPRINT_VERSION } from "@razorgrowth/domain";

export interface OrderFingerprintLine {
  variantId: string;
  quantity: number;
  unitPriceMinor: number;
  lineDiscountMinor: number;
  lineTotalMinor: number;
}

export interface OrderFingerprintFacts {
  orderId: string;
  merchantId: string;
  currency: string;
  totalAmountMinor: number;
  authorizationId: string;
  lines: OrderFingerprintLine[];
}

export function computeOrderFingerprint(facts: OrderFingerprintFacts): string {
  const canonical = canonicalStringify({
    v: ORDER_FINGERPRINT_VERSION,
    orderId: facts.orderId,
    merchantId: facts.merchantId,
    currency: facts.currency,
    totalAmountMinor: facts.totalAmountMinor,
    authorizationId: facts.authorizationId,
    // Sorted by variantId: canonical identity of a set of line items
    // should not depend on database insertion order.
    lines: [...facts.lines]
      .sort((a, b) => a.variantId.localeCompare(b.variantId))
      .map((l) => ({
        variantId: l.variantId,
        quantity: l.quantity,
        unitPriceMinor: l.unitPriceMinor,
        lineDiscountMinor: l.lineDiscountMinor,
        lineTotalMinor: l.lineTotalMinor,
      })),
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export { ORDER_FINGERPRINT_VERSION };
