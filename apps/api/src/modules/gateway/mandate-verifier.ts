/**
 * The Node implementation of the domain's `MandateSignatureVerifier`.
 *
 * `packages/domain` is deliberately dependency-free and has no Node types,
 * so the cryptography lives here and is injected in. That boundary is why
 * the mandate rules can be unit-tested without a runtime, and why the
 * signature check has exactly one implementation rather than being
 * scattered through the request path.
 */
import { verify as ed25519Verify } from "node:crypto";
import type { MandateSignatureVerifier } from "@razorgrowth/domain";

/** DER prefix for an Ed25519 SubjectPublicKeyInfo. Callers hand us a bare
 * 32-byte key in base64 — far easier for an agent to publish than PEM — and
 * this wraps it into the SPKI form `crypto.verify` expects. */
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export const verifyMandateSignature: MandateSignatureVerifier = (payload, signature, publicKeyBase64) => {
  try {
    const raw = Buffer.from(publicKeyBase64, "base64");
    // A wrong-length key is a failed verification, not an exception: an
    // attacker must never be able to turn a malformed field into a 500.
    if (raw.length !== 32) return false;

    return ed25519Verify(
      null,
      Buffer.from(payload, "utf8"),
      { key: Buffer.concat([ED25519_SPKI_PREFIX, raw]), format: "der", type: "spki" },
      Buffer.from(signature, "base64"),
    );
  } catch {
    return false;
  }
};
