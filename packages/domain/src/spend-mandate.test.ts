/**
 * Mandate verification, exercised against REAL Ed25519 keys.
 *
 * The signature check is injected (this package stays dependency-free), but
 * a stub verifier would prove nothing about tamper-resistance — the whole
 * point is that editing a mandate's terms invalidates it. So the test
 * supplies the genuine `node:crypto` implementation, which is also exactly
 * what the API wires in.
 */
import { describe, it, expect } from "vitest";
import { generateKeyPairSync, sign as edSign, verify as edVerify } from "node:crypto";
import {
  verifySpendMandate,
  mandateSigningPayload,
  type SpendMandate,
  type MandateVerificationContext,
} from "./spend-mandate.js";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const rawPublicKey = publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64");

/** The real verifier — identical to the one the API injects. */
function verifySignature(payload: string, signature: string, keyB64: string): boolean {
  try {
    return edVerify(
      null,
      Buffer.from(payload, "utf8"),
      {
        key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(keyB64, "base64")]),
        format: "der",
        type: "spki",
      },
      Buffer.from(signature, "base64"),
    );
  } catch {
    return false;
  }
}

const NOW = new Date("2026-08-28T10:00:00.000Z");

function issueMandate(overrides: Partial<SpendMandate> = {}): SpendMandate {
  const terms = {
    mandateId: "mandate-1",
    buyerAgentId: "agent-chatgpt-1",
    merchantScope: "merchant-1",
    maxAmountMinor: 1_000_000,
    currency: "INR" as const,
    notBefore: new Date("2026-08-28T09:00:00.000Z"),
    expiresAt: new Date("2026-08-28T11:00:00.000Z"),
    nonce: "nonce-1",
    ...overrides,
  };
  const signature = edSign(null, Buffer.from(mandateSigningPayload(terms), "utf8"), privateKey).toString("base64");
  return { ...terms, publicKey: rawPublicKey, signature, ...(overrides.signature ? { signature: overrides.signature } : {}) };
}

function ctx(overrides: Partial<MandateVerificationContext> = {}): MandateVerificationContext {
  return {
    merchantId: "merchant-1",
    callerAgentId: "agent-chatgpt-1",
    orderTotalMinor: 500_000,
    currency: "INR",
    now: NOW,
    nonceAlreadyUsed: false,
    verifySignature,
    trustedPublicKey: rawPublicKey,
    ...overrides,
  };
}

