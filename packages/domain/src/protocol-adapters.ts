/**
 * Protocol Adapter Mesh — three dialects, one internal shape.
 *
 * Each adapter's ONLY job is to turn its own wire format into a
 * `ParsedIntent`. Nothing here prices anything, checks a policy, or talks
 * to a database: adapters are pure parsers, which is what makes them
 * cheaply testable and what keeps a fourth protocol (NPCI's UAP, when it
 * lands) a new file rather than a change to the gateway.
 *
 * WHY SKUs AND NOT PRODUCT IDs
 *
 * An adapter emits the merchant-facing SKU the agent asked for, not an
 * internal product id — resolution needs the catalogue, and that is a
 * database concern. An unresolvable SKU is then refused downstream rather
 * than guessed at here.
 *
 * WHY NO AMOUNT IS TRUSTED
 *
 * Every one of these protocols states a price on the wire. None of them is
 * believed. The claimed figure is carried through only so the gateway can
 * compare it against the server-computed total and refuse on disagreement
 * — otherwise a caller could name its own price.
 *
 * HONESTY
 *
 * `parseAcpIntent` follows the published ACP spec shape. `parseAp2Intent`
 * and `parseX402Intent` are COMPATIBILITY SHIMS: they accept the documented
 * envelope and normalise it correctly, but have not been certified against
 * a live counterparty implementation. `PROTOCOL_FIDELITY` records this so
 * the console can label it rather than implying three equal integrations.
 */
import type { AgentProtocol } from "./agent-protocol.js";
import type { SpendMandate } from "./spend-mandate.js";

export interface ParsedIntentLine {
  sku: string;
  quantity: number;
}

export interface ParsedIntent {
  protocol: AgentProtocol;
  protocolVersion: string | null;
  agentId: string;
  lines: ParsedIntentLine[];
  currency: string | null;
  claimedTotalMinor: number | null;
  mandate: SpendMandate | null;
  idempotencyKey: string | null;
  /** The buyer the agent acts for, when the protocol carries one. */
  buyer: { email: string | null; name: string | null } | null;
  /** The source protocol's own id for this exchange (an ACP
   * checkout_session_id, an x402 nonce) so a decision traces back into the
   * counterparty's system. */
  protocolActorRef: string | null;
  /** An ACP `Allowance` presented instead of a signed Anumati mandate.
   * Carried separately BECAUSE it is unsigned — collapsing it into
   * `mandate` would let an unverified authorisation be reported as a
   * cryptographically verified one. */
  unsignedAllowance: { maxAmountMinor: number; currency: string; expiresAt: Date | null; scope: string | null } | null;
  /** Risk signals the calling platform supplied about itself. A
   * `blocked`/`manual_review` signal is evidence a ceiling cannot capture,
   * so it is carried through rather than discarded. */
  riskFlags: string[];
  /** True when the protocol's own payment proof could NOT be verified by
   * this build — x402 without a facilitator. Such an intent may never be
   * auto-approved: nobody has checked that the money exists. */
  unverifiedSettlement: boolean;
}

export const ADAPTER_REJECTION_CODES = [
  "MALFORMED_PAYLOAD",
  "MISSING_AGENT_IDENTITY",
  "NO_LINE_ITEMS",
  "INVALID_QUANTITY",
  "UNSUPPORTED_PROTOCOL",
] as const;
export type AdapterRejectionCode = (typeof ADAPTER_REJECTION_CODES)[number];

export type AdapterResult =
  | { ok: true; intent: ParsedIntent }
  | { ok: false; code: AdapterRejectionCode; detail: string };

type Json = Record<string, unknown>;

function asRecord(value: unknown): Json | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null;
}

