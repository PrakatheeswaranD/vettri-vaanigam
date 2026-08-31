import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  paymentClientVerificationRequestSchema,
  paymentInitiationRequestSchema,
  recoveryEvaluationRequestSchema,
  recoveryExecutionRequestSchema,
} from "@razorgrowth/contracts";
import { prisma } from "../../db/client.js";
import { AppError } from "../../http/errors.js";
import { evaluatePaymentRisk } from "@razorgrowth/domain";
import { getAuthenticatedMerchantId } from "../authorization/demo-context.js";
import { evaluateAndProposeRecovery } from "../merchant-agent/recovery-service.js";
import { getPayment, initiatePayment, reconcilePayment, verifyClientCompletion } from "./payment-service.js";
import { executeRecovery } from "./recovery-execution-service.js";
import { toPaymentDTO } from "./mapper.js";

const idParamsSchema = z.object({ id: z.string().uuid() });

/**
 * PART 07 §63-§65, §71, §111 — every request here carries only
 * references (a checkout ID, a payment ID, provider-returned completion
 * identifiers); the server loads every financial fact itself. No route
 * accepts an amount, currency, discount, or captured/success boolean.
 */
export function registerPaymentRoutes(app: FastifyInstance, prefix: string): void {
  app.post(`${prefix}/payments/demo/failure-first`, async (request) => {
    const merchantId = getAuthenticatedMerchantId(request);
    const payment = await prisma.payment.findFirst({
      where: { merchantId, customerDebitStatus: "DEBITED", merchantCreditStatus: "NOT_CREDITED", automaticRetryBlocked: true },
      orderBy: { createdAt: "desc" },
    });
    if (!payment) throw AppError.conflict("The failure-first fixture is not seeded yet. Run the deterministic demo seed.");
    const risk = evaluatePaymentRisk({
      amountMinor: payment.amountMinor,
      highValueThresholdMinor: 500_000,
      paymentState: payment.state,
      customerDebitStatus: payment.customerDebitStatus,
      merchantCreditStatus: payment.merchantCreditStatus,
      repeatedAttemptCount: payment.attemptNumber - 1,
      merchantTrusted: true,
      authorizationValid: true,
    });
    return {
      classification: "DEBIT_CREDIT_MISMATCH" as const,
      payment: toPaymentDTO(payment),
      automaticRetry: "BLOCKED" as const,
      reason: "The customer may already have been charged while merchant credit is not confirmed. Retrying could create a duplicate charge.",
      nextAction: "INVESTIGATION_AND_RECONCILIATION_REQUIRED" as const,
      risk: { ...risk, category: "DEBIT_CREDIT_MISMATCH" as const, level: "CRITICAL" as const, automaticRetryAllowed: false as const },
    };
  });
  app.post(`${prefix}/payments/initiate`, async (request) => {
    const merchantId = getAuthenticatedMerchantId(request);
    const body = paymentInitiationRequestSchema.parse(request.body);
    return initiatePayment(prisma, merchantId, body.checkoutId);
  });

  app.post(`${prefix}/payments/razorpay/verify`, async (request) => {
    const merchantId = getAuthenticatedMerchantId(request);
    const body = paymentClientVerificationRequestSchema.parse(request.body);
    return verifyClientCompletion(prisma, merchantId, body);
  });

  app.get(`${prefix}/payments/:id`, async (request) => {
    const merchantId = getAuthenticatedMerchantId(request);
    const params = idParamsSchema.parse(request.params);
    return getPayment(prisma, merchantId, params.id);
  });

  app.post(`${prefix}/payments/:id/reconcile`, async (request) => {
    const merchantId = getAuthenticatedMerchantId(request);
    const params = idParamsSchema.parse(request.params);
    return reconcilePayment(prisma, merchantId, params.id);
  });

  // PART 08 §112, §118-§119 — failure-first recovery. `evaluate` takes
  // only a failed payment's ID and returns the resulting recovery
  // proposal (whether eligible-and-proposed, or blocked); `execute`
  // takes only a recovery authorization ID plus an idempotency key —
  // never an amount, currency, or desired outcome.
  app.post(`${prefix}/payments/recovery/evaluate`, async (request) => {
    const merchantId = getAuthenticatedMerchantId(request);
    const body = recoveryEvaluationRequestSchema.parse(request.body);
    return evaluateAndProposeRecovery(prisma, merchantId, body.paymentId);
  });

  app.post(`${prefix}/payments/recovery/:id/execute`, async (request) => {
    const merchantId = getAuthenticatedMerchantId(request);
    const params = idParamsSchema.parse(request.params);
    const body = recoveryExecutionRequestSchema.parse(request.body);
    return executeRecovery(prisma, merchantId, params.id, body.idempotencyKey);
  });
}
