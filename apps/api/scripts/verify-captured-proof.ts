/** Read-only Test Mode evidence. Never manufactures a captured payment. */
import { readFile, writeFile } from "node:fs/promises";
import { createRazorpayGateway } from "../src/modules/payments/razorpay-gateway.js";
const keyId = process.env.RAZORPAY_KEY_ID ?? "";
const keySecret = process.env.RAZORPAY_KEY_SECRET ?? "";
if (!keyId.startsWith("rzp_test_") || !keySecret) throw new Error("Test Mode credentials are required.");
const proof = JSON.parse(await readFile("../../docs/evidence/razorpay-testmode-proof.json", "utf8"));
const providerOrderId = process.env.PROOF_PROVIDER_ORDER_ID ?? proof.steps[0].evidence.providerOrderId;
const gateway = createRazorpayGateway({ keyId, keySecret, webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET ?? "",
  apiBaseUrl: "https://api.razorpay.com/v1", timeoutMs: 15000 });
const payments = await gateway.listPaymentsForOrder(providerOrderId);
const captured = payments.filter(p => p.providerStatus === "captured");
const evidence = { generatedAt: new Date().toISOString(), mode: "RAZORPAY_TEST_MODE", providerOrderId,
  status: captured.length === 1 ? "CAPTURE_VERIFIED" : "CAPTURE_NOT_PROVEN",
  payments: payments.map(p => ({ providerPaymentId: p.providerPaymentId, amountMinor: p.amountMinor,
    currency: p.currency, status: p.providerStatus })),
  scope: "Provider read-back only. Does not prove application webhook delivery or application ledger reconciliation." };
await writeFile("../../docs/evidence/razorpay-capture-proof.json", JSON.stringify(evidence, null, 2) + "\n");
console.log(JSON.stringify(evidence, null, 2));
if (captured.length !== 1) process.exitCode = 2;
