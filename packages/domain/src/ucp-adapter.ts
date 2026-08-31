/**
 * Universal Checkout Protocol (UCP) Adapter.
 * Parses and validates UCP checkout intent payloads into standard ParsedIntent.
 */
import type { AdapterResult, ParsedIntentLine, ParsedIntent } from "./protocol-adapters.js";
import type { SpendMandate } from "./spend-mandate.js";

type Json = Record<string, unknown>;

function asRecord(value: unknown): Json | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null;
}

function asPositiveInt(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isInteger(n) && n > 0 ? n : null;
}

export function parseUcpIntent(
  body: unknown,
  headers: Record<string, string | undefined> = {},
  version: string | null = null,
): AdapterResult {
  const root = asRecord(body);
  if (!root) return { ok: false, code: "MALFORMED_PAYLOAD", detail: "The UCP request body was not a JSON object." };

  const agentId =
    headers["x-agent-id"] ??
    (typeof root.agent_id === "string" ? root.agent_id : undefined) ??
    (typeof root.agentId === "string" ? root.agentId : undefined);

  if (!agentId || agentId.trim().length === 0) {
    return { ok: false, code: "MISSING_AGENT_IDENTITY", detail: "The UCP request did not identify the calling agent." };
  }

  const checkout = asRecord(root.checkout) ?? asRecord(root.cart) ?? root;
  const rawItems = Array.isArray(checkout.items) ? checkout.items : Array.isArray(root.items) ? root.items : null;

  if (!rawItems || rawItems.length === 0) {
    return { ok: false, code: "NO_LINE_ITEMS", detail: "The UCP checkout contained no line items." };
  }

  const lines: ParsedIntentLine[] = [];
  for (const entry of rawItems) {
    const item = asRecord(entry);
    if (!item) return { ok: false, code: "MALFORMED_PAYLOAD", detail: "A UCP line item was not an object." };
    const sku = typeof item.sku === "string" ? item.sku : typeof item.id === "string" ? item.id : null;
    if (!sku) return { ok: false, code: "MALFORMED_PAYLOAD", detail: "A UCP line item had no SKU identifier." };
    const quantity = asPositiveInt(item.quantity ?? 1);
    if (quantity === null) {
      return { ok: false, code: "INVALID_QUANTITY", detail: `UCP line item "${sku}" had a non-positive quantity.` };
    }
    lines.push({ sku, quantity });
  }

  const buyer = asRecord(root.buyer_info) ?? asRecord(root.buyer);
  const buyerInfo = buyer
    ? {
        email: typeof buyer.email === "string" ? buyer.email : null,
        name: typeof buyer.name === "string" ? buyer.name : null,
      }
    : null;

  const rawMandate = asRecord(root.spend_mandate) ?? asRecord(root.mandate);
  let mandate: SpendMandate | null = null;
  if (rawMandate) {
    const notBefore = typeof rawMandate.notBefore === "string" ? new Date(rawMandate.notBefore) : null;
    const expiresAt = typeof rawMandate.expiresAt === "string" ? new Date(rawMandate.expiresAt) : null;
    if (notBefore && expiresAt) {
      mandate = {
        mandateId: String(rawMandate.mandateId ?? ""),
        buyerAgentId: String(rawMandate.buyerAgentId ?? agentId),
        merchantScope: String(rawMandate.merchantScope ?? ""),
        maxAmountMinor: typeof rawMandate.maxAmountMinor === "number" ? rawMandate.maxAmountMinor : Number.NaN,
        currency: (rawMandate.currency === "USD" ? "USD" : "INR") as SpendMandate["currency"],
        notBefore,
        expiresAt,
        nonce: String(rawMandate.nonce ?? ""),
        publicKey: String(rawMandate.publicKey ?? ""),
        signature: String(rawMandate.signature ?? ""),
      };
    }
  }

  const claimedTotal =
    typeof checkout.total_minor === "number"
      ? checkout.total_minor
      : typeof checkout.totalAmountMinor === "number"
        ? checkout.totalAmountMinor
        : typeof root.total === "number"
          ? root.total
          : null;

  const currency =
    typeof checkout.currency === "string"
      ? checkout.currency.toUpperCase()
      : typeof root.currency === "string"
        ? root.currency.toUpperCase()
        : null;

  const parsedIntent: ParsedIntent = {
    protocol: "UCP",
    protocolVersion: version ?? (typeof root.ucp_version === "string" ? root.ucp_version : "2026-01-01"),
    agentId: agentId.trim(),
    lines,
    currency,
    claimedTotalMinor: claimedTotal,
    mandate,
    idempotencyKey: headers["idempotency-key"] ?? (typeof root.checkout_id === "string" ? root.checkout_id : null),
    buyer: buyerInfo,
    protocolActorRef: typeof root.checkout_id === "string" ? root.checkout_id : null,
    unsignedAllowance: null,
    riskFlags: [],
    unverifiedSettlement: false,
    verifiedSettlement: false,
  };

  return { ok: true, intent: parsedIntent };
}
