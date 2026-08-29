/**
 * The gap this panel exists to surface: a product a shopper could buy from
 * a filtered list, that an autonomous agent cannot buy at all.
 */
import { describe, it, expect } from "vitest";
import type { RecommendedProductDTO } from "@razorgrowth/contracts";
import { blockersFor } from "./AgentBuyabilityVerdict";

function rec(variant: Partial<RecommendedProductDTO["product"]["variants"][number]>): RecommendedProductDTO {
  return {
    productId: "p1",
    variantId: "v1",
    matchType: "EXACT",
    reasonCodes: [],
    violations: [],
    product: {
      identity: { name: "Test Shoe", category: "Running Shoes" },
      readiness: { state: "READY" },
      variants: [
        {
          variantId: "v1",
          price: { amountMinor: 499900, currency: "INR" },
          availability: { state: "IN_STOCK" },
          attributes: { size: "UK9", color: "Black" },
          ...variant,
        },
      ],
    },
  } as unknown as RecommendedProductDTO;
}

describe("agent buyability", () => {
  it("clears a product with price, stock and attributes recorded", () => {
    expect(blockersFor(rec({}))).toEqual([]);
  });

  /** UNKNOWN is a real state — nobody recorded it — not a synonym for
   * out of stock. An agent cannot responsibly commit to it. */
  it("blocks a product whose stock was never recorded", () => {
    const blockers = blockersFor(rec({ availability: { state: "UNKNOWN" } as never }));
    expect(blockers).toContain("stock never recorded");
  });

  it("blocks a product with no structured attributes to match on", () => {
    expect(blockersFor(rec({ attributes: {} }))).toContain("no structured attributes to match on");
  });

  it("blocks a product with no recorded price", () => {
    const blockers = blockersFor(rec({ price: { amountMinor: 0, currency: "INR" } as never }));
    expect(blockers).toContain("no recorded price");
  });

  it("blocks a product that is not purchasable right now", () => {
    expect(blockersFor(rec({ availability: { state: "OUT_OF_STOCK" } as never }))).toContain("not purchasable right now");
  });

  it("reports every blocker at once rather than stopping at the first", () => {
    const blockers = blockersFor(rec({ attributes: {}, availability: { state: "UNKNOWN" } as never }));
    expect(blockers).toHaveLength(2);
  });

  it("blocks a product with no purchasable variant at all", () => {
    const empty = rec({});
    empty.product.variants = [];
    expect(blockersFor(empty)).toEqual(["no purchasable variant"]);
  });
});
