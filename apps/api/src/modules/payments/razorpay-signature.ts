/**
 * Razorpay's documented HMAC-SHA256 signature schemes (PART 07 §28, §36).
 * Pure functions — no network call, no SDK dependency. Both
 * `RazorpayPaymentGateway` and `MockPaymentGateway` use these against
 * their own respective secret, so signature-verification tests exercise
 * the real algorithm without ever touching the network (PART 07 §115-
 * §117).
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/** Constant-time comparison — a signature check that used `===` would let
 * an attacker use response-timing to guess the correct value one byte at
 * a time (PART 07 §28). */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Razorpay's client-checkout completion signature: `HMAC-SHA256(order_id
 * + "|" + payment_id, key_secret)`, hex-encoded (PART 07 §36, §38). */
export function computeClientCompletionSignature(orderId: string, paymentId: string, keySecret: string): string {
  return createHmac("sha256", keySecret).update(`${orderId}|${paymentId}`).digest("hex");
}

export function verifyClientCompletionSignature(orderId: string, paymentId: string, signature: string, keySecret: string): boolean {
  return safeEqual(computeClientCompletionSignature(orderId, paymentId, keySecret), signature);
}

/** Razorpay's webhook signature: `HMAC-SHA256(raw request body,
 * webhook_secret)`, hex-encoded, sent in the `X-Razorpay-Signature`
 * header (PART 07 §26, §28). Computed over the EXACT raw bytes — never a
 * JSON.parse-then-re-stringify of the body, which is not guaranteed to
 * byte-for-byte match what Razorpay actually signed (PART 07 §117). */
export function computeWebhookSignature(rawBody: string | Buffer, webhookSecret: string): string {
  return createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
}

export function verifyWebhookSignature(rawBody: string | Buffer, signatureHeader: string | undefined, webhookSecret: string): boolean {
  if (!signatureHeader) return false;
  return safeEqual(computeWebhookSignature(rawBody, webhookSecret), signatureHeader);
}
