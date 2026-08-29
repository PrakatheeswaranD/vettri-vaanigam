/**
 * PaymentGateway factory (PART 07 §12, §202 "Allow the rest of the
 * application to remain usable if payment integration is not configured
 * where sensible"; productization sprint — a merchant/jury must be able
 * to run the complete checkout → payment → recovery flow live without
 * real Razorpay credentials). One process-lifetime singleton, chosen once:
 *
 *  - `NODE_ENV=test` → always the deterministic `MockPaymentGateway`,
 *    never live Razorpay Test Mode, regardless of what `.env` contains
 *    (a misconfigured test run must never be able to hit a real endpoint).
 *  - Real Razorpay Test Mode credentials configured → `RazorpayPaymentGateway`.
 *  - Neither → ALSO the deterministic `MockPaymentGateway`, so local
 *    development and demos can exercise the real payment state machine,
 *    webhook flow, and recovery path end-to-end. This is never presented
 *    to a user as live Razorpay: `gateway.provider === "MOCK"` is a real,
 *    honest discriminant the frontend reads (`GET /system/capabilities`)
 *    to show "Mock Gateway (demo)" rather than "Razorpay Test Mode".
 */
import { env, razorpayConfigured } from "../../config/env.js";
import type { PaymentGateway } from "./gateway.js";
import { createRazorpayGateway } from "./razorpay-gateway.js";
import { MockPaymentGateway } from "./mock-gateway.js";

let cached: PaymentGateway | null | undefined;

export function getPaymentGateway(): PaymentGateway | null {
  if (cached !== undefined) return cached;

  if (env.NODE_ENV !== "test" && razorpayConfigured) {
    cached = createRazorpayGateway({
      keyId: env.RAZORPAY_KEY_ID!,
      keySecret: env.RAZORPAY_KEY_SECRET!,
      webhookSecret: env.RAZORPAY_WEBHOOK_SECRET!,
      apiBaseUrl: env.RAZORPAY_API_BASE_URL,
      timeoutMs: env.RAZORPAY_TIMEOUT_MS,
    });
  } else {
    // A production deployment must NEVER quietly fall back to the mock.
    // It would return fabricated order and payment-link identifiers that
    // look real in every log and every screen, and the failure would only
    // surface when someone tried to reconcile money that never moved.
    // Fail at boot instead, where it is cheap to notice.
    if (env.NODE_ENV === "production") {
      throw new Error(
        "RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET / RAZORPAY_WEBHOOK_SECRET are required in production. " +
          "Refusing to start with the mock payment gateway, which returns fabricated identifiers.",
      );
    }
    cached = new MockPaymentGateway();
  }

  return cached;
}

/** Test-only accessor — asserts the test gateway really is the mock (a
 * misconfigured test environment must fail loudly, not silently hit a
 * real Razorpay endpoint) and exposes its test-only seed/queue methods. */
export function getMockPaymentGatewayForTests(): MockPaymentGateway {
  const gateway = getPaymentGateway();
  if (!(gateway instanceof MockPaymentGateway)) {
    throw new Error("getMockPaymentGatewayForTests() called outside NODE_ENV=test.");
  }
  return gateway;
}
