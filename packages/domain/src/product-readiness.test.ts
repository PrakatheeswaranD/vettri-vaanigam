import { describe, expect, it } from "vitest";
import { deriveProductReadiness, type ProductReadinessEvidence } from "./product-readiness";

const complete: ProductReadinessEvidence = {
  hasActivePurchasableVariant: true,
  hasValidPriceAndCurrency: true,
  hasKnownAvailability: true,
  hasReturnPolicy: true,
  hasShippingPolicy: true,
  hasCategory: true,
  hasStructuredAttributes: true,
};

describe("deriveProductReadiness", () => {
  it("is AGENT_READY when every critical and important field is present", () => {
    expect(deriveProductReadiness(complete).state).toBe("AGENT_READY");
  });

  it("is NOT_READY when a critical field is missing, even if everything else is present", () => {
    const result = deriveProductReadiness({ ...complete, hasValidPriceAndCurrency: false });
    expect(result.state).toBe("NOT_READY");
    expect(result.missingCritical).toContain("Missing a valid price/currency");
  });

  it("is NOT_READY when there is no purchasable variant at all", () => {
    const result = deriveProductReadiness({ ...complete, hasActivePurchasableVariant: false });
    expect(result.state).toBe("NOT_READY");
  });

  it("is NOT_READY when availability is unknown", () => {
    const result = deriveProductReadiness({ ...complete, hasKnownAvailability: false });
    expect(result.state).toBe("NOT_READY");
  });

  it("is PARTIALLY_READY when all critical fields are present but an important one is missing", () => {
    const result = deriveProductReadiness({ ...complete, hasReturnPolicy: false });
    expect(result.state).toBe("PARTIALLY_READY");
    expect(result.missingCritical).toHaveLength(0);
    expect(result.missingImportant).toContain("Missing return-policy information");
  });

  it("NOT_READY takes priority even when important fields are also missing", () => {
    const result = deriveProductReadiness({
      ...complete,
      hasValidPriceAndCurrency: false,
      hasReturnPolicy: false,
      hasShippingPolicy: false,
    });
    expect(result.state).toBe("NOT_READY");
    expect(result.missingCritical.length).toBeGreaterThan(0);
    expect(result.missingImportant.length).toBeGreaterThan(0);
  });
});
