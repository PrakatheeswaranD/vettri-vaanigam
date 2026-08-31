import { verify as ed25519Verify } from "node:crypto";
import { canonicalStringify, type CanonicalValue } from "@razorgrowth/domain";

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const MAX_CLOCK_SKEW_MS = 5 * 60_000;

export function acpRequestSigningPayload(
  method: string,
  path: string,
  timestamp: string,
  body: unknown,
  idempotencyKey?: string,
): string {
  return canonicalStringify({
    method: method.toUpperCase(),
    path: path.split("?", 1)[0] ?? path,
    timestamp,
    idempotencyKey: idempotencyKey ?? null,
    body: (body ?? null) as CanonicalValue,
  });
}

export function verifyAcpRequestSignature(params: {
  method: string;
  path: string;
  timestamp: string | undefined;
  signature: string | undefined;
  body: unknown;
  idempotencyKey?: string;
  publicKeyBase64: string | null;
  now?: Date;
}): { valid: true } | { valid: false; reason: string } {
  if (!params.timestamp || !params.signature) {
    return { valid: false, reason: "Signature and Timestamp headers are required." };
  }
  if (!params.publicKeyBase64) {
    return { valid: false, reason: "This agent has no merchant-trusted signing key." };
  }
  const signedAt = new Date(params.timestamp);
  if (Number.isNaN(signedAt.getTime())) return { valid: false, reason: "Timestamp is not valid ISO-8601." };
  const skew = Math.abs((params.now ?? new Date()).getTime() - signedAt.getTime());
  if (skew > MAX_CLOCK_SKEW_MS) return { valid: false, reason: "The signed request timestamp is outside the five-minute replay window." };

  try {
    const raw = Buffer.from(params.publicKeyBase64, "base64");
    if (raw.length !== 32) return { valid: false, reason: "The registered signing key is invalid." };
    const valid = ed25519Verify(
      null,
      Buffer.from(acpRequestSigningPayload(params.method, params.path, params.timestamp, params.body, params.idempotencyKey), "utf8"),
      { key: Buffer.concat([ED25519_SPKI_PREFIX, raw]), format: "der", type: "spki" },
      Buffer.from(params.signature, "base64"),
    );
    return valid ? { valid: true } : { valid: false, reason: "The detached request signature is invalid." };
  } catch {
    return { valid: false, reason: "The detached request signature could not be decoded." };
  }
}
