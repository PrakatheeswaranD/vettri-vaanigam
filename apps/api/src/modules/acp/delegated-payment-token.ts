import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../../config/env.js";

function signature(id: string): string {
  return createHmac("sha256", env.ACP_DELEGATION_TOKEN_SECRET).update(id).digest("base64url");
}

export function issueDelegatedPaymentToken(id: string): string {
  return `dpt_${id}.${signature(id)}`;
}

export function verifyDelegatedPaymentToken(token: string): string | null {
  if (!token.startsWith("dpt_")) return null;
  const separator = token.lastIndexOf(".");
  if (separator <= 4) return null;
  const id = token.slice(4, separator);
  const presented = token.slice(separator + 1);
  const expected = signature(id);
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b) ? id : null;
}
