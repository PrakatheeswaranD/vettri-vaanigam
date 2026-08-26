import { describe, expect, it } from "vitest";
import { validateGrounding } from "./recommendation-grounding.js";

const CANDIDATES = ["p1", "p2", "p3"];

describe("validateGrounding", () => {
  it("accepts a clean ranking restricted to supplied candidates", () => {
    const result = validateGrounding(
      [
        { productId: "p1", rank: 1, reasonCodes: ["WITHIN_BUDGET"] },
        { productId: "p2", rank: 2, reasonCodes: ["IN_STOCK"] },
      ],
      CANDIDATES,
      5,
    );
    expect(result.ok).toBe(true);
  });

  it("rejects the entire batch when the model hallucinates a product ID outside the candidate set (PART 03 §152)", () => {
    const result = validateGrounding(
      [
        { productId: "p1", rank: 1, reasonCodes: [] },
        { productId: "HALLUCINATED-999", rank: 2, reasonCodes: [] },
      ],
      CANDIDATES,
      5,
    );
    expect(result.ok).toBe(false);
  });

  it("rejects a hidden/unsupplied product ID even if it's a real-looking UUID", () => {
    const result = validateGrounding([{ productId: "hidden-product-not-in-set", rank: 1, reasonCodes: [] }], CANDIDATES, 5);
    expect(result.ok).toBe(false);
  });

  it("rejects duplicate product IDs", () => {
    const result = validateGrounding(
      [
        { productId: "p1", rank: 1, reasonCodes: [] },
        { productId: "p1", rank: 2, reasonCodes: [] },
      ],
      CANDIDATES,
      5,
    );
    expect(result.ok).toBe(false);
  });

  it("rejects an unknown reason code", () => {
    const result = validateGrounding([{ productId: "p1", rank: 1, reasonCodes: ["FREE_DISCOUNT" as never] }], CANDIDATES, 5);
    expect(result.ok).toBe(false);
  });

  it("rejects a batch that exceeds the bounded count", () => {
    const result = validateGrounding(
      [
        { productId: "p1", rank: 1, reasonCodes: [] },
        { productId: "p2", rank: 2, reasonCodes: [] },
      ],
      CANDIDATES,
      1,
    );
    expect(result.ok).toBe(false);
  });

  it("rejects an empty ranking", () => {
    expect(validateGrounding([], CANDIDATES, 5).ok).toBe(false);
  });
});
