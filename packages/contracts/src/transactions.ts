import { z } from "zod";
import { moneySchema } from "./common.js";

export const paymentStateSchema = z.enum([
  "CREATED",
  "AUTHORIZED",
  "CAPTURED",
  "FAILED",
  "CANCELLED",
  "UNKNOWN",
  "REFUNDED",
  "PARTIALLY_REFUNDED",
]);

/** Financial evidence source. `X402` is facilitator-settled and never
 * relabelled as Razorpay or as a test double. */
export const paymentProviderSchema = z.enum(["DEMO", "RAZORPAY", "MOCK", "X402"]);

/**
 * A payment/order row for the Transactions page. `provider` is always
 * `"DEMO"` for seeded data (PART 01 §77) — a real integration uses
 * `"RAZORPAY"` for Test Mode or `"X402"` for facilitator settlement.
 */
export const transactionSchema = z.object({
  orderId: z.string().uuid(),
  paymentId: z.string().uuid().nullable(),
  customerName: z.string(),
  amount: moneySchema,
  state: paymentStateSchema,
  customerDebitStatus: z.enum(["UNKNOWN", "NOT_DEBITED", "DEBITED"]),
  merchantCreditStatus: z.enum(["UNKNOWN", "NOT_CREDITED", "CREDITED"]),
  automaticRetryBlocked: z.boolean(),
  provider: paymentProviderSchema,
  /** Safe, truncatable references only (PART 07 §82, §104) — never a full
   * provider payload. */
  providerOrderId: z.string().nullable(),
  providerPaymentId: z.string().nullable(),
  failureCategory: z.string().nullable(),
  source: z.string().nullable(),
  createdAt: z.string().datetime(),
  capturedAt: z.string().datetime().nullable(),
});
export type TransactionDTO = z.infer<typeof transactionSchema>;
