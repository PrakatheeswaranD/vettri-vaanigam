/**
 * Post-purchase lifecycle state machines and validation:
 * Refunds, Returns, Fulfillment, Disputes.
 */

export const REFUND_STATUSES = ["PENDING", "PROCESSED", "FAILED"] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

export const RETURN_STATUSES = ["REQUESTED", "APPROVED", "REJECTED", "ITEM_RECEIVED", "COMPLETED", "CANCELLED"] as const;
export type ReturnStatus = (typeof RETURN_STATUSES)[number];

export const FULFILLMENT_STATUSES = ["PENDING", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED"] as const;
export type FulfillmentStatus = (typeof FULFILLMENT_STATUSES)[number];

export const DISPUTE_STATUSES = ["OPEN", "UNDER_REVIEW", "WON", "LOST", "CLOSED"] as const;
export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];

const REFUND_TRANSITIONS: Record<RefundStatus, readonly RefundStatus[]> = {
  PENDING: ["PROCESSED", "FAILED"],
  PROCESSED: [],
  FAILED: [],
};

const RETURN_TRANSITIONS: Record<ReturnStatus, readonly ReturnStatus[]> = {
  REQUESTED: ["APPROVED", "REJECTED", "CANCELLED"],
  APPROVED: ["ITEM_RECEIVED", "CANCELLED"],
  REJECTED: [],
  ITEM_RECEIVED: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

const FULFILLMENT_TRANSITIONS: Record<FulfillmentStatus, readonly FulfillmentStatus[]> = {
  PENDING: ["PROCESSING", "SHIPPED", "CANCELLED"],
  PROCESSING: ["SHIPPED", "CANCELLED"],
  SHIPPED: ["DELIVERED", "CANCELLED"],
  DELIVERED: [],
  CANCELLED: [],
};

const DISPUTE_TRANSITIONS: Record<DisputeStatus, readonly DisputeStatus[]> = {
  OPEN: ["UNDER_REVIEW", "WON", "LOST", "CLOSED"],
  UNDER_REVIEW: ["WON", "LOST", "CLOSED"],
  WON: ["CLOSED"],
  LOST: ["CLOSED"],
  CLOSED: [],
};

export function canTransitionRefund(from: RefundStatus, to: RefundStatus): boolean {
  if (from === to) return true;
  return REFUND_TRANSITIONS[from]?.includes(to) ?? false;
}

export function canTransitionReturn(from: ReturnStatus, to: ReturnStatus): boolean {
  if (from === to) return true;
  return RETURN_TRANSITIONS[from]?.includes(to) ?? false;
}

export function canTransitionFulfillment(from: FulfillmentStatus, to: FulfillmentStatus): boolean {
  if (from === to) return true;
  return FULFILLMENT_TRANSITIONS[from]?.includes(to) ?? false;
}

export function canTransitionDispute(from: DisputeStatus, to: DisputeStatus): boolean {
  if (from === to) return true;
  return DISPUTE_TRANSITIONS[from]?.includes(to) ?? false;
}

export function validateRefundAmount(orderTotalMinor: number, previousRefundsMinor: number, requestedRefundMinor: number): { valid: boolean; maxAvailableMinor: number; error?: string } {
  if (requestedRefundMinor <= 0) {
    return { valid: false, maxAvailableMinor: 0, error: "Refund amount must be positive." };
  }
  const maxAvailableMinor = Math.max(0, orderTotalMinor - previousRefundsMinor);
  if (requestedRefundMinor > maxAvailableMinor) {
    return {
      valid: false,
      maxAvailableMinor,
      error: `Requested refund of ${requestedRefundMinor} exceeds maximum refundable balance of ${maxAvailableMinor}.`,
    };
  }
  return { valid: true, maxAvailableMinor };
}
