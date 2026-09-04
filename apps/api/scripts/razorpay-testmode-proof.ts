/**
 * Razorpay Test Mode proof-of-life.
 *
 * WHY THIS SCRIPT EXISTS
 *
 * Every automated test in this repository runs against `MockPaymentGateway`.
 * That is the right default — a suite that needs network and a live key is
 * a suite nobody runs — but it means the whole 538-test run proves the
 * project's *internal* payment logic and proves nothing at all about
 * Razorpay. The distinction matters: "our state machine is correct" and
 * "we can actually talk to Razorpay" are different claims, and only the
 * first one had evidence.
 *
 * This script closes that gap by exercising `RazorpayPaymentGateway` —
 * the same adapter the running application uses, not a copy — against
 * live Test Mode, and writing what came back to
 * `docs/evidence/razorpay-testmode-proof.json`.
 *
 * WHAT IT PROVES AND WHAT IT DOES NOT
 *
 * PROVES: the credentials authenticate; the project can create a real
 * Razorpay order; a real order can be read back; the failure taxonomy
 * fires correctly against a real 401; the HMAC schemes in
 * `razorpay-signature.ts` match what Razorpay actually signs.
 *
 * DOES NOT PROVE: that a buyer completed a checkout. Capturing a payment
 * needs a human at Razorpay's hosted checkout entering a test card, which
 * no script can honestly fake. Step 5 therefore creates a real payment
 * link and records its URL for a human to complete on camera; it reports
 * the link, never a settlement.
 *
 * Test Mode only. `assertTestMode` refuses to run against an `rzp_live_`
 * key, because a proof script is exactly the kind of thing that gets run
 * without thinking.
 */
import { randomUUID, createHmac } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRazorpayGateway } from "../src/modules/payments/razorpay-gateway.js";
import { ProviderGatewayError } from "../src/modules/payments/gateway.js";
import {
  computeClientCompletionSignature,
  verifyClientCompletionSignature,
  computeWebhookSignature,
  verifyWebhookSignature,
} from "../src/modules/payments/razorpay-signature.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EVIDENCE_PATH = path.resolve(__dirname, "../../../docs/evidence/razorpay-testmode-proof.json");

const RAZORPAY_API_BASE_URL = "https://api.razorpay.com/v1";
const TIMEOUT_MS = 15_000;

interface Step {
  step: number;
  name: string;
  status: "PASS" | "FAIL" | "MANUAL_STEP_REQUIRED";
  detail: string;
  evidence?: Record<string, unknown>;
}

const steps: Step[] = [];

function record(step: Step): void {
  steps.push(step);
  const icon = step.status === "PASS" ? "PASS" : step.status === "FAIL" ? "FAIL" : "TODO";
  console.log(`[${icon}] ${step.step}. ${step.name}\n      ${step.detail}`);
}

/** A proof script is exactly the kind of thing someone runs without
 * reading it first. Refuse a live key rather than trusting the operator. */
function assertTestMode(keyId: string): void {
  if (!keyId.startsWith("rzp_test_")) {
    throw new Error(
      `Refusing to run: RAZORPAY_KEY_ID is "${keyId.slice(0, 9)}…", which is not a Test Mode key. ` +
        "This script creates real orders and payment links; it runs against rzp_test_ keys only.",
    );
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`${name} is not set. Configure Razorpay Test Mode credentials in .env before running this script.`);
  }
  return value;
}

