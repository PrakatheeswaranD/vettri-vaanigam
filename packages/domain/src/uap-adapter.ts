/**
 * Universal Agent Protocol (UAP) Adapter.
 * Parses and validates UAP agent intent payloads into standard ParsedIntent.
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

export function parseUapIntent(
  body: unknown,
  headers: Record<string, string | undefined> = {},
  version: string | null = null,
): AdapterResult {
  const root = asRecord(body);
  if (!root) return { ok: false, code: "MALFORMED_PAYLOAD", detail: "The UAP request body was not a JSON object." };

  const agent = asRecord(root.agent);
  const agentId =
    headers["x-agent-id"] ??
    (typeof agent?.id === "string" ? agent.id : undefined) ??
    (typeof root.agent_id === "string" ? root.agent_id : undefined);

  if (!agentId || agentId.trim().length === 0) {
    return { ok: false, code: "MISSING_AGENT_IDENTITY", detail: "The UAP request did not identify the calling agent." };
  }

  const intent = asRecord(root.intent) ?? root;
  const rawItems = Array.isArray(intent.items) ? intent.items : Array.isArray(root.items) ? root.items : null;

  if (!rawItems || rawItems.length === 0) {
    return { ok: false, code: "NO_LINE_ITEMS", detail: "The UAP intent contained no line items." };
  }

  const lines: ParsedIntentLine[] = [];
  for (const entry of rawItems) {
    const item = asRecord(entry);
    if (!item) return { ok: false, code: "MALFORMED_PAYLOAD", detail: "A UAP line item was not an object." };
    const sku = typeof item.sku === "string" ? item.sku : typeof item.id === "string" ? item.id : null;
    if (!sku) return { ok: false, code: "MALFORMED_PAYLOAD", detail: "A UAP line item had no SKU identifier." };
    const quantity = asPositiveInt(item.quantity ?? 1);
    if (quantity === null) {
      return { ok: false, code: "INVALID_QUANTITY", detail: `UAP line item "${sku}" had a non-positive quantity.` };
    }
    lines.push({ sku, quantity });
  }

  const buyer = asRecord(root.buyer);
  const buyerInfo = buyer
    ? {
        email: typeof buyer.email === "string" ? buyer.email : null,
        name: typeof buyer.name === "string" ? buyer.name : null,
      }
    : null;

  const rawMandate = asRecord(root.spend_mandate) ?? asRecord(root.mandate);
  let mandate: SpendMandate | null = null;
  if (rawMandate) {
    const notBeforeRaw = rawMandate.notBefore ?? rawMandate.not_before ?? new Date(0).toISOString();
    const expiresAtRaw = rawMandate.expiresAt ?? rawMandate.expires_at ?? new Date(Date.now() + 3600000).toISOString();
    const notBefore = typeof notBeforeRaw === "string" ? new Date(notBeforeRaw) : new Date(0);
    const expiresAt = typeof expiresAtRaw === "string" ? new Date(expiresAtRaw) : new Date(Date.now() + 3600000);

    const maxAmount = rawMandate.maxAmountMinor ?? rawMandate.max_amount ?? rawMandate.spend_limit;
    const maxAmountMinor = typeof maxAmount === "number" ? maxAmount : typeof maxAmount === "string" ? Number(maxAmount) : Number.NaN;

    mandate = {
      mandateId: String(rawMandate.mandateId ?? rawMandate.mandate_id ?? "uap-mandate"),
      buyerAgentId: String(rawMandate.buyerAgentId ?? rawMandate.buyer_agent_id ?? agentId),
      merchantScope: String(rawMandate.merchantScope ?? rawMandate.merchant_scope ?? ""),
      maxAmountMinor,
      currency: (rawMandate.currency === "USD" ? "USD" : "INR") as SpendMandate["currency"],
      notBefore,
      expiresAt,
      nonce: String(rawMandate.nonce ?? "nonce"),
      publicKey: String(rawMandate.publicKey ?? rawMandate.public_key ?? rawMandate.agent_public_key ?? ""),
      signature: String(rawMandate.signature ?? ""),
    };
  }

  const claimedTotal = typeof intent.total_minor === "number" ? intent.total_minor : typeof root.total === "number" ? root.total : null;
  const currency = typeof root.currency === "string" ? root.currency.toUpperCase() : typeof intent.currency === "string" ? intent.currency.toUpperCase() : null;

  const parsedIntent: ParsedIntent = {
    protocol: "UAP",
    protocolVersion: version ?? (typeof root.uap_version === "string" ? root.uap_version : "1.0"),
    agentId: agentId.trim(),
    lines,
    currency,
    claimedTotalMinor: claimedTotal,
    mandate,
    idempotencyKey: headers["idempotency-key"] ?? null,
    buyer: buyerInfo,
    protocolActorRef: null,
    unsignedAllowance: null,
    riskFlags: [],
    unverifiedSettlement: false,
    verifiedSettlement: false,
  };

  return { ok: true, intent: parsedIntent };
}
