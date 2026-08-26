import type { Payment } from "@prisma/client";
import type { PaymentDTO } from "@razorgrowth/contracts";
import type { PaymentFailureCategory } from "@razorgrowth/domain";

export function toPaymentDTO(payment: Payment): PaymentDTO {
  return {
    id: payment.id,
    merchantId: payment.merchantId,
    orderId: payment.orderId,
    checkoutId: payment.checkoutId,
    attemptNumber: payment.attemptNumber,
    recoveredFromAttemptId: payment.recoveredFromAttemptId,
    provider: payment.provider,
    providerOrderId: payment.providerOrderId,
    providerPaymentId: payment.providerPaymentId,
    amountMinor: payment.amountMinor,
    currency: payment.currency,
    state: payment.state,
    failureCode: payment.failureCode,
    failureCategory: payment.failureCategory as PaymentFailureCategory | null,
    createdAt: payment.createdAt.toISOString(),
    updatedAt: payment.updatedAt.toISOString(),
    authorizedAt: payment.authorizedAt?.toISOString() ?? null,
    capturedAt: payment.capturedAt?.toISOString() ?? null,
    failedAt: payment.failedAt?.toISOString() ?? null,
  };
}
