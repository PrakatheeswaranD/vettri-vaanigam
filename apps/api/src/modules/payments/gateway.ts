/**
 * PaymentGateway — internal payment-provider boundary (PART 00 §13, §54;
 * PART 07 §7-§8).
 *
 * Deterministic domain/application code depends on THIS interface, never
 * on Razorpay's SDK/REST API directly. Methods are narrow and named for
 * what they actually do — no `executeMoneyAction()` catch-all. The real
 * adapter (`RazorpayPaymentGateway`) and the deterministic test double
 * (`MockPaymentGateway`) both implement this interface identically;
 * calling code never branches on which one it has.
 */

export class ProviderGatewayError extends Error {
  constructor(
    public readonly category:
      | "PROVIDER_AUTHENTICATION_ERROR"
      | "PROVIDER_VALIDATION_ERROR"
      | "PROVIDER_TIMEOUT"
      | "PROVIDER_UNAVAILABLE"
      | "PROVIDER_UNKNOWN_ERROR",
    message: string,
  ) {
    super(message);
    this.name = "ProviderGatewayError";
  }
}

export interface CreatePaymentOrderParams {
  /** Our own internal `Payment.id` — never a provider identifier. Used as
   * the provider order's `receipt` so a lost response can later be
   * reconciled (PART 07 §61). */
  internalPaymentId: string;
  amountMinor: number;
  currency: string;
}

export interface ProviderOrder {
  providerOrderId: string;
  amountMinor: number;
  currency: string;
  /** Razorpay's own order status (`created`/`attempted`/`paid`) — kept as
   * a raw provider string here; internal `PaymentState` is derived
   * separately, only from a payment (not order) event. */
  providerStatus: string;
}

export interface ProviderPaymentInfo {
  /** Some rails can definitively reject before creating a transaction id.
   * Successful authorization/capture evidence must still provide one. */
  providerPaymentId?: string;
  providerOrderId: string | null;
  amountMinor: number;
  currency: string;
  /** Razorpay's own payment status: `created` | `authorized` | `captured`
   * | `failed` | `refunded`. Mapping this to internal `PaymentState` is
   * the caller's job (`payment-transition.ts`), not the gateway's — the
   * gateway only translates the provider's wire shape, never decides
   * financial truth. */
  providerStatus: string;
  method: string | null;
  errorCode: string | null;
  errorDescription: string | null;
  capturedAt: Date | null;
}

export interface CreatePaymentLinkParams {
  amountMinor: number;
  currency: string;
  /** Shown to the human approving it — says which agent asked and why. */
  description: string;
  /** Our own reference, so a paid link can be tied back to its decision. */
  referenceId: string;
}

export interface ProviderPaymentLink {
  providerPaymentLinkId: string;
  shortUrl: string;
}

export interface ClientCompletionParams {
  providerOrderId: string;
  providerPaymentId: string;
  signature: string;
}

export interface PaymentGatewayPublicConfig {
  keyId: string;
  testMode: boolean;
}

export interface PaymentGateway {
  readonly provider: "RAZORPAY" | "MOCK";

  /** Safe, client-facing configuration (a public key ID, never a secret) —
   * `null` when the gateway is not configured for real use (PART 07 §11,
   * §65). */
  getPublicConfig(): PaymentGatewayPublicConfig | null;

  createPaymentOrder(params: CreatePaymentOrderParams): Promise<ProviderOrder>;

  fetchPayment(providerPaymentId: string): Promise<ProviderPaymentInfo>;

  /**
   * Creates a hosted payment link for the Step-Up Gate.
   *
   * An agent intent above the merchant's auto-approve ceiling is not
   * refused — it drops to a link a human approves, mirroring how UPI
   * AutoPay escalates above its own auto-debit limit. Returning a link
   * rather than charging is the entire point: the gateway never converts
   * "too big to approve automatically" into "charged anyway".
   */
  createPaymentLink(params: CreatePaymentLinkParams): Promise<ProviderPaymentLink>;

  /** Every payment the provider has recorded against one provider ORDER,
   * newest-relevant first is NOT guaranteed — the caller decides which one
   * is authoritative.
   *
   * This exists because a payment can be stranded: the customer completes
   * checkout, but the browser closes before the callback and the webhook
   * is missed or never configured. We then hold a provider ORDER id and no
   * provider PAYMENT id, so `fetchPayment` has nothing to look up and the
   * row sits at CREATED forever even though the provider considers it
   * paid. Looking up by order is the only way back to the truth
   * (PART 07 §61). */
  listPaymentsForOrder(providerOrderId: string): Promise<ProviderPaymentInfo[]>;

  /** Verifies the HMAC relation Razorpay's documented client-checkout
   * integration requires between `providerOrderId`, `providerPaymentId`,
   * and `signature` (PART 07 §36, §38). Pure, no network call — this is
   * NOT sufficient proof of payment on its own (PART 07 §41: the browser
   * callback is the lowest-confidence evidence tier); it only proves the
   * three values are internally consistent and were signed with the
   * merchant's own key secret. */
  verifyClientCompletion(params: ClientCompletionParams): boolean;

  /** Verifies a webhook delivery's signature against the RAW request body
   * (PART 07 §26, §28) — never a re-serialized/re-parsed representation,
   * which could differ from what was actually signed. Pure, no network
   * call. */
  verifyWebhookSignature(rawBody: string | Buffer, signatureHeader: string | undefined): boolean;
}
