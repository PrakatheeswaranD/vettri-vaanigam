import { createHmac } from "node:crypto";
import { env } from "../../config/env.js";

const SENSITIVE_KEY = /(authorization|cookie|secret|signature|token|card|pan|cvv|email|phone|address|public.?key|payment.?method)/i;

export function stableSensitiveFingerprint(value: string): string {
  return createHmac("sha256", env.DATA_FINGERPRINT_SECRET).update(value).digest("hex");
}

export function maskEmail(value: string | null | undefined): string | null {
  if (!value) return null;
  const [local, domain] = value.trim().toLowerCase().split("@");
  if (!local || !domain) return "[redacted]";
  return `${local.slice(0, 1)}***@${domain}`;
}

export function maskPersonName(value: string | null | undefined): string | null {
  if (!value) return null;
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1)}***`)
    .join(" ");
}

/** Keeps audit structure and non-sensitive commercial facts while removing
 * credentials and buyer PII. */
export function redactProtocolPayload(value: unknown, depth = 0): unknown {
  if (depth > 12) return "[max-depth]";
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return value.length > 2_000 ? `${value.slice(0, 2_000)}…` : value;
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => redactProtocolPayload(item, depth + 1));
  if (typeof value !== "object") return "[unsupported]";

  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>).slice(0, 200)) {
    const normalized = key.toLowerCase();
    if (["buyer", "customer", "recipient"].includes(normalized) && child && typeof child === "object" && !Array.isArray(child)) {
      const identity = child as Record<string, unknown>;
      output[key] = Object.fromEntries(
        Object.entries(identity).map(([identityKey, identityValue]) => [
          identityKey,
          ["email", "name", "phone", "address"].includes(identityKey.toLowerCase())
            ? "[redacted]"
            : redactProtocolPayload(identityValue, depth + 1),
        ]),
      );
    } else {
      output[key] = SENSITIVE_KEY.test(key) ? "[redacted]" : redactProtocolPayload(child, depth + 1);
    }
  }
  return output;
}
