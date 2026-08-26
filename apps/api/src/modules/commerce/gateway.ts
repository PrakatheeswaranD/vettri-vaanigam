/**
 * CommerceGateway — internal protocol-oriented commerce boundary
 * (PART 00 §33; PART 01 §53; PART 06 §11-§12, §128-§130).
 *
 * This is the single interface anything (a future Buyer Agent adapter,
 * `CommerceExecutionService`, an external agentic-commerce protocol
 * adapter) is allowed to call into for product discovery and read access.
 * Intentionally narrow (PART 00 §32 — least privilege, no
 * `executeAnything()`): search/read operations only. It does NOT expose
 * `executePayment()`, `refund()`, or `captureMoney()` — those belong to a
 * future `PaymentGateway` (PART 07), reached only through Policy →
 * Authorization, never directly from an agent or this gateway.
 *
 * Scope decision (PART 06): this gateway is the READ/DISCOVERY boundary —
 * a real, live implementation now, not a placeholder. The transactional
 * WRITE path (cart/order/checkout creation, authorization consumption)
 * lives in `CommerceExecutionService` directly rather than being proxied
 * through this interface: that path is single-purpose and heavily
 * transactional, and routing it through a generic gateway method would
 * add an indirection layer with no real abstraction benefit (Master
 * Contract §48 — avoid unnecessary abstractions). This is an internal
 * application boundary, not a claim of ACP/AP2/UCP/x402 protocol
 * compliance (PART 00 §33, §47; PART 06 §130).
 */
import type { PrismaClient } from "@prisma/client";
import type { ProductDTO, ProductSummaryDTO } from "@razorgrowth/contracts";
import { isPurchasable, type AvailabilityState, deriveAvailabilityState } from "@razorgrowth/domain";
import { findProductById, listProducts } from "../catalog/repository.js";
import { toProductDTO, toProductSummaryDTO } from "../catalog/mapper.js";

export interface AuthoritativeCommerceVariant {
  variantId: string;
  sku: string;
  title: string;
  priceMinor: number;
  currency: string;
  active: boolean;
  availableQuantity: number | null;
  availabilityState: AvailabilityState;
}

export interface AuthoritativeCommerceProduct {
  productId: string;
  merchantId: string;
  name: string;
  variants: AuthoritativeCommerceVariant[];
  /** The SAME "cheapest variant not explicitly UNAVAILABLE" figure
   * `agent-commerce`'s `priceRange.minMinor` computes (PART 02 §9 —
   * `UNKNOWN` inventory is a real state, not grounds to exclude a variant
   * from the price range). This is the product-level price reference
   * PART 04/05 actually authorized against — comparing it against the
   * stored `offerCalculation.baseAmountMinor` is the correct staleness
   * check; comparing a specific PURCHASABLE variant's price against it
   * would spuriously "detect drift" whenever the cheapest variant simply
   * happens to have unrecorded inventory, which is not a price change at
   * all. `null` only if every variant is inactive. */
  priceRangeMinMinor: number | null;
}

export interface SearchProductsParams {
  merchantId: string;
  query?: string;
  category?: string;
}

export interface CommerceGateway {
  searchProducts(params: SearchProductsParams): Promise<ProductSummaryDTO[]>;
  getProduct(merchantId: string, productId: string): Promise<ProductDTO | null>;
  /** PART 06 §10 — the authoritative rehydration a commerce execution
   * revalidates every product/variant against; never a cached/stale
   * frontend copy. Returns `null` if the product doesn't exist, isn't
   * ACTIVE, or belongs to a different merchant (PART 06 §93). */
  getAuthoritativeProduct(merchantId: string, productId: string): Promise<AuthoritativeCommerceProduct | null>;
}

export function createCommerceGateway(prisma: PrismaClient): CommerceGateway {
  return {
    async searchProducts(params) {
      const { items } = await listProducts(prisma, { merchantId: params.merchantId, category: params.category, search: params.query, page: 1, limit: 20 });
      return items.map((p) => toProductSummaryDTO(p));
    },

    async getProduct(merchantId, productId) {
      const product = await findProductById(prisma, merchantId, productId);
      return product ? toProductDTO(product) : null;
    },

    async getAuthoritativeProduct(merchantId, productId) {
      const product = await findProductById(prisma, merchantId, productId);
      if (!product) return null;
      const variants = product.variants.map((v) => {
        const quantity = v.inventory?.availableQuantity ?? null;
        const state = deriveAvailabilityState(quantity, v.active);
        return {
          variantId: v.id,
          sku: v.sku,
          title: v.title,
          priceMinor: v.priceMinor,
          currency: v.currency,
          active: v.active,
          availableQuantity: quantity,
          availabilityState: state,
        };
      });
      // Matches `agent-commerce/mapper.ts`'s `priceRange.minMinor` exactly
      // (active + not UNAVAILABLE — UNKNOWN inventory still counts).
      const referencePrices = variants.filter((v) => v.active && v.availabilityState !== "UNAVAILABLE").map((v) => v.priceMinor);
      return {
        productId: product.id,
        merchantId: product.merchantId,
        name: product.name,
        variants,
        priceRangeMinMinor: referencePrices.length > 0 ? Math.min(...referencePrices) : null,
      };
    },
  };
}

export { isPurchasable };
