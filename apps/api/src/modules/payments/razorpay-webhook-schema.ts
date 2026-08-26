/**
 * Runtime shape of a Razorpay webhook delivery (PART 07 §30). A valid
 * signature does NOT eliminate schema validation — the body still has to
 * actually look like a Razorpay event before any field of it is used.
 * This is a Razorpay-specific wire shape, not one of this app's own
 * contracts, so it lives here rather than in `@razorgrowth/contracts`.
 */
import { z } from "zod";

export const razorpayWebhookPaymentEntitySchema = z.object({
  id: z.string().min(1),
  order_id: z.string().nullable().optional(),
  amount: z.number().int(),
  currency: z.string().min(1),
  status: z.string().min(1),
  method: z.string().nullable().optional(),
  error_code: z.string().nullable().optional(),
  error_description: z.string().nullable().optional(),
});

export const razorpayWebhookEventSchema = z.object({
  event: z.string().min(1),
  payload: z
    .object({
      payment: z.object({ entity: razorpayWebhookPaymentEntitySchema }).optional(),
    })
    .default({}),
});

export type RazorpayWebhookEvent = z.infer<typeof razorpayWebhookEventSchema>;
