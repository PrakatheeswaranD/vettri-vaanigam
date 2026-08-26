/**
 * PaymentGateway factory (PART 07 §12, §202 "Allow the rest of the
 * application to remain usable if payment integration is not configured
 * where sensible"). One process-lifetime singleton, chosen once:
 *
 *  - `NODE_ENV=test` → always the deterministic `MockPaymentGateway`,
 *    never live Razorpay Test Mode, regardless of what `.env` contains.
 *  - Real Razorpay Test Mode credentials configured → `RazorpayPaymentGateway`.
 *  - Neither → `null`. Every route that would move money checks for
 *    `null` and returns a safe `PAYMENT_NOT_CONFIGURED` error; nothing
 *    else in the application depends on payment integration being present.
 */
import { env, razorpayConfigured } from "../../config/env.js";
import type { PaymentGateway } from "./gateway.js";
import { createRazorpayGateway } from "./razorpay-gateway.js";
import { MockPaymentGateway } from "./mock-gateway.js";

let cached: PaymentGateway | null | undefined;

export function getPaymentGateway(): PaymentGateway | null {
  if (cached !== undefined) return cached;

  if (env.NODE_ENV === "test") {
    cached = new MockPaymentGateway();
  } else if (razorpayConfigured) {
    cached = createRazorpayGateway({
      keyId: env.RAZORPAY_KEY_ID!,
      keySecret: env.RAZORPAY_KEY_SECRET!,
      webhookSecret: env.RAZORPAY_WEBHOOK_SECRET!,
      apiBaseUrl: env.RAZORPAY_API_BASE_URL,
      timeoutMs: env.RAZORPAY_TIMEOUT_MS,
    });
  } else {
    cached = null;
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
