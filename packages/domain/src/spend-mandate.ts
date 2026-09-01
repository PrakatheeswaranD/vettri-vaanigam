/**
 * Buyer-side spend mandates — the "vaanigam" (consent) the gateway is named
 * for.
 *
 * SECURITY NOTE — READ BEFORE CHANGING ANYTHING HERE
 *
 * A signature is only worth the key it is checked against. This verifier
 * takes the trusted key from the CALLER (`trustedPublicKey`), which the
 * caller loads from the merchant's own records. It deliberately ignores
 * `mandate.publicKey` except to detect that it differs. Reverting to the
 * key inside the mandate would make every guarantee here decorative.
 *
 * A mandate is a cryptographically signed statement from the BUYER side:
 * "this agent may spend up to X, in this currency, with this merchant,
 * until this time, once." Nothing reaches Razorpay's payment APIs until a
 * mandate verifies. The merchant's own policy is a separate, later check —
 * a valid mandate is permission to ask, never permission to charge.
 *
 * WHY Ed25519 AND NOT A BEARER TOKEN
 *
 * A bearer token proves only that the caller has the token. A signature
 * proves the mandate's TERMS were authored by the mandate holder and have
 * not been edited in flight — so an agent cannot raise its own ceiling or
 * widen its own merchant scope on the way in. The amount, currency, scope,
 * validity window and nonce are all inside the signed payload.
 *
 * PURITY
 *
 * Everything here is a pure function. Two facts this verifier needs are
 * inherently not pure, so both are passed IN rather than reached for:
 *
 * - whether a nonce has been seen before (`nonceAlreadyUsed`) — state;
 * - how to check an Ed25519 signature (`verifySignature`) — a platform
 *   capability. This package deliberately has no Node types and no
 *   dependencies, and importing `node:crypto` here would make the whole
 *   domain layer un-runnable anywhere else. The API supplies the real
 *   implementation; tests supply a stub.
 *
 * The result is a verifier that is total, directly testable, and keeps the
 * decision about what counts as "seen" at the call site.
 */
import { canonicalStringify } from "./canonical-json.js";
import type { CurrencyCode } from "./money.js";

/**
 * Checks an Ed25519 signature over `payload`. Returning false (never
 * throwing) is part of the contract: a malformed key or signature is a
 * failed verification, not a crash that takes the request down.
 */
export type MandateSignatureVerifier = (payload: string, signature: string, publicKey: string) => boolean;

/**
 * Closed vocabulary. Every rejection names exactly which clause of the
 * mandate failed — a merchant reading a declined Decision Record should
 * never see a bare "invalid".
 */
export const MANDATE_REJECTION_CODES = [
  "MANDATE_MISSING",
  "MANDATE_MALFORMED",
  "MANDATE_KEY_NOT_REGISTERED",
  "MANDATE_KEY_MISMATCH",
  "MANDATE_SIGNATURE_INVALID",
  "MANDATE_NOT_YET_VALID",
  "MANDATE_EXPIRED",
  "MANDATE_MERCHANT_SCOPE_MISMATCH",
  "MANDATE_AGENT_MISMATCH",
  "MANDATE_CURRENCY_MISMATCH",
  "MANDATE_AMOUNT_EXCEEDED",
  "MANDATE_NONCE_REPLAYED",
] as const;
export type MandateRejectionCode = (typeof MANDATE_REJECTION_CODES)[number];

export interface SpendMandate {
  mandateId: string;
  /** The agent this mandate was issued to. Must match the caller. */
  buyerAgentId: string;
  /** Merchant this mandate may be spent with — never a wildcard. */
  merchantScope: string;
  maxAmountMinor: number;
  currency: CurrencyCode;
  notBefore: Date;
  expiresAt: Date;
  /** Single-use. Replay is refused even while the mandate is still valid. */
  nonce: string;
  /** Base64 Ed25519 public key of the mandate issuer. */
  publicKey: string;
  /** Base64 signature over `mandateSigningPayload`. */
  signature: string;
}

export interface MandateVerificationContext {
  merchantId: string;
  callerAgentId: string;
  /** Server-computed order total. Never the agent's claimed figure. */
  orderTotalMinor: number;
  currency: CurrencyCode;
  now: Date;
  nonceAlreadyUsed: boolean;
  verifySignature: MandateSignatureVerifier;
  /**
   * The public key this merchant ALREADY associates with the calling agent.
   *
   * THIS IS THE WHOLE POINT OF THE CHECK.
   *
   * An earlier version verified the signature against `mandate.publicKey` —
   * a field inside the same untrusted request. That proves only that whoever
   * wrote the terms also signed them, which any attacker can do in three
   * lines: generate a keypair, authorise ninety lakh rupees, sign, send.
   * Self-signed is not signed.
   *
   * `null` means this merchant has no key on file for this agent, and the
   * verifier refuses rather than falling back to the supplied one. Deciding
   * whether a first-contact key may be pinned is a policy question, so it
   * belongs to the caller — never to the code that checks signatures.
   */
  trustedPublicKey: string | null;
}

