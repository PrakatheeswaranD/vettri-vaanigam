/**
 * MockPaymentGateway — deterministic test double (PART 00 §13; PART 07
 * §9, §115). Implements the exact same `PaymentGateway` interface as
 * `RazorpayPaymentGateway`, so `payment-service.ts`/`webhook-service.ts`
 * never know which one they have. No network call anywhere in this file.
 *
 * Signature verification uses the SAME real HMAC algorithm
 * (`razorpay-signature.ts`) as the real adapter, just against a fixed
 * mock secret — tests exercise the actual verification code path, not a
 * stubbed-out `return true`.
 */
import { randomUUID } from "node:crypto";
import type { CreatePaymentLinkParams, ProviderPaymentLink, ClientCompletionParams, CreatePaymentOrderParams, PaymentGateway, PaymentGatewayPublicConfig, ProviderOrder, ProviderPaymentInfo } from "./gateway.js";
import { ProviderGatewayError } from "./gateway.js";
import { verifyClientCompletionSignature, verifyWebhookSignature as verifyWebhookSignatureHmac } from "./razorpay-signature.js";

export const MOCK_KEY_ID = "mock_test_key_id";
export const MOCK_KEY_SECRET = "mock_test_key_secret";
export const MOCK_WEBHOOK_SECRET = "mock_test_webhook_secret";

export class MockPaymentGateway implements PaymentGateway {
  readonly provider = "MOCK" as const;
  private readonly payments = new Map<string, ProviderPaymentInfo>();
  private readonly orders = new Map<string, ProviderOrder[]>();
  private queuedOrderError: ProviderGatewayError | null = null;
  private queuedFetchError: ProviderGatewayError | null = null;

  getPublicConfig(): PaymentGatewayPublicConfig {
    return { keyId: MOCK_KEY_ID, testMode: true };
  }

  /** Test helper — the next `createPaymentOrder` call throws this instead
   * of succeeding (simulates a provider timeout/validation/outage). */
  queueOrderCreationError(err: ProviderGatewayError): void {
    this.queuedOrderError = err;
  }

  /** Test helper — the next `fetchPayment` call throws this. */
  queueFetchError(err: ProviderGatewayError): void {
    this.queuedFetchError = err;
  }

  async createPaymentOrder(params: CreatePaymentOrderParams): Promise<ProviderOrder> {
    if (this.queuedOrderError) {
      const err = this.queuedOrderError;
      this.queuedOrderError = null;
      throw err;
    }
    const order = { providerOrderId: `mock_order_${randomUUID()}`, amountMinor: params.amountMinor, currency: params.currency, providerStatus: "created" };
    this.orders.set(params.internalPaymentId, [...(this.orders.get(params.internalPaymentId) ?? []), order]);
    return order;
  }

  async findOrdersByReceipt(receipt: string): Promise<ProviderOrder[]> {
    return this.orders.get(receipt) ?? [];
  }

  async fetchPayment(providerPaymentId: string): Promise<ProviderPaymentInfo> {
    if (this.queuedFetchError) {
      const err = this.queuedFetchError;
      this.queuedFetchError = null;
      throw err;
    }
    const info = this.payments.get(providerPaymentId);
    if (!info) {
      throw new ProviderGatewayError("PROVIDER_VALIDATION_ERROR", `Unknown mock payment: ${providerPaymentId}`);
    }
    return info;
  }

  /** Test helper — registers what a subsequent `fetchPayment` for this ID
   * should return, simulating a real Razorpay Test Mode payment reaching
   * a given status (used for reconciliation tests). */
  seedPayment(info: ProviderPaymentInfo): void {
    if (!info.providerPaymentId) {
      throw new Error("Mock provider evidence requires a providerPaymentId.");
    }
    this.payments.set(info.providerPaymentId, info);
  }

  async listPaymentsForOrder(providerOrderId: string): Promise<ProviderPaymentInfo[]> {
    if (this.queuedFetchError) {
      const err = this.queuedFetchError;
      this.queuedFetchError = null;
      throw err;
    }
    return [...this.payments.values()].filter((p) => p.providerOrderId === providerOrderId);
  }

  /** Deterministic stand-in: a stable fake link so the Step-Up Gate can be
   * exercised end to end without a live provider call. */
  async createPaymentLink(_params: CreatePaymentLinkParams): Promise<ProviderPaymentLink> {
    const id = `plink_mock_${randomUUID().replace(/-/g, "").slice(0, 14)}`;
    return { providerPaymentLinkId: id, shortUrl: `https://rzp.io/i/${id}` };
  }

  verifyClientCompletion(params: ClientCompletionParams): boolean {
    return verifyClientCompletionSignature(params.providerOrderId, params.providerPaymentId, params.signature, MOCK_KEY_SECRET);
  }

  verifyWebhookSignature(rawBody: string | Buffer, signatureHeader: string | undefined): boolean {
    return verifyWebhookSignatureHmac(rawBody, signatureHeader, MOCK_WEBHOOK_SECRET);
  }
}
