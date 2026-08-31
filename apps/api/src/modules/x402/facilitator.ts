import { env } from "../../config/env.js";

export interface X402PaymentRequirements {
  scheme: string;
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown>;
}

export interface X402PaymentPayload {
  x402Version: number;
  resource?: Record<string, unknown>;
  accepted: X402PaymentRequirements;
  payload: Record<string, unknown>;
  extensions?: Record<string, unknown>;
}

async function facilitatorPost(path: "/verify" | "/settle", paymentPayload: X402PaymentPayload, paymentRequirements: X402PaymentRequirements) {
  if (!env.X402_FACILITATOR_URL) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.X402_FACILITATOR_TIMEOUT_MS);
  try {
    const response = await fetch(`${env.X402_FACILITATOR_URL.replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(env.X402_FACILITATOR_API_KEY ? { authorization: `Bearer ${env.X402_FACILITATOR_API_KEY}` } : {}),
      },
      body: JSON.stringify({ x402Version: 2, paymentPayload, paymentRequirements }),
      signal: controller.signal,
    });
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!response.ok || !body) throw new Error(`x402 facilitator ${path} failed with HTTP ${response.status}`);
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

export async function verifyX402Payment(paymentPayload: X402PaymentPayload, paymentRequirements: X402PaymentRequirements) {
  const body = await facilitatorPost("/verify", paymentPayload, paymentRequirements);
  if (!body) return { configured: false as const, isValid: false, invalidReason: "facilitator_not_configured", payer: null };
  return {
    configured: true as const,
    isValid: body.isValid === true,
    invalidReason: typeof body.invalidReason === "string" ? body.invalidReason : null,
    payer: typeof body.payer === "string" ? body.payer : null,
  };
}

export async function settleX402Payment(paymentPayload: X402PaymentPayload, paymentRequirements: X402PaymentRequirements) {
  const body = await facilitatorPost("/settle", paymentPayload, paymentRequirements);
  if (!body) throw new Error("x402 facilitator is not configured");
  const transaction = typeof body.transaction === "string" ? body.transaction.trim() : "";
  const network = typeof body.network === "string" ? body.network : paymentRequirements.network;
  const amount = typeof body.amount === "string" ? body.amount : paymentRequirements.amount;
  const responseMatchesQuote = network === paymentRequirements.network && amount === paymentRequirements.amount;
  const success = body.success === true && transaction.length > 0 && responseMatchesQuote;
  return {
    success,
    definitiveFailure: body.success === false,
    errorReason:
      typeof body.errorReason === "string"
        ? body.errorReason
        : body.success === true && !transaction
          ? "missing_transaction_identifier"
          : body.success === true && !responseMatchesQuote
            ? "settlement_response_mismatch"
            : null,
    payer: typeof body.payer === "string" ? body.payer : null,
    transaction,
    network,
    amount,
  };
}

export function encodeX402Header(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}
