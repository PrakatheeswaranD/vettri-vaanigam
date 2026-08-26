import type { CheckoutSession, Customer, Order, OrderItem, Payment } from "@prisma/client";
import type { CheckoutSessionDTO, OrderDTO, PaymentSummaryDTO, TransactionDTO } from "@razorgrowth/contracts";
import type { PaymentFailureCategory } from "@razorgrowth/domain";

type OrderWithLatestPayment = Order & { customer: Customer | null; payments: Payment[] };
type OrderWithItems = Order & { items: OrderItem[] };

export function toTransactionDTO(order: OrderWithLatestPayment): TransactionDTO {
  const latestPayment = order.payments[0] ?? null;
  return {
    orderId: order.id,
    paymentId: latestPayment?.id ?? null,
    customerName: order.customer?.displayName ?? "Guest",
    amount: { amountMinor: order.totalAmountMinor, currency: order.currency },
    state: latestPayment?.state ?? "UNKNOWN",
    provider: latestPayment?.provider ?? "DEMO",
    providerOrderId: latestPayment?.providerOrderId ?? null,
    providerPaymentId: latestPayment?.providerPaymentId ?? null,
    failureCategory: latestPayment?.failureCategory ?? null,
    source: order.source,
    createdAt: order.createdAt.toISOString(),
    capturedAt: latestPayment?.capturedAt?.toISOString() ?? null,
  };
}

export function toOrderDTO(order: OrderWithItems): OrderDTO {
  return {
    id: order.id,
    merchantId: order.merchantId,
    status: order.status,
    totalAmountMinor: order.totalAmountMinor,
    currency: order.currency,
    source: order.source as OrderDTO["source"],
    growthProposalId: order.growthProposalId,
    authorizationId: order.authorizationId,
    orderFingerprint: order.orderFingerprint,
    items: order.items.map((item) => ({
      id: item.id,
      productNameSnapshot: item.productNameSnapshot,
      variantTitleSnapshot: item.variantTitleSnapshot,
      unitPriceMinor: item.unitPriceMinor,
      quantity: item.quantity,
      lineDiscountMinor: item.lineDiscountMinor,
      lineTotalMinor: item.lineTotalMinor,
      currency: item.currency,
    })),
    createdAt: order.createdAt.toISOString(),
  };
}

function toPaymentSummaryDTO(payment: Payment): PaymentSummaryDTO {
  return {
    id: payment.id,
    provider: payment.provider,
    state: payment.state,
    failureCategory: payment.failureCategory as PaymentFailureCategory | null,
    capturedAt: payment.capturedAt?.toISOString() ?? null,
  };
}

export function toCheckoutSessionDTO(checkout: CheckoutSession & { payments?: Payment[] }): CheckoutSessionDTO {
  const payment = checkout.payments?.[0] ?? null;
  return {
    id: checkout.id,
    merchantId: checkout.merchantId,
    cartId: checkout.cartId,
    orderId: checkout.orderId,
    authorizationId: checkout.authorizationId,
    status: checkout.status,
    amountMinor: checkout.amountMinor,
    currency: checkout.currency,
    orderFingerprint: checkout.orderFingerprint,
    createdAt: checkout.createdAt.toISOString(),
    expiresAt: checkout.expiresAt.toISOString(),
    payment: payment ? toPaymentSummaryDTO(payment) : null,
  };
}
