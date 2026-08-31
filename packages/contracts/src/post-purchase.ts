/**
 * Contracts for Post-Purchase Operations:
 * Refunds, Returns, Fulfillment, Disputes, and Taxes.
 */
import type { CurrencyCode } from "@razorgrowth/domain";

export interface RefundItemContract {
  id: string;
  merchantId: string;
  paymentId: string;
  orderId: string;
  amountMinor: number;
  currency: CurrencyCode;
  status: string;
  reason: string | null;
  providerRefundId: string | null;
  restockInventory: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateRefundRequest {
  paymentId: string;
  amountMinor: number;
  reason?: string;
  restockInventory?: boolean;
}

export interface ReturnItemRequest {
  orderItemId: string;
  quantity: number;
  reason?: string;
}

export interface ReturnRequestContract {
  id: string;
  merchantId: string;
  orderId: string;
  status: string;
  reason: string;
  inspectionNotes: string | null;
  restocked: boolean;
  refundAmountMinor: number | null;
  createdAt: string;
  updatedAt: string;
  items: Array<{
    id: string;
    orderItemId: string;
    quantity: number;
    reason: string | null;
  }>;
}

export interface CreateReturnRequestInput {
  orderId: string;
  reason: string;
  items: ReturnItemRequest[];
}

export interface FulfillmentContract {
  id: string;
  merchantId: string;
  orderId: string;
  status: string;
  trackingNumber: string | null;
  carrier: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  estimatedDeliveryAt: string | null;
  createdAt: string;
  updatedAt: string;
  items: Array<{
    id: string;
    orderItemId: string;
    quantity: number;
  }>;
}

export interface CreateFulfillmentInput {
  orderId: string;
  carrier?: string;
  trackingNumber?: string;
  estimatedDeliveryAt?: string;
  items: Array<{
    orderItemId: string;
    quantity: number;
  }>;
}

export interface DisputeContract {
  id: string;
  merchantId: string;
  paymentId: string;
  orderId: string;
  providerDisputeId: string | null;
  amountMinor: number;
  currency: CurrencyCode;
  status: string;
  reason: string;
  evidenceText: string | null;
  evidenceSubmittedAt: string | null;
  feeMinor: number;
  openedAt: string;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SubmitDisputeEvidenceInput {
  evidenceText: string;
}
