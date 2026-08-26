/**
 * Branded identifier types (PART 00 §7 / PART 01 §7).
 *
 * Plain `string` IDs can flow through domain logic without context —
 * nothing stops a CustomerId from being passed where a MerchantId is
 * expected. Branding costs nothing at runtime and catches that class of
 * bug at compile time. Values are still ordinary UUID strings; branding is
 * a lightweight nominal-typing convention, not a runtime wrapper.
 */

declare const brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [brand]: B };

export type MerchantId = Brand<string, "MerchantId">;
export type CustomerId = Brand<string, "CustomerId">;
export type ProductId = Brand<string, "ProductId">;
export type VariantId = Brand<string, "VariantId">;
export type CartId = Brand<string, "CartId">;
export type CartItemId = Brand<string, "CartItemId">;
export type OrderId = Brand<string, "OrderId">;
export type OrderItemId = Brand<string, "OrderItemId">;
export type PaymentId = Brand<string, "PaymentId">;
export type ActionId = Brand<string, "ActionId">;
export type AgentRunId = Brand<string, "AgentRunId">;
export type WorkflowId = Brand<string, "WorkflowId">;
export type RecommendationId = Brand<string, "RecommendationId">;
export type OfferId = Brand<string, "OfferId">;
export type ReadinessSnapshotId = Brand<string, "ReadinessSnapshotId">;
export type RequestId = Brand<string, "RequestId">;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** Cast a raw string into a branded ID after validating UUID shape. */
export function asId<T extends string>(value: string): Brand<string, T> {
  if (!isUuid(value)) {
    throw new Error(`Expected a UUID identifier, got: ${value}`);
  }
  return value as Brand<string, T>;
}
