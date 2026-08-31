/**
 * Protocol detection — reads an inbound request's own signature and decides
 * which adapter should handle it.
 *
 * A merchant should not have to publish three endpoints, and a buyer agent
 * should not have to be told which one to call. One door, and the gateway
 * works out what dialect the caller speaks.
 *
 * DESIGN: detection is on EXPLICIT markers only — a declared header or a
 * structural field the spec requires. It never guesses from a body that
 * merely looks similar, because a wrong guess would hand a payload to an
 * adapter that will misread its amounts. An unrecognised request is
 * refused with `UNKNOWN`, which the gateway turns into an explained
 * decline rather than a best-effort parse.
 */
import { AGENT_PROTOCOLS, type AgentProtocol } from "./agent-protocol.js";

export type ProtocolDetection =
  | { protocol: AgentProtocol; version: string | null; source: "HEADER" | "BODY_SHAPE" }
  | { protocol: "UNKNOWN"; version: null; source: "NONE" };

/** Header a caller can set to state its protocol outright. Checked first —
 * an explicit declaration always beats shape inference. */
export const PROTOCOL_HEADER = "x-agent-protocol";
export const PROTOCOL_VERSION_HEADER = "x-agent-protocol-version";

function normalizeHeaderProtocol(raw: string): AgentProtocol | null {
  const upper = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (upper === "X402") return "X402";
  if (upper === "ACP" || upper === "AGENTICCOMMERCE" || upper === "AGENTICCOMMERCEPROTOCOL") return "ACP";
  if (upper === "AP2" || upper === "AGENTPAYMENTS" || upper === "AGENTPAYMENTSPROTOCOL") return "AP2";
  if (upper === "UAP" || upper === "UNIVERSALAGENT" || upper === "UNIVERSALAGENTPROTOCOL") return "UAP";
  if (upper === "UCP" || upper === "UNIVERSALCHECKOUT" || upper === "UNIVERSALCHECKOUTPROTOCOL") return "UCP";
  return (AGENT_PROTOCOLS as readonly string[]).includes(upper) ? (upper as AgentProtocol) : null;
}

/**
 * Structural markers each spec requires. Kept narrow on purpose: these are
 * fields a conforming payload MUST carry, not fields it merely often has.
 */
function detectFromBody(body: unknown): { protocol: AgentProtocol; version: string | null } | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;

  // x402 is an HTTP-payment-required flow: its payload is built around a
  // payment payload plus the scheme/network it settles on.
  if (typeof record.x402Version !== "undefined") {
    return { protocol: "X402", version: record.x402Version == null ? null : String(record.x402Version) };
  }
  if (record.scheme === "exact" && typeof record.network === "string" && typeof record.payload === "object") {
    return { protocol: "X402", version: null };
  }

  // AP2 carries a mandate envelope — a cart mandate signed by the buyer's
  // agent, which is the whole point of that spec.
  if (typeof record.cart_mandate === "object" && record.cart_mandate !== null) {
    return { protocol: "AP2", version: null };
  }
  if (typeof record.intent_mandate === "object" && record.intent_mandate !== null) {
    return { protocol: "AP2", version: null };
  }

  // UAP carries uap_version or an agent + intent pair
  if (typeof record.uap_version !== "undefined" || typeof record.uapVersion !== "undefined") {
    return { protocol: "UAP", version: String(record.uap_version ?? record.uapVersion ?? "1.0") };
  }
  if (typeof record.agent === "object" && record.agent !== null && typeof record.intent === "object" && record.intent !== null) {
    return { protocol: "UAP", version: "1.0" };
  }

  // UCP carries ucp_version or a checkout with items
  if (typeof record.ucp_version !== "undefined" || typeof record.ucpVersion !== "undefined") {
    return { protocol: "UCP", version: String(record.ucp_version ?? record.ucpVersion ?? "2026-01-01") };
  }
  if (typeof record.checkout === "object" && record.checkout !== null && Array.isArray((record.checkout as Record<string, unknown>).items)) {
    return { protocol: "UCP", version: "2026-01-01" };
  }

  // ACP checkout sessions carry line items plus a buyer block.
  if (Array.isArray(record.items) && typeof record.buyer === "object" && record.buyer !== null) {
    return { protocol: "ACP", version: null };
  }

  return null;
}

export function detectProtocol(headers: Record<string, string | string[] | undefined>, body: unknown): ProtocolDetection {
  const rawHeader = headers[PROTOCOL_HEADER] ?? headers[PROTOCOL_HEADER.toUpperCase()];
  const headerValue = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;

  if (headerValue) {
    const declared = normalizeHeaderProtocol(headerValue);
    if (declared) {
      const rawVersion = headers[PROTOCOL_VERSION_HEADER];
      const version = Array.isArray(rawVersion) ? rawVersion[0] : rawVersion;
      return { protocol: declared, version: version ?? null, source: "HEADER" };
    }
    // A caller that declared something we do not implement is NOT then
    // sniffed — it told us what it is, and we do not support it. Falling
    // through to shape inference here would risk parsing a fourth
    // protocol's body with the wrong adapter.
    return { protocol: "UNKNOWN", version: null, source: "NONE" };
  }

  const inferred = detectFromBody(body);
  if (inferred) return { ...inferred, source: "BODY_SHAPE" };

  return { protocol: "UNKNOWN", version: null, source: "NONE" };
}