describe("spend mandate verification", () => {
  it("accepts a correctly signed, in-scope, in-date mandate", () => {
    const result = verifySpendMandate(issueMandate(), ctx());
    expect(result.valid).toBe(true);
  });

  it("rejects a missing mandate", () => {
    const result = verifySpendMandate(null, ctx());
    expect(result).toMatchObject({ valid: false, code: "MANDATE_MISSING" });
  });

  /** The core guarantee: an agent cannot raise its own ceiling in flight. */
  it("rejects a mandate whose amount was edited after signing", () => {
    const tampered = { ...issueMandate(), maxAmountMinor: 99_000_000 };
    const result = verifySpendMandate(tampered, ctx({ orderTotalMinor: 90_000_000 }));
    expect(result).toMatchObject({ valid: false, code: "MANDATE_SIGNATURE_INVALID" });
  });

  it("rejects a mandate whose merchant scope was widened after signing", () => {
    const tampered = { ...issueMandate(), merchantScope: "merchant-2" };
    const result = verifySpendMandate(tampered, ctx({ merchantId: "merchant-2" }));
    expect(result).toMatchObject({ valid: false, code: "MANDATE_SIGNATURE_INVALID" });
  });

  it("rejects a mandate signed by a different key", () => {
    const other = generateKeyPairSync("ed25519");
    const otherKey = other.publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64");
    const result = verifySpendMandate({ ...issueMandate(), publicKey: otherKey }, ctx());
    expect(result).toMatchObject({ valid: false, code: "MANDATE_KEY_MISMATCH" });
  });

  /**
   * THE VULNERABILITY THIS FILE EXISTS TO PREVENT.
   *
   * Verification used to run against `mandate.publicKey` — a field inside
   * the same untrusted request. An attacker could generate a keypair,
   * authorise any amount, sign it, and be accepted. These two pin the fix.
   */
  it("refuses a wholly self-signed mandate from an unregistered attacker", () => {
    const attacker = generateKeyPairSync("ed25519");
    const attackerKey = attacker.publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64");
    const terms = {
      mandateId: "forged",
      buyerAgentId: "agent-chatgpt-1",
      merchantScope: "merchant-1",
      maxAmountMinor: 99_000_000,
      currency: "INR" as const,
      notBefore: new Date("2026-08-28T09:00:00.000Z"),
      expiresAt: new Date("2026-08-28T11:00:00.000Z"),
      nonce: "forged-nonce",
    };
    const forged = {
      ...terms,
      publicKey: attackerKey,
      signature: edSign(null, Buffer.from(mandateSigningPayload(terms), "utf8"), attacker.privateKey).toString("base64"),
    };

    // Internally consistent, cryptographically valid — and still refused,
    // because this merchant never registered that key.
    const result = verifySpendMandate(forged, ctx({ orderTotalMinor: 90_000_000 }));
    expect(result).toMatchObject({ valid: false, code: "MANDATE_KEY_MISMATCH" });
  });

  it("refuses when the merchant holds no key for the agent at all", () => {
    const result = verifySpendMandate(issueMandate(), ctx({ trustedPublicKey: null }));
    expect(result).toMatchObject({ valid: false, code: "MANDATE_KEY_NOT_REGISTERED" });
  });

  it("rejects an expired mandate", () => {
    const result = verifySpendMandate(issueMandate(), ctx({ now: new Date("2026-08-28T12:00:00.000Z") }));
    expect(result).toMatchObject({ valid: false, code: "MANDATE_EXPIRED" });
  });

  it("rejects a mandate that is not yet valid", () => {
    const result = verifySpendMandate(issueMandate(), ctx({ now: new Date("2026-08-28T08:00:00.000Z") }));
    expect(result).toMatchObject({ valid: false, code: "MANDATE_NOT_YET_VALID" });
  });

  it("rejects a mandate issued for another merchant", () => {
    const result = verifySpendMandate(issueMandate({ merchantScope: "merchant-9" }), ctx());
    expect(result).toMatchObject({ valid: false, code: "MANDATE_MERCHANT_SCOPE_MISMATCH" });
  });

  it("rejects a mandate presented by an agent it was not issued to", () => {
    const result = verifySpendMandate(issueMandate(), ctx({ callerAgentId: "agent-someone-else" }));
    expect(result).toMatchObject({ valid: false, code: "MANDATE_AGENT_MISMATCH" });
  });

  it("rejects a currency mismatch rather than converting", () => {
    const result = verifySpendMandate(issueMandate({ currency: "USD" }), ctx());
    expect(result).toMatchObject({ valid: false, code: "MANDATE_CURRENCY_MISMATCH" });
  });

  it("rejects an order above the mandated amount", () => {
    const result = verifySpendMandate(issueMandate(), ctx({ orderTotalMinor: 1_000_001 }));
    expect(result).toMatchObject({ valid: false, code: "MANDATE_AMOUNT_EXCEEDED" });
  });

  it("rejects a replayed nonce even while the mandate is still in date", () => {
    const result = verifySpendMandate(issueMandate(), ctx({ nonceAlreadyUsed: true }));
    expect(result).toMatchObject({ valid: false, code: "MANDATE_NONCE_REPLAYED" });
  });

  it("reports tampering as a signature failure, never as the business clause it broke", () => {
    // Edited to be expired AND over-amount. It must still surface as a
    // signature failure — leaking which clause would have failed tells an
    // attacker how to shape the next forgery.
    const tampered = { ...issueMandate(), expiresAt: new Date("2020-01-01T00:00:00.000Z"), maxAmountMinor: 1 };
    const result = verifySpendMandate(tampered, ctx());
    expect(result).toMatchObject({ valid: false, code: "MANDATE_SIGNATURE_INVALID" });
  });

  it("treats a malformed signature as invalid rather than throwing", () => {
    const result = verifySpendMandate({ ...issueMandate(), signature: "!!!not-base64!!!" }, ctx());
    expect(result.valid).toBe(false);
  });

  it("names the failed clause in plain language for every rejection", () => {
    const rejections = [
      verifySpendMandate(null, ctx()),
      verifySpendMandate(issueMandate(), ctx({ now: new Date("2026-08-28T12:00:00.000Z") })),
      verifySpendMandate(issueMandate(), ctx({ orderTotalMinor: 9_000_000 })),
      verifySpendMandate(issueMandate(), ctx({ nonceAlreadyUsed: true })),
    ];
    for (const rejection of rejections) {
      expect(rejection.valid).toBe(false);
      if (!rejection.valid) expect(rejection.detail.length).toBeGreaterThan(20);
    }
  });
});
