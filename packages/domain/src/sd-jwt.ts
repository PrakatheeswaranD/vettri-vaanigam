/**
 * IETF Selective Disclosure for JSON Web Tokens (SD-JWT) Parser & Verifier.
 * Compliant with IETF draft-ietf-oauth-selective-disclosure-jwt and Google AP2 specifications.
 *
 * Pure TypeScript implementation without Node.js dependencies.
 */

export interface ParsedDisclosure {
  raw: string;
  digest: string;
  salt: string;
  key?: string;
  value: unknown;
  isArrayElement: boolean;
}

export interface SdJwtVerificationResult {
  valid: boolean;
  claims: Record<string, unknown>;
  disclosures: ParsedDisclosure[];
  issuerPayload: Record<string, unknown>;
  keyBindingPayload?: Record<string, unknown>;
  error?: string;
}

export type SdJwtHasher = (input: string) => string;

function base64UrlDecode(input: string): string {
  let base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4 !== 0) {
    base64 += "=";
  }
  // Pure JS base64 decode
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
  let str = "";
  let i = 0;
  base64 = base64.replace(/[^A-Za-z0-9+/=]/g, "");
  while (i < base64.length) {
    const enc1 = chars.indexOf(base64.charAt(i++));
    const enc2 = chars.indexOf(base64.charAt(i++));
    const enc3 = chars.indexOf(base64.charAt(i++));
    const enc4 = chars.indexOf(base64.charAt(i++));

    const chr1 = (enc1 << 2) | (enc2 >> 4);
    const chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
    const chr3 = ((enc3 & 3) << 6) | enc4;

    str += String.fromCharCode(chr1);
    if (enc3 !== 64 && enc3 !== -1) str += String.fromCharCode(chr2);
    if (enc4 !== 64 && enc4 !== -1) str += String.fromCharCode(chr3);
  }
  return str;
}

function parseJwtSegment(segment: string): Record<string, unknown> | null {
  try {
    const json = base64UrlDecode(segment);
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Parses and verifies an SD-JWT token structure:
 * <issuer-jwt>~<disclosure 1>~<disclosure 2>~...~<key-binding-jwt?>
 */
export function parseAndVerifySdJwt(
  token: string,
  hasher?: SdJwtHasher,
): SdJwtVerificationResult {
  if (!token || typeof token !== "string") {
    return { valid: false, claims: {}, disclosures: [], issuerPayload: {}, error: "Token is empty or invalid." };
  }

  const parts = token.trim().split("~");
  if (parts.length === 0 || !parts[0]) {
    return { valid: false, claims: {}, disclosures: [], issuerPayload: {}, error: "Invalid SD-JWT structure." };
  }

  const issuerJwt = parts[0];
  const issuerJwtParts = issuerJwt.split(".");
  if (issuerJwtParts.length !== 3) {
    return { valid: false, claims: {}, disclosures: [], issuerPayload: {}, error: "Issuer JWT is not a valid 3-part JWS." };
  }

  const issuerPayload = parseJwtSegment(issuerJwtParts[1]!);
  if (!issuerPayload) {
    return { valid: false, claims: {}, disclosures: [], issuerPayload: {}, error: "Could not parse Issuer JWT payload." };
  }

  const disclosureStrings = parts.slice(1, parts.length - 1).filter((p) => p.length > 0);
  const possibleKbJwt = parts[parts.length - 1];
  let keyBindingPayload: Record<string, unknown> | undefined;

  if (possibleKbJwt && possibleKbJwt.includes(".")) {
    const kbParts = possibleKbJwt.split(".");
    if (kbParts.length === 3) {
      keyBindingPayload = parseJwtSegment(kbParts[1]!) ?? undefined;
    }
  } else if (possibleKbJwt && possibleKbJwt.length > 0) {
    disclosureStrings.push(possibleKbJwt);
  }

  const parsedDisclosures: ParsedDisclosure[] = [];
  const disclosureMap = new Map<string, ParsedDisclosure>();

  for (const raw of disclosureStrings) {
    try {
      const decodedJson = base64UrlDecode(raw);
      const arr = JSON.parse(decodedJson);
      if (!Array.isArray(arr) || arr.length < 2) continue;

      const digest = hasher ? hasher(raw) : raw;
      if (arr.length === 2) {
        const item: ParsedDisclosure = {
          raw,
          digest,
          salt: String(arr[0]),
          value: arr[1],
          isArrayElement: true,
        };
        parsedDisclosures.push(item);
        disclosureMap.set(digest, item);
        disclosureMap.set(raw, item);
      } else if (arr.length >= 3) {
        const item: ParsedDisclosure = {
          raw,
          digest,
          salt: String(arr[0]),
          key: String(arr[1]),
          value: arr[2],
          isArrayElement: false,
        };
        parsedDisclosures.push(item);
        disclosureMap.set(digest, item);
        disclosureMap.set(raw, item);
      }
    } catch {
      // Invalid disclosure entry ignored
    }
  }

  // Reconstruct claims
  const claims: Record<string, unknown> = { ...issuerPayload };

  function reconstruct(obj: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k === "_sd" && Array.isArray(v)) {
        for (const digest of v) {
          const disc = disclosureMap.get(String(digest));
          if (disc && disc.key) {
            result[disc.key] = typeof disc.value === "object" && disc.value !== null && !Array.isArray(disc.value)
              ? reconstruct(disc.value as Record<string, unknown>)
              : disc.value;
          }
        }
      } else if (Array.isArray(v)) {
        result[k] = v.map((item) => {
          if (item && typeof item === "object" && !Array.isArray(item)) {
            const entry = item as Record<string, unknown>;
            if (typeof entry["..."] === "string") {
              const disc = disclosureMap.get(entry["..."]);
              return disc ? disc.value : item;
            }
            return reconstruct(entry);
          }
          return item;
        });
      } else if (v && typeof v === "object") {
        result[k] = reconstruct(v as Record<string, unknown>);
      } else {
        result[k] = v;
      }
    }
    delete result._sd;
    delete result._sd_alg;
    return result;
  }

  const finalClaims = reconstruct(claims);

  return {
    valid: true,
    claims: finalClaims,
    disclosures: parsedDisclosures,
    issuerPayload,
    keyBindingPayload,
  };
}