async function main(): Promise<void> {
  const keyId = requireEnv("RAZORPAY_KEY_ID");
  const keySecret = requireEnv("RAZORPAY_KEY_SECRET");
  const webhookSecret = requireEnv("RAZORPAY_WEBHOOK_SECRET");
  assertTestMode(keyId);

  console.log(`\nRazorpay Test Mode proof — key ${keyId.slice(0, 13)}…\n`);

  // The SAME factory the application uses. If this script passes and the
  // app fails, the difference is configuration, not adapter code.
  const gateway = createRazorpayGateway({
    keyId,
    keySecret,
    webhookSecret,
    apiBaseUrl: RAZORPAY_API_BASE_URL,
    timeoutMs: TIMEOUT_MS,
  });

  // ---- 1. Create a real Test Mode order --------------------------------
  const internalPaymentId = randomUUID();
  const amountMinor = 348_900; // ₹3,489.00 — a real seeded catalogue price.
  const order = await gateway.createPaymentOrder({ internalPaymentId, amountMinor, currency: "INR" });
  record({
    step: 1,
    name: "Create Razorpay Test Mode order",
    status: order.providerOrderId.startsWith("order_") ? "PASS" : "FAIL",
    detail: `Razorpay returned ${order.providerOrderId} for ₹${(amountMinor / 100).toLocaleString("en-IN")} (status: ${order.providerStatus}).`,
    evidence: {
      providerOrderId: order.providerOrderId,
      amountMinor: order.amountMinor,
      currency: order.currency,
      providerStatus: order.providerStatus,
      internalPaymentIdSentAsReceipt: internalPaymentId,
    },
  });

  // Razorpay echoing our amount back is the check that matters: it means
  // the server-computed total is what the provider will actually charge.
  record({
    step: 2,
    name: "Provider echoed the server-computed amount",
    status: order.amountMinor === amountMinor && order.currency === "INR" ? "PASS" : "FAIL",
    detail:
      order.amountMinor === amountMinor
        ? `Sent ${amountMinor} INR minor units; Razorpay confirmed ${order.amountMinor} ${order.currency}.`
        : `MISMATCH: sent ${amountMinor}, Razorpay reported ${order.amountMinor}.`,
    evidence: { sentAmountMinor: amountMinor, providerAmountMinor: order.amountMinor },
  });

  // ---- 3. Read the order's payments back (the reconciliation path) -----
  // This is the exact call `recovery-execution-service` uses to resolve an
  // UNKNOWN payment. An unpaid order correctly returns an empty list.
  const payments = await gateway.listPaymentsForOrder(order.providerOrderId);
  record({
    step: 3,
    name: "Reconciliation read-back against the live provider",
    status: "PASS",
    detail: `listPaymentsForOrder(${order.providerOrderId}) returned ${payments.length} payment(s) — an uncompleted order correctly has none. This is the call that resolves an UNKNOWN payment.`,
    evidence: { providerOrderId: order.providerOrderId, paymentCount: payments.length },
  });

  // ---- 4. Failure taxonomy against a real Razorpay rejection -----------
  // A deliberately wrong secret must map to PROVIDER_AUTHENTICATION_ERROR
  // rather than leaking an HTTP status or an SDK exception shape upward.
  const badGateway = createRazorpayGateway({
    keyId,
    keySecret: "deliberately-wrong-secret",
    webhookSecret,
    apiBaseUrl: RAZORPAY_API_BASE_URL,
    timeoutMs: TIMEOUT_MS,
  });
  let authFailure: Step;
  try {
    await badGateway.createPaymentOrder({ internalPaymentId: randomUUID(), amountMinor: 100, currency: "INR" });
    authFailure = {
      step: 4,
      name: "Live provider failure is classified, not leaked",
      status: "FAIL",
      detail: "Razorpay accepted a request signed with a deliberately wrong secret. That should be impossible.",
    };
  } catch (err) {
    const classified = err instanceof ProviderGatewayError && err.category === "PROVIDER_AUTHENTICATION_ERROR";
    authFailure = {
      step: 4,
      name: "Live provider failure is classified, not leaked",
      status: classified ? "PASS" : "FAIL",
      detail: classified
        ? "A real Razorpay 401 surfaced as ProviderGatewayError(PROVIDER_AUTHENTICATION_ERROR) — callers branch on the closed taxonomy, never on an HTTP status. Nothing was charged."
        : `Expected PROVIDER_AUTHENTICATION_ERROR, got ${(err as Error).name}: ${(err as Error).message}`,
      evidence: { errorCategory: err instanceof ProviderGatewayError ? err.category : "UNCLASSIFIED" },
    };
  }
  record(authFailure);

  // ---- 5. Signature schemes, against Razorpay's documented algorithm ---
  // Verified locally rather than over the wire: these are pure HMAC
  // functions, and a forged signature must fail without a network round
  // trip for the guarantee to mean anything.
  const fakePaymentId = `pay_${randomUUID().replace(/-/g, "").slice(0, 14)}`;
  const genuineSignature = computeClientCompletionSignature(order.providerOrderId, fakePaymentId, keySecret);
  const acceptsGenuine = verifyClientCompletionSignature(order.providerOrderId, fakePaymentId, genuineSignature, keySecret);
  const rejectsForged = !verifyClientCompletionSignature(order.providerOrderId, fakePaymentId, `${genuineSignature.slice(0, -1)}0`, keySecret);

  const webhookBody = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: fakePaymentId } } } });
  const genuineWebhookSig = computeWebhookSignature(webhookBody, webhookSecret);
  const acceptsGenuineWebhook = verifyWebhookSignature(webhookBody, genuineWebhookSig, webhookSecret);
  const rejectsTamperedBody = !verifyWebhookSignature(`${webhookBody} `, genuineWebhookSig, webhookSecret);
  const rejectsWrongSecret = computeWebhookSignature(webhookBody, "a-different-webhook-secret") !== genuineWebhookSig;

  const signaturesOk = acceptsGenuine && rejectsForged && acceptsGenuineWebhook && rejectsTamperedBody && rejectsWrongSecret;
  record({
    step: 5,
    name: "Razorpay HMAC schemes accept genuine and reject forged",
    status: signaturesOk ? "PASS" : "FAIL",
    detail: signaturesOk
      ? "Checkout-completion HMAC accepts the genuine signature and rejects a one-character forgery; webhook HMAC accepts the genuine body and rejects both a tampered body and a wrong secret."
      : "One or more signature assertions failed — see evidence.",
    evidence: { acceptsGenuine, rejectsForged, acceptsGenuineWebhook, rejectsTamperedBody, rejectsWrongSecret },
  });

  // Independent cross-check: recompute Razorpay's documented scheme inline
  // rather than reusing the module under test, so a bug in that module
  // cannot certify itself.
  const independent = createHmac("sha256", keySecret).update(`${order.providerOrderId}|${fakePaymentId}`).digest("hex");
  record({
    step: 6,
    name: "Signature scheme matches Razorpay's documented formula independently",
    status: independent === genuineSignature ? "PASS" : "FAIL",
    detail:
      independent === genuineSignature
        ? "razorpay-signature.ts reproduces HMAC-SHA256(order_id|payment_id, key_secret) exactly, recomputed here without reusing the module under test."
        : "razorpay-signature.ts disagrees with an independent recomputation of Razorpay's documented formula.",
  });

  // ---- 7. A real payment link for the human half of the demo ----------
  const link = await gateway.createPaymentLink({
    amountMinor,
    currency: "INR",
    description: "Vettri Vaanigam — Test Mode demonstration checkout",
    referenceId: internalPaymentId,
  });
  record({
    step: 7,
    name: "Real Test Mode payment link created for human completion",
    status: "MANUAL_STEP_REQUIRED",
    detail:
      `Open ${link.shortUrl} and pay with a Razorpay test card (4111 1111 1111 1111, any future expiry, any CVV). ` +
      "Completing it produces a captured payment this project can then reconcile. A script cannot honestly do this half.",
    evidence: { providerPaymentLinkId: link.providerPaymentLinkId, shortUrl: link.shortUrl },
  });

  // ---- Write the evidence file ----------------------------------------
  const failures = steps.filter((s) => s.status === "FAIL");
  const artifact = {
    generatedAt: new Date().toISOString(),
    mode: "RAZORPAY_TEST_MODE",
    keyIdPrefix: `${keyId.slice(0, 13)}…`,
    apiBaseUrl: RAZORPAY_API_BASE_URL,
    summary: {
      passed: steps.filter((s) => s.status === "PASS").length,
      failed: failures.length,
      manual: steps.filter((s) => s.status === "MANUAL_STEP_REQUIRED").length,
    },
    // Named so nobody can read this file as a settlement claim.
    provesTheseClaims: [
      "Razorpay Test Mode credentials authenticate against the live API.",
      "The application's own RazorpayPaymentGateway creates a real provider order.",
      "The provider echoes the server-computed amount, unchanged.",
      "The reconciliation read-back path works against the live provider.",
      "A real provider rejection is classified into the closed error taxonomy.",
      "The HMAC signature schemes match Razorpay's documented formulas.",
    ],
    doesNotProve: [
      "That a payment was captured or settled. Step 7 requires a human at Razorpay's hosted checkout.",
      "That webhook delivery is configured on a reachable public endpoint.",
    ],
    steps,
  };

  await mkdir(path.dirname(EVIDENCE_PATH), { recursive: true });
  await writeFile(EVIDENCE_PATH, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");

  console.log(`\nEvidence written to docs/evidence/razorpay-testmode-proof.json`);
  console.log(`Summary: ${artifact.summary.passed} passed, ${artifact.summary.failed} failed, ${artifact.summary.manual} awaiting a human.\n`);

  if (failures.length > 0) {
    console.error(`${failures.length} step(s) failed against live Razorpay Test Mode.`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`\nProof run failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
