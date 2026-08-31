import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../../config/env.js";

function signature(decisionId: string): string {
  return createHmac("sha256", env.ACP_DELEGATION_TOKEN_SECRET)
    .update(`gateway-status:${decisionId}`)
    .digest("base64url");
}

export function issueGatewayStatusToken(decisionId: string): string {
  return `gst_${decisionId}.${signature(decisionId)}`;
}

export function verifyGatewayStatusToken(token: string, decisionId: string): boolean {
  const expected = issueGatewayStatusToken(decisionId);
  const presented = Buffer.from(token);
  const authoritative = Buffer.from(expected);
  return presented.length === authoritative.length && timingSafeEqual(presented, authoritative);
}
