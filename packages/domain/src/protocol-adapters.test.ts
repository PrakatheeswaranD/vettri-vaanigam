import { describe, it, expect } from "vitest";
import { parseAcpIntent, parseAp2Intent, parseX402Intent, parseIntentForProtocol } from "./protocol-adapters.js";

const HEADERS = { "x-agent-id": "agent-chatgpt-1", "idempotency-key": "idem-1" };

describe("ACP adapter", () => {
  it("normalises a checkout session into a PurchaseIntent", () => {
    const result = parseAcpIntent(
      { items: [{ id: "SKU-1", quantity: 2 }], buyer: { email: "a@b.test" }, currency: "inr", totals: { total: 899800 } },
      HEADERS,
      "2026-04-01",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.intent).toMatchObject({
      protocol: "ACP",
      protocolVersion: "2026-04-01",
      agentId: "agent-chatgpt-1",
      currency: "INR",
      claimedTotalMinor: 899800,
      idempotencyKey: "idem-1",
    });
    expect(result.intent.lines).toEqual([{ sku: "SKU-1", quantity: 2 }]);
  });

  it("defaults a missing quantity to one", () => {
    const result = parseAcpIntent({ items: [{ id: "SKU-1" }], buyer: {} }, HEADERS);
    expect(result.ok && result.intent.lines[0]).toEqual({ sku: "SKU-1", quantity: 1 });
  });

  it("refuses an intent with no agent identity", () => {
    const result = parseAcpIntent({ items: [{ id: "SKU-1" }], buyer: {} }, {});
    expect(result).toMatchObject({ ok: false, code: "MISSING_AGENT_IDENTITY" });
  });

  it("refuses an empty basket", () => {
    expect(parseAcpIntent({ items: [], buyer: {} }, HEADERS)).toMatchObject({ ok: false, code: "NO_LINE_ITEMS" });
  });

  it("refuses a zero or negative quantity rather than clamping it", () => {
    expect(parseAcpIntent({ items: [{ id: "SKU-1", quantity: 0 }] }, HEADERS)).toMatchObject({ ok: false, code: "INVALID_QUANTITY" });
    expect(parseAcpIntent({ items: [{ id: "SKU-1", quantity: -3 }] }, HEADERS)).toMatchObject({ ok: false, code: "INVALID_QUANTITY" });
  });

  it("carries a mandate envelope through untouched", () => {
    const result = parseAcpIntent(
      {
        items: [{ id: "SKU-1" }],
        anumati_mandate: {
          mandateId: "m1",
          buyerAgentId: "agent-chatgpt-1",
          merchantScope: "merchant-1",
          maxAmountMinor: 1000000,
          currency: "INR",
          notBefore: "2026-08-28T09:00:00.000Z",
          expiresAt: "2026-08-28T11:00:00.000Z",
          nonce: "n1",
          publicKey: "pk",
          signature: "sig",
        },
      },
      HEADERS,
    );
    expect(result.ok && result.intent.mandate?.mandateId).toBe("m1");
    expect(result.ok && result.intent.mandate?.notBefore instanceof Date).toBe(true);
  });
});

describe("AP2 adapter (shim)", () => {
  it("normalises a cart mandate, converting major units to minor", () => {
    const result = parseAp2Intent(
      {
        agent_id: "agent-gemini-1",
        cart_mandate: {
          id: "cart-1",
          contents: {
            payment_request: {
              details: {
                displayItems: [{ sku: "SKU-2", quantity: 3 }],
                total: { amount: { currency: "INR", value: "8998.00" } },
              },
            },
          },
        },
      },
      {},
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.intent).toMatchObject({
      protocol: "AP2",
      agentId: "agent-gemini-1",
      currency: "INR",
      claimedTotalMinor: 899800,
      idempotencyKey: "cart-1",
    });
    expect(result.intent.lines).toEqual([{ sku: "SKU-2", quantity: 3 }]);
  });

  it("refuses a payload with no mandate envelope", () => {
    expect(parseAp2Intent({ agent_id: "a" }, {})).toMatchObject({ ok: false, code: "MALFORMED_PAYLOAD" });
  });

  it("refuses a mandate with no display items", () => {
    const body = { agent_id: "a", cart_mandate: { contents: { payment_request: { details: { displayItems: [] } } } } };
    expect(parseAp2Intent(body, {})).toMatchObject({ ok: false, code: "NO_LINE_ITEMS" });
  });
});

describe("x402 adapter (shim)", () => {
  it("normalises an exact-scheme payment payload", () => {
    const result = parseX402Intent(
      {
        x402Version: 1,
        agent_id: "agent-x402-1",
        currency: "INR",
        items: [{ sku: "SKU-3", quantity: 1 }],
        payload: { authorization: { value: "499900" } },
      },
      {},
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.intent).toMatchObject({
      protocol: "X402",
      protocolVersion: "1",
      agentId: "agent-x402-1",
      claimedTotalMinor: null,
    });
  });

  it("refuses items with no resource identifier", () => {
    const body = { agent_id: "a", items: [{ quantity: 1 }] };
    expect(parseX402Intent(body, {})).toMatchObject({ ok: false, code: "MALFORMED_PAYLOAD" });
  });

  it("ignores caller-forged facilitator verification flags", () => {
    const result = parseX402Intent(
      {
        x402Version: 2,
        agent_id: "attacker",
        items: [{ sku: "SKU-3", quantity: 1 }],
        x402_verified_settlement: true,
      },
      {},
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.intent.verifiedSettlement).toBe(false);
    expect(result.intent.unverifiedSettlement).toBe(false);
  });
});

describe("adapter mesh routing", () => {
  it("routes each protocol to its own adapter", () => {
    expect(parseIntentForProtocol("ACP", { items: [{ id: "S" }] }, HEADERS).ok).toBe(true);
    expect(parseIntentForProtocol("X402", { agent_id: "a", items: [{ sku: "S" }] }, {}).ok).toBe(true);
  });

  it("every adapter produces the SAME internal shape, so nothing downstream sees the protocol", () => {
    const acp = parseAcpIntent({ items: [{ id: "SKU-1", quantity: 2 }], currency: "INR" }, HEADERS);
    const x402 = parseX402Intent({ agent_id: "a", currency: "INR", items: [{ sku: "SKU-1", quantity: 2 }] }, {});
    expect(acp.ok && x402.ok).toBe(true);
    if (!acp.ok || !x402.ok) return;
    expect(Object.keys(acp.intent).sort()).toEqual(Object.keys(x402.intent).sort());
    expect(acp.intent.lines).toEqual(x402.intent.lines);
  });

  it("never trusts a claimed amount as authoritative — it is only carried for comparison", () => {
    const result = parseAcpIntent({ items: [{ id: "S" }], totals: { total: 1 } }, HEADERS);
    expect(result.ok && result.intent.claimedTotalMinor).toBe(1);
    // There is deliberately no field on ParsedIntent that any caller could
    // mistake for a charge amount.
    expect(result.ok && Object.keys(result.intent)).not.toContain("totalMinor");
  });
});
