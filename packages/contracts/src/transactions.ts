import { z } from "zod";
import { moneySchema } from "./common.js";

export const paymentStateSchema = z.enum(["CREATED", "AUTHORIZED", "CAPTURED", "FAILED", "CANCELLED", "UNKNOWN"]);

/** PART 07 §18 — `DEMO` marks seeded/synthetic history, `MOCK` the
 * deterministic test-double provider, `RAZORPAY` a real Test Mode
 * transaction. The three can never be confused with one another. */
export const paymentProviderSchema = z.enum(["DEMO", "RAZORPAY", "MOCK"]);

/**
 * A payment/order row for the Transactions page. `provider` is always
 * `"DEMO"` for seeded data (PART 01 §77) — a real integration uses
 * `"RAZORPAY"` and only once genuine Test Mode calls back it.
 */
export const transactionSchema = z.object({
  orderId: z.string().uuid(),
  paymentId: z.string().uuid().nullable(),
  customerName: z.string(),
  amount: moneySchema,
  state: paymentStateSchema,
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
