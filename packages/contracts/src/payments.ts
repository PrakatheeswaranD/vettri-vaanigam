import { z } from "zod";
import { SUPPORTED_CURRENCIES, PAYMENT_FAILURE_CATEGORIES } from "@razorgrowth/domain";
import { paymentProviderSchema, paymentStateSchema } from "./transactions.js";

/**
 * PART 07 — Razorpay Test Mode payment wire contracts.
 *
 * Every request schema here is deliberately narrow: the client supplies
 * only references (a checkout ID, a payment ID, provider-returned
 * completion identifiers) and NEVER an amount, currency, discount, or
 * captured/success boolean (PART 07 §14, §37, §127-§128). The server
 * derives every financial value from the authoritative `Order`/
 * `CheckoutSession` rows or from verified provider evidence.
 */

export const PAYMENTS_SCHEMA_VERSION = "1.0" as const;

export const paymentFailureCategorySchema = z.enum(PAYMENT_FAILURE_CATEGORIES);
export const customerDebitStatusSchema = z.enum(["UNKNOWN", "NOT_DEBITED", "DEBITED"]);
export const merchantCreditStatusSchema = z.enum(["UNKNOWN", "NOT_CREDITED", "CREDITED"]);

/** PART 07 §63 — the ONLY input the client controls: which checkout to
 * initiate payment for. The server loads amount, currency, and every
 * other financial fact itself. */
export const paymentInitiationRequestSchema = z.object({
  checkoutId: z.string().uuid(),
});
export type PaymentInitiationRequestDTO = z.infer<typeof paymentInitiationRequestSchema>;

/** PART 07 §64-§65 — safe to send to the browser: a public key ID (never
 * the key secret), a provider order reference, and the server-derived
 * amount/currency the client will pass unmodified into Razorpay's own
 * Checkout widget. */
export const paymentInitiationResponseSchema = z.object({
  schemaVersion: z.literal(PAYMENTS_SCHEMA_VERSION),
  paymentId: z.string().uuid(),
  provider: paymentProviderSchema,
  providerOrderId: z.string(),
  keyId: z.string(),
  amountMinor: z.number().int().min(0),
  currency: z.enum(SUPPORTED_CURRENCIES),
  checkoutId: z.string().uuid(),
  orderId: z.string().uuid(),
  testMode: z.boolean(),
});
export type PaymentInitiationResponseDTO = z.infer<typeof paymentInitiationResponseSchema>;

/** PART 07 §37, §127-§128 — exactly the three identifiers Razorpay
 * Checkout returns to the browser on completion, plus which internal
 * payment they claim to complete. No `amount`, no `captured`, no
 * `success` field exists here even to reject. */
export const paymentClientVerificationRequestSchema = z.object({
  paymentId: z.string().uuid(),
  razorpayOrderId: z.string().min(1),
  razorpayPaymentId: z.string().min(1),
  razorpaySignature: z.string().min(1),
});
export type PaymentClientVerificationRequestDTO = z.infer<typeof paymentClientVerificationRequestSchema>;

export const paymentDTOSchema = z.object({
  id: z.string().uuid(),
  merchantId: z.string().uuid(),
  orderId: z.string().uuid(),
  checkoutId: z.string().uuid().nullable(),
  attemptNumber: z.number().int().min(1),
  recoveredFromAttemptId: z.string().uuid().nullable(),
  provider: paymentProviderSchema,
  providerOrderId: z.string().nullable(),
  providerPaymentId: z.string().nullable(),
  amountMinor: z.number().int().min(0),
  currency: z.enum(SUPPORTED_CURRENCIES),
  state: paymentStateSchema,
  customerDebitStatus: customerDebitStatusSchema,
  merchantCreditStatus: merchantCreditStatusSchema,
  automaticRetryBlocked: z.boolean(),
  failureCode: z.string().nullable(),
  failureCategory: paymentFailureCategorySchema.nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  authorizedAt: z.string().datetime().nullable(),
  capturedAt: z.string().datetime().nullable(),
  failedAt: z.string().datetime().nullable(),
});
export type PaymentDTO = z.infer<typeof paymentDTOSchema>;

export const failureFirstDemoSchema = z.object({
  classification: z.literal("DEBIT_CREDIT_MISMATCH"),
  payment: paymentDTOSchema,
  automaticRetry: z.literal("BLOCKED"),
  reason: z.string(),
  nextAction: z.literal("INVESTIGATION_AND_RECONCILIATION_REQUIRED"),
  risk: z.object({
    category: z.literal("DEBIT_CREDIT_MISMATCH"),
    score: z.number().int().min(0).max(100),
    level: z.literal("CRITICAL"),
    reasons: z.array(z.string()),
    automaticRetryAllowed: z.literal(false),
  }),
});
export type FailureFirstDemoDTO = z.infer<typeof failureFirstDemoSchema>;

/** PART 07 §72 — a compact summary embedded in `CheckoutSessionDTO` so the
 * frontend can read current payment state without a second round trip;
 * the payment domain (`GET /payments/:id`) remains the authoritative
 * source for full detail. */
export const paymentSummaryDTOSchema = z.object({
  id: z.string().uuid(),
  provider: paymentProviderSchema,
  state: paymentStateSchema,
  customerDebitStatus: customerDebitStatusSchema,
  merchantCreditStatus: merchantCreditStatusSchema,
  automaticRetryBlocked: z.boolean(),
  failureCategory: paymentFailureCategorySchema.nullable(),
  capturedAt: z.string().datetime().nullable(),
});
export type PaymentSummaryDTO = z.infer<typeof paymentSummaryDTOSchema>;