function asPositiveInt(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Mandates ride in a shared `anumati_mandate` envelope regardless of
 * protocol. Each spec has its own signing story (AP2 signs a cart mandate,
 * x402 an authorization); rather than pretend to consume all three, the
 * gateway asks for its own mandate and says so. An absent or unreadable
 * mandate is null here — `verifySpendMandate` decides what that means.
 */
function parseMandate(source: Json): SpendMandate | null {
  const raw = asRecord(source.anumati_mandate ?? source.anumatiMandate ?? source.mandate);
  if (!raw) return null;

  const notBefore = typeof raw.notBefore === "string" ? new Date(raw.notBefore) : null;
  const expiresAt = typeof raw.expiresAt === "string" ? new Date(raw.expiresAt) : null;
  if (!notBefore || !expiresAt) return null;

  return {
    mandateId: String(raw.mandateId ?? ""),
    buyerAgentId: String(raw.buyerAgentId ?? ""),
    merchantScope: String(raw.merchantScope ?? ""),
    maxAmountMinor: typeof raw.maxAmountMinor === "number" ? raw.maxAmountMinor : Number.NaN,
    currency: (raw.currency === "USD" ? "USD" : "INR") as SpendMandate["currency"],
    notBefore,
    expiresAt,
    nonce: String(raw.nonce ?? ""),
    publicKey: String(raw.publicKey ?? ""),
    signature: String(raw.signature ?? ""),
  };
}

function parseAllowance(source: Json): ParsedIntent["unsignedAllowance"] {
  const raw = asRecord(source.acp_allowance) ?? asRecord(source.allowance);
  if (!raw || typeof raw.max_amount !== "number") return null;
  const expires = typeof raw.expires_at === "string" ? new Date(raw.expires_at) : null;
  return {
    maxAmountMinor: raw.max_amount,
    currency: typeof raw.currency === "string" ? raw.currency.toUpperCase() : "INR",
    expiresAt: expires && !Number.isNaN(expires.getTime()) ? expires : null,
    scope: typeof raw.merchant_id === "string" ? raw.merchant_id : null,
  };
}

function parseRiskFlags(source: Json): string[] {
  const signals = Array.isArray(source.risk_signals) ? source.risk_signals : [];
  return signals
    .map((entry) => asRecord(entry))
    .filter((s): s is Json => Boolean(s))
    .filter((s) => s.action === "blocked" || s.action === "manual_review")
    .map((s) => `${String(s.type ?? "risk")}:${String(s.action)}`);
}

function parseBuyer(source: Json): ParsedIntent["buyer"] {
  const raw = asRecord(source.buyer);
  if (!raw) return null;
  const email = typeof raw.email === "string" ? raw.email : null;
  const name = typeof raw.name === "string" ? raw.name : null;
  return email || name ? { email, name } : null;
}

function agentIdFrom(source: Json, headers: Record<string, string | undefined>): string | null {
  const candidate =
    headers["x-agent-id"] ??
    (typeof source.agent_id === "string" ? source.agent_id : undefined) ??
    (typeof source.agentId === "string" ? source.agentId : undefined) ??
    (asRecord(source.agent)?.id as string | undefined);
  return candidate && candidate.trim().length > 0 ? candidate.trim() : null;
}

/** ACP — implemented against the published open specification. */
export function parseAcpIntent(
  body: unknown,
  headers: Record<string, string | undefined> = {},
  version: string | null = null,
): AdapterResult {
  const root = asRecord(body);
  if (!root) return { ok: false, code: "MALFORMED_PAYLOAD", detail: "The ACP request body was not a JSON object." };

  const agentId = agentIdFrom(root, headers);
  if (!agentId) {
    return { ok: false, code: "MISSING_AGENT_IDENTITY", detail: "The ACP request did not identify the calling agent." };
  }

  const rawItems = Array.isArray(root.items) ? root.items : null;
  if (!rawItems || rawItems.length === 0) {
    return { ok: false, code: "NO_LINE_ITEMS", detail: "The ACP checkout session contained no line items." };
  }

  const lines: ParsedIntentLine[] = [];
  for (const entry of rawItems) {
    const item = asRecord(entry);
    if (!item) return { ok: false, code: "MALFORMED_PAYLOAD", detail: "An ACP line item was not an object." };
    const sku = typeof item.id === "string" ? item.id : typeof item.sku === "string" ? item.sku : null;
    if (!sku) return { ok: false, code: "MALFORMED_PAYLOAD", detail: "An ACP line item had no product identifier." };
    const quantity = asPositiveInt(item.quantity ?? 1);
    if (quantity === null) {
      return { ok: false, code: "INVALID_QUANTITY", detail: `ACP line item "${sku}" had a non-positive quantity.` };
    }
    lines.push({ sku, quantity });
  }

  const totals = asRecord(root.totals);
  const claimed = typeof totals?.total === "number" ? totals.total : typeof root.total === "number" ? root.total : null;

  return {
    ok: true,
    intent: {
      protocol: "ACP",
      protocolVersion: version,
      agentId,
      lines,
      currency: typeof root.currency === "string" ? root.currency.toUpperCase() : null,
      claimedTotalMinor: claimed,
      mandate: parseMandate(root),
      idempotencyKey: headers["idempotency-key"] ?? (typeof root.id === "string" ? root.id : null),
      buyer: parseBuyer(root),
      protocolActorRef: typeof root.protocol_actor_ref === "string" ? root.protocol_actor_ref : null,
      unsignedAllowance: parseAllowance(root),
      riskFlags: parseRiskFlags(root),
      unverifiedSettlement: root.x402_unverified_settlement === true,
    },
  };
}

/** AP2 — COMPATIBILITY SHIM. Reads the documented cart-mandate envelope. */
export function parseAp2Intent(
  body: unknown,
  headers: Record<string, string | undefined> = {},
  version: string | null = null,
): AdapterResult {
  const root = asRecord(body);
  if (!root) return { ok: false, code: "MALFORMED_PAYLOAD", detail: "The AP2 request body was not a JSON object." };

  const cart = asRecord(root.cart_mandate) ?? asRecord(root.intent_mandate);
  if (!cart) {
    return { ok: false, code: "MALFORMED_PAYLOAD", detail: "The AP2 request carried no cart or intent mandate." };
  }

  const agentId = agentIdFrom(root, headers) ?? agentIdFrom(cart, headers);
  if (!agentId) {
    return { ok: false, code: "MISSING_AGENT_IDENTITY", detail: "The AP2 mandate did not identify the calling agent." };
  }

  const contents = asRecord(cart.contents) ?? cart;
  const request = asRecord(contents.payment_request) ?? contents;
  const details = asRecord(request.details) ?? request;
  const rawItems = Array.isArray(details.displayItems)
    ? details.displayItems
    : Array.isArray(details.display_items)
      ? details.display_items
      : null;

  if (!rawItems || rawItems.length === 0) {
    return { ok: false, code: "NO_LINE_ITEMS", detail: "The AP2 cart mandate listed no display items." };
  }

  const lines: ParsedIntentLine[] = [];
  for (const entry of rawItems) {
    const item = asRecord(entry);
    if (!item) return { ok: false, code: "MALFORMED_PAYLOAD", detail: "An AP2 display item was not an object." };
    const sku = typeof item.sku === "string" ? item.sku : typeof item.label === "string" ? item.label : null;
    if (!sku) return { ok: false, code: "MALFORMED_PAYLOAD", detail: "An AP2 display item had no SKU." };
    const quantity = asPositiveInt(item.quantity ?? 1);
    if (quantity === null) {
      return { ok: false, code: "INVALID_QUANTITY", detail: `AP2 display item "${sku}" had a non-positive quantity.` };
    }
    lines.push({ sku, quantity });
  }

  const total = asRecord(details.total);
  const amount = asRecord(total?.amount);
  const claimedMajor = amount && typeof amount.value !== "undefined" ? Number(amount.value) : null;

  return {
    ok: true,
    intent: {
      protocol: "AP2",
      protocolVersion: version,
      agentId,
      lines,
      currency: typeof amount?.currency === "string" ? String(amount.currency).toUpperCase() : null,
      // AP2 states amounts in MAJOR units; everything internal is minor.
      claimedTotalMinor: claimedMajor !== null && Number.isFinite(claimedMajor) ? Math.round(claimedMajor * 100) : null,
      mandate: parseMandate(root),
      idempotencyKey: headers["idempotency-key"] ?? (typeof cart.id === "string" ? cart.id : null),
      buyer: parseBuyer(root),
      protocolActorRef: typeof cart.id === "string" ? cart.id : null,
      unsignedAllowance: parseAllowance(root),
      riskFlags: parseRiskFlags(root),
      unverifiedSettlement: root.x402_unverified_settlement === true,
    },
  };
}

/** x402 — COMPATIBILITY SHIM. Reads the HTTP-402 payment payload envelope. */
export function parseX402Intent(
  body: unknown,
  headers: Record<string, string | undefined> = {},
  version: string | null = null,
): AdapterResult {
  const root = asRecord(body);
  if (!root) return { ok: false, code: "MALFORMED_PAYLOAD", detail: "The x402 request body was not a JSON object." };

  const agentId = agentIdFrom(root, headers);
  if (!agentId) {
    return { ok: false, code: "MISSING_AGENT_IDENTITY", detail: "The x402 request did not identify the calling agent." };
  }

  const rawItems = Array.isArray(root.items) ? root.items : null;
  if (!rawItems || rawItems.length === 0) {
    return { ok: false, code: "NO_LINE_ITEMS", detail: "The x402 request listed no items to buy." };
  }

  const lines: ParsedIntentLine[] = [];
  for (const entry of rawItems) {
    const item = asRecord(entry);
    if (!item) return { ok: false, code: "MALFORMED_PAYLOAD", detail: "An x402 item was not an object." };
    const sku = typeof item.sku === "string" ? item.sku : typeof item.resource === "string" ? item.resource : null;
    if (!sku) return { ok: false, code: "MALFORMED_PAYLOAD", detail: "An x402 item had no resource identifier." };
    const quantity = asPositiveInt(item.quantity ?? 1);
    if (quantity === null) {
      return { ok: false, code: "INVALID_QUANTITY", detail: `x402 item "${sku}" had a non-positive quantity.` };
    }
    lines.push({ sku, quantity });
  }

  const payload = asRecord(root.payload);
  const authorization = asRecord(payload?.authorization);
  const rawValue = authorization?.value ?? root.maxAmountRequired;
  const claimed = typeof rawValue === "string" || typeof rawValue === "number" ? Number(rawValue) : null;

  return {
    ok: true,
    intent: {
      protocol: "X402",
      protocolVersion: version ?? (root.x402Version == null ? null : String(root.x402Version)),
      agentId,
      lines,
      currency: typeof root.currency === "string" ? root.currency.toUpperCase() : null,
      claimedTotalMinor: claimed !== null && Number.isFinite(claimed) ? Math.round(claimed) : null,
      mandate: parseMandate(root),
      idempotencyKey: headers["idempotency-key"] ?? (typeof root.nonce === "string" ? root.nonce : null),
      buyer: parseBuyer(root),
      protocolActorRef: typeof root.nonce === "string" ? root.nonce : null,
      unsignedAllowance: parseAllowance(root),
      riskFlags: parseRiskFlags(root),
      unverifiedSettlement: root.x402_unverified_settlement === true,
    },
  };
}

/** Routes a detected protocol to its adapter. The gateway calls only this. */
export function parseIntentForProtocol(
  protocol: AgentProtocol,
  body: unknown,
  headers: Record<string, string | undefined> = {},
  version: string | null = null,
): AdapterResult {
  switch (protocol) {
    case "ACP":
      return parseAcpIntent(body, headers, version);
    case "AP2":
      return parseAp2Intent(body, headers, version);
    case "X402":
      return parseX402Intent(body, headers, version);
    default:
      return { ok: false, code: "UNSUPPORTED_PROTOCOL", detail: `No adapter is registered for protocol "${protocol}".` };
  }
}