export type MandateVerificationResult =
  | { valid: true; mandate: SpendMandate }
  | { valid: false; code: MandateRejectionCode; detail: string };

/**
 * The exact bytes a mandate signature covers.
 *
 * Built with `canonicalStringify` so key order can never change what was
 * signed — the same guarantee the ledger's hash chain relies on. Signature
 * and public key are excluded: a signature cannot cover itself, and
 * including the key would let a forger swap in their own and re-sign.
 */
export function mandateSigningPayload(mandate: Omit<SpendMandate, "signature" | "publicKey">): string {
  return canonicalStringify({
    mandateId: mandate.mandateId,
    buyerAgentId: mandate.buyerAgentId,
    merchantScope: mandate.merchantScope,
    maxAmountMinor: mandate.maxAmountMinor,
    currency: mandate.currency,
    notBefore: mandate.notBefore.toISOString(),
    expiresAt: mandate.expiresAt.toISOString(),
    nonce: mandate.nonce,
  });
}

/**
 * Verifies a mandate against one concrete order.
 *
 * Order of checks is deliberate: structure, then cryptography, then terms.
 * A tampered mandate must fail as `SIGNATURE_INVALID` rather than leaking
 * which business clause it would have violated.
 */
export function verifySpendMandate(
  mandate: SpendMandate | null | undefined,
  context: MandateVerificationContext,
): MandateVerificationResult {
  if (!mandate) {
    return { valid: false, code: "MANDATE_MISSING", detail: "No spend mandate was presented with this intent." };
  }

  if (
    !mandate.mandateId ||
    !mandate.buyerAgentId ||
    !mandate.merchantScope ||
    !mandate.nonce ||
    !mandate.publicKey ||
    !mandate.signature ||
    !Number.isInteger(mandate.maxAmountMinor) ||
    mandate.maxAmountMinor <= 0 ||
    Number.isNaN(mandate.notBefore.getTime()) ||
    Number.isNaN(mandate.expiresAt.getTime())
  ) {
    return { valid: false, code: "MANDATE_MALFORMED", detail: "The mandate is missing required fields or carries an invalid amount." };
  }

  // Trust the key we already hold, never the one in the envelope.
  if (!context.trustedPublicKey) {
    return {
      valid: false,
      code: "MANDATE_KEY_NOT_REGISTERED",
      detail: "This merchant holds no signing key for the calling agent, so the mandate cannot be verified against anything trusted.",
    };
  }

  if (mandate.publicKey !== context.trustedPublicKey) {
    return {
      valid: false,
      code: "MANDATE_KEY_MISMATCH",
      detail: "The mandate was signed by a different key than the one registered for this agent.",
    };
  }

  if (!context.verifySignature(mandateSigningPayload(mandate), mandate.signature, context.trustedPublicKey)) {
    return {
      valid: false,
      code: "MANDATE_SIGNATURE_INVALID",
      detail: "The mandate signature does not match its terms; it was not issued as presented.",
    };
  }

  if (context.now.getTime() < mandate.notBefore.getTime()) {
    return { valid: false, code: "MANDATE_NOT_YET_VALID", detail: `This mandate is not valid until ${mandate.notBefore.toISOString()}.` };
  }

  if (context.now.getTime() >= mandate.expiresAt.getTime()) {
    return { valid: false, code: "MANDATE_EXPIRED", detail: `This mandate expired at ${mandate.expiresAt.toISOString()}.` };
  }

  if (mandate.merchantScope !== context.merchantId) {
    return {
      valid: false,
      code: "MANDATE_MERCHANT_SCOPE_MISMATCH",
      detail: "This mandate was issued for a different merchant and cannot be spent here.",
    };
  }

  if (mandate.buyerAgentId !== context.callerAgentId) {
    return {
      valid: false,
      code: "MANDATE_AGENT_MISMATCH",
      detail: "This mandate was issued to a different agent than the one presenting it.",
    };
  }

  if (mandate.currency !== context.currency) {
    return {
      valid: false,
      code: "MANDATE_CURRENCY_MISMATCH",
      detail: `The mandate authorises ${mandate.currency} but this order is priced in ${context.currency}.`,
    };
  }

  if (context.orderTotalMinor > mandate.maxAmountMinor) {
    return {
      valid: false,
      code: "MANDATE_AMOUNT_EXCEEDED",
      detail: `The order total exceeds the amount this mandate authorises (${mandate.maxAmountMinor} minor units).`,
    };
  }

  // Checked last: a replayed nonce on an otherwise-valid mandate is the
  // most useful thing to be able to say precisely.
  if (context.nonceAlreadyUsed) {
    return {
      valid: false,
      code: "MANDATE_NONCE_REPLAYED",
      detail: "This mandate has already been spent; mandates are single-use.",
    };
  }

  return { valid: true, mandate };
}
