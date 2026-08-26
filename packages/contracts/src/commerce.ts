import { z } from "zod";
import { SUPPORTED_CURRENCIES } from "@razorgrowth/domain";
import { paymentSummaryDTOSchema } from "./payments.js";

/**
 * PART 06 — Deterministic Commerce Execution wire contracts.
 *
 * `CommerceExecutionRequestDTO` is deliberately narrow (PART 06 §9): it
 * carries only references — an authorization ID and the buyer's own
 * non-financial selection — never a price, discount, or total. Every
 * financial value in `CheckoutResponseDTO` is server-computed.
 */

export const COMMERCE_SCHEMA_VERSION = "1.0" as const;

export const cartStatusSchema = z.enum(["ACTIVE", "CHECKOUT_PENDING", "CONVERTED", "EXPIRED", "ABANDONED"]);
export const orderStatusSchema = z.enum(["PENDING", "PAYMENT_PENDING", "PAID", "FAILED", "CANCELLED"]);
export const orderSourceSchema = z.enum(["DIRECT_BUYER", "AI_CROSS_SELL", "AI_UPSELL", "AI_BUNDLE", "AI_BOUNDED_OFFER", "AI_RECOVERY"]);
export const checkoutSessionStatusSchema = z.enum([
  "CREATED",
  "READY_FOR_PAYMENT",
  "PAYMENT_IN_PROGRESS",
  "COMPLETED",
  "FAILED",
  "EXPIRED",
  "CANCELLED",
]);

/** PART 06 §9 — the ONLY input the client controls: which authorization
 * to execute, the buyer's own product/variant/quantity choice, and an
 * idempotency key. No price, discount, or total field exists here even
 * to reject — it is simply not part of the schema. */
export const commerceExecutionRequestSchema = z.object({
  authorizationId: z.string().uuid(),
  selection: z.object({
    productId: z.string().uuid(),
    variantId: z.string().uuid(),
    quantity: z.number().int().min(1).max(10),
  }),
  idempotencyKey: z.string().min(1).max(200),
});
export type CommerceExecutionRequestDTO = z.infer<typeof commerceExecutionRequestSchema>;

export const commerceLineItemSchema = z.object({
  productId: z.string().uuid(),
  variantId: z.string().uuid(),
  productName: z.string(),
  variantTitle: z.string(),
  quantity: z.number().int().min(1),
  unitPriceMinor: z.number().int().min(0),
  lineSubtotalMinor: z.number().int().min(0),
  lineDiscountMinor: z.number().int().min(0),
  lineTotalMinor: z.number().int().min(0),
  currency: z.enum(SUPPORTED_CURRENCIES),
  source: orderSourceSchema,
});
export type CommerceLineItemDTO = z.infer<typeof commerceLineItemSchema>;

export const cartTotalsSchema = z.object({
  currency: z.enum(SUPPORTED_CURRENCIES),
  subtotalMinor: z.number().int().min(0),
  discountMinor: z.number().int().min(0),
  totalMinor: z.number().int().min(0),
  calculationVersion: z.string(),
  calculatedAt: z.string().datetime(),
});
export type CartTotalsDTO = z.infer<typeof cartTotalsSchema>;

export const checkoutResponseSchema = z.object({
  schemaVersion: z.literal(COMMERCE_SCHEMA_VERSION),
  checkoutId: z.string().uuid(),
  orderId: z.string().uuid(),
  cartId: z.string().uuid(),
  status: checkoutSessionStatusSchema,
  totals: cartTotalsSchema,
  items: z.array(commerceLineItemSchema),
  appliedOffer: z
    .object({
      actionType: z.string(),
      kind: z.enum(["PERCENTAGE", "FIXED_AMOUNT"]),
      percentageBps: z.number().int().nullable(),
      amountMinor: z.number().int().nullable(),
      discountMinor: z.number().int().min(0),
      growthProposalId: z.string().uuid(),
    })
    .nullable(),
  authorization: z.object({
    authorizationId: z.string().uuid(),
    consumed: z.boolean(),
  }),
  payment: z.object({
    status: z.literal("NOT_STARTED"),
  }),
  orderFingerprint: z.string(),
  fingerprintVersion: z.string(),
  expiresAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  traceId: z.string().uuid(),
});
export type CheckoutResponseDTO = z.infer<typeof checkoutResponseSchema>;

export const orderItemDTOSchema = z.object({
  id: z.string().uuid(),
  productNameSnapshot: z.string(),
  variantTitleSnapshot: z.string(),
  unitPriceMinor: z.number().int().min(0),
  quantity: z.number().int().min(1),
  lineDiscountMinor: z.number().int().min(0),
  lineTotalMinor: z.number().int().min(0),
  currency: z.enum(SUPPORTED_CURRENCIES),
});
export type OrderItemDTO = z.infer<typeof orderItemDTOSchema>;

export const orderDTOSchema = z.object({
  id: z.string().uuid(),
  merchantId: z.string().uuid(),
  status: orderStatusSchema,
  totalAmountMinor: z.number().int().min(0),
  currency: z.enum(SUPPORTED_CURRENCIES),
  source: orderSourceSchema.nullable(),
  growthProposalId: z.string().uuid().nullable(),
  authorizationId: z.string().uuid().nullable(),
  orderFingerprint: z.string().nullable(),
  items: z.array(orderItemDTOSchema),
  createdAt: z.string().datetime(),
});
export type OrderDTO = z.infer<typeof orderDTOSchema>;

export const checkoutSessionDTOSchema = z.object({
  id: z.string().uuid(),
  merchantId: z.string().uuid(),
  cartId: z.string().uuid(),
  orderId: z.string().uuid(),
  authorizationId: z.string().uuid(),
  status: checkoutSessionStatusSchema,
  amountMinor: z.number().int().min(0),
  currency: z.enum(SUPPORTED_CURRENCIES),
  orderFingerprint: z.string(),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  /** PART 07 §72 — null until a payment has been initiated for this
   * checkout; the payment domain (`GET /payments/:id`) is still the
   * authoritative source, this is a convenience summary only. */
  payment: paymentSummaryDTOSchema.nullable(),
});
export type CheckoutSessionDTO = z.infer<typeof checkoutSessionDTOSchema>;
