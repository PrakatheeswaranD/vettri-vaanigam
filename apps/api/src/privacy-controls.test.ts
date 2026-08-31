import { describe, expect, it } from "vitest";
import { maskEmail, maskPersonName, redactProtocolPayload, stableSensitiveFingerprint } from "./modules/privacy/redaction.js";

describe("privacy controls", () => {
  it("masks buyer identity while preserving enough shape for an audit trail", () => {
    expect(maskEmail("Buyer.Person@example.test")).toBe("b***@example.test");
    expect(maskPersonName("Buyer Person")).toBe("B*** P***");
  });

  it("redacts nested credentials, payment data, and buyer PII", () => {
    const redacted = redactProtocolPayload({
      buyer: { email: "buyer@example.test", name: "Buyer Person", locale: "en-IN" },
      payment_data: { token: "vault-secret", last4: "4242" },
      basket: [{ sku: "SKU-1", quantity: 1 }],
    });
    const encoded = JSON.stringify(redacted);
    expect(encoded).not.toContain("buyer@example.test");
    expect(encoded).not.toContain("Buyer Person");
    expect(encoded).not.toContain("vault-secret");
    expect(encoded).toContain("SKU-1");
  });

  it("uses a keyed stable fingerprint rather than retaining an enumerable identifier", () => {
    const identifier = "buyer@example.test";
    const first = stableSensitiveFingerprint(identifier);
    expect(first).toBe(stableSensitiveFingerprint(identifier));
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toBe(identifier);
  });
});
