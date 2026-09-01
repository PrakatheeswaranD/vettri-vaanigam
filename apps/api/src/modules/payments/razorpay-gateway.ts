/**
 * RazorpayPaymentGateway — the real Razorpay Test Mode adapter (PART 07
 * §8, §13, §15). Encapsulates provider SDK/client setup, Test Mode order
 * creation, request/response mapping, and error normalization. Uses the
 * global `fetch` (Node 20+) rather than adding an SDK dependency — this
 * is a thin, fully-inspectable REST client, not a generic HTTP wrapper
 * spread across the codebase (PART 00 §13).
 *
 * No AI dependency: `grep -i "anthropic\|AIProvider"` on this file returns
 * nothing (PART 07 §8).
 */
import type { ClientCompletionParams, CreatePaymentOrderParams, PaymentGateway, PaymentGatewayPublicConfig, ProviderOrder, ProviderPaymentInfo } from "./gateway.js";
import { ProviderGatewayError } from "./gateway.js";
import type { CreatePaymentLinkParams, ProviderPaymentLink } from "./gateway.js";
import { verifyClientCompletionSignature, verifyWebhookSignature as verifyWebhookSignatureHmac } from "./razorpay-signature.js";

export interface RazorpayConfig {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
  apiBaseUrl: string;
  timeoutMs: number;
}

interface RazorpayOrderResponse {
  id: string;
  amount: number;
  currency: string;
  status: string;
}

interface RazorpayErrorBody {
  error?: { code?: string; description?: string; reason?: string };
}

interface RazorpayPaymentResponse {
  id: string;
  order_id: string | null;
  amount: number;
  currency: string;
  status: string;
  method: string | null;
  error_code: string | null;
  error_description: string | null;
  captured: boolean;
}

function basicAuthHeader(keyId: string, keySecret: string): string {
  return `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`;
}

/** Maps an HTTP-layer failure (never-connected, non-2xx response) to the
 * closed provider-error taxonomy PART 07 §154 requires — callers branch
 * on `category`, never on raw HTTP status codes or SDK exception shapes. */
async function requestJson<T>(url: string, init: RequestInit, timeoutMs: number): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      throw new ProviderGatewayError("PROVIDER_TIMEOUT", `Razorpay request timed out after ${timeoutMs}ms.`);
    }
    throw new ProviderGatewayError("PROVIDER_UNAVAILABLE", `Could not reach Razorpay: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!response.ok) {
    let body: RazorpayErrorBody = {};
    try {
      body = (await response.json()) as RazorpayErrorBody;
    } catch {
      // Non-JSON error body — fall through with an empty body.
    }
    const description = body.error?.description ?? `HTTP ${response.status}`;
    if (response.status === 401 || response.status === 403) {
      throw new ProviderGatewayError("PROVIDER_AUTHENTICATION_ERROR", `Razorpay authentication failed: ${description}`);
    }
    if (response.status === 400 || response.status === 422) {
      throw new ProviderGatewayError("PROVIDER_VALIDATION_ERROR", `Razorpay rejected the request: ${description}`);
    }
    if (response.status >= 500) {
      throw new ProviderGatewayError("PROVIDER_UNAVAILABLE", `Razorpay is unavailable: ${description}`);
    }
    throw new ProviderGatewayError("PROVIDER_UNKNOWN_ERROR", `Unexpected Razorpay response (${response.status}): ${description}`);
  }

  return (await response.json()) as T;
}

export function createRazorpayGateway(config: RazorpayConfig): PaymentGateway {
  const authHeader = basicAuthHeader(config.keyId, config.keySecret);

  return {
    provider: "RAZORPAY",

    getPublicConfig(): PaymentGatewayPublicConfig {
      return { keyId: config.keyId, testMode: true };
    },

    async createPaymentOrder(params: CreatePaymentOrderParams): Promise<ProviderOrder> {
      const body = await requestJson<RazorpayOrderResponse>(
        `${config.apiBaseUrl}/orders`,
        {
          method: "POST",
          headers: { Authorization: authHeader, "Content-Type": "application/json" },
          // `payment_capture: 1` (auto-capture) means Razorpay Test Mode
          // captures a successfully-authorized payment automatically —
          // PART 07 deliberately does not implement a manual capture API
          // call (§54 note: capture is provider evidence we RECEIVE, via
          // webhook/fetch, not an action we separately trigger).
          body: JSON.stringify({
            amount: params.amountMinor,
            currency: params.currency,
            receipt: params.internalPaymentId,
            payment_capture: 1,
            notes: { internalPaymentId: params.internalPaymentId },
          }),
        },
        config.timeoutMs,
      );
      return { providerOrderId: body.id, amountMinor: body.amount, currency: body.currency, providerStatus: body.status };
    },

    async fetchPayment(providerPaymentId: string): Promise<ProviderPaymentInfo> {
      const body = await requestJson<RazorpayPaymentResponse>(
        `${config.apiBaseUrl}/payments/${encodeURIComponent(providerPaymentId)}`,
        { method: "GET", headers: { Authorization: authHeader } },
        config.timeoutMs,
      );
      return {
        providerPaymentId: body.id,
        providerOrderId: body.order_id,
        amountMinor: body.amount,
        currency: body.currency,
        providerStatus: body.status,
        method: body.method,
        errorCode: body.error_code,
        errorDescription: body.error_description,
        capturedAt: body.captured ? new Date() : null,
      };
    },

    async listPaymentsForOrder(providerOrderId: string): Promise<ProviderPaymentInfo[]> {
      const body = await requestJson<{ items: RazorpayPaymentResponse[] }>(
        `${config.apiBaseUrl}/orders/${encodeURIComponent(providerOrderId)}/payments`,
        { method: "GET", headers: { Authorization: authHeader } },
        config.timeoutMs,
      );
      return (body.items ?? []).map((p) => ({
        providerPaymentId: p.id,
        providerOrderId: p.order_id,
        amountMinor: p.amount,
        currency: p.currency,
        providerStatus: p.status,
        method: p.method,
        errorCode: p.error_code,
        errorDescription: p.error_description,
        capturedAt: p.captured ? new Date() : null,
      }));
    },

    async createPaymentLink(params: CreatePaymentLinkParams): Promise<ProviderPaymentLink> {
      const body = await requestJson<{ id: string; short_url: string }>(
        `${config.apiBaseUrl}/payment_links`,
        {
          method: "POST",
          headers: { Authorization: authHeader, "Content-Type": "application/json" },
          body: JSON.stringify({
            amount: params.amountMinor,
            currency: params.currency,
            description: params.description,
            reference_id: params.referenceId,
            // No `customer` block at all. The merchant is the one
            // approving, and we hold no contact details for a buyer agent —
            // Razorpay rejects an empty customer object outright
            // ("faulty key: customer"), so the field is omitted rather than
            // sent hollow.
            notify: { sms: false, email: false },
            reminder_enable: false,
            notes: { referenceId: params.referenceId, source: "vaanigam-step-up" },
          }),
        },
        config.timeoutMs,
      );
      return { providerPaymentLinkId: body.id, shortUrl: body.short_url };
    },

    verifyClientCompletion(params: ClientCompletionParams): boolean {
      return verifyClientCompletionSignature(params.providerOrderId, params.providerPaymentId, params.signature, config.keySecret);
    },

    verifyWebhookSignature(rawBody: string | Buffer, signatureHeader: string | undefined): boolean {
      return verifyWebhookSignatureHmac(rawBody, signatureHeader, config.webhookSecret);
    },
  };
}
