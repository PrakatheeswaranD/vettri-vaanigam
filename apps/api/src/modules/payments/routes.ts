import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  paymentClientVerificationRequestSchema,
  paymentInitiationRequestSchema,
  recoveryEvaluationRequestSchema,
  recoveryExecutionRequestSchema,
} from "@razorgrowth/contracts";
import { prisma } from "../../db/client.js";
import { getDemoMerchantId } from "../authorization/demo-context.js";
import { evaluateAndProposeRecovery } from "../merchant-agent/recovery-service.js";
import { getPayment, initiatePayment, reconcilePayment, verifyClientCompletion } from "./payment-service.js";
import { executeRecovery } from "./recovery-execution-service.js";

const idParamsSchema = z.object({ id: z.string().uuid() });

/**
 * PART 07 §63-§65, §71, §111 — every request here carries only
 * references (a checkout ID, a payment ID, provider-returned completion
 * identifiers); the server loads every financial fact itself. No route
 * accepts an amount, currency, discount, or captured/success boolean.
 */
export function registerPaymentRoutes(app: FastifyInstance, prefix: string): void {
  app.post(`${prefix}/payments/initiate`, async (request) => {
    const merchantId = await getDemoMerchantId(prisma);
    const body = paymentInitiationRequestSchema.parse(request.body);
    return initiatePayment(prisma, merchantId, body.checkoutId);
  });

  app.post(`${prefix}/payments/razorpay/verify`, async (request) => {
    const merchantId = await getDemoMerchantId(prisma);
    const body = paymentClientVerificationRequestSchema.parse(request.body);
    return verifyClientCompletion(prisma, merchantId, body);
  });

  app.get(`${prefix}/payments/:id`, async (request) => {
    const merchantId = await getDemoMerchantId(prisma);
    const params = idParamsSchema.parse(request.params);
    return getPayment(prisma, merchantId, params.id);
  });

  app.post(`${prefix}/payments/:id/reconcile`, async (request) => {
    const merchantId = await getDemoMerchantId(prisma);
    const params = idParamsSchema.parse(request.params);
    return reconcilePayment(prisma, merchantId, params.id);
  });

  // PART 08 §112, §118-§119 — failure-first recovery. `evaluate` takes
  // only a failed payment's ID and returns the resulting recovery
  // proposal (whether eligible-and-proposed, or blocked); `execute`
  // takes only a recovery authorization ID plus an idempotency key —
  // never an amount, currency, or desired outcome.
  app.post(`${prefix}/payments/recovery/evaluate`, async (request) => {
    const merchantId = await getDemoMerchantId(prisma);
    const body = recoveryEvaluationRequestSchema.parse(request.body);
    return evaluateAndProposeRecovery(prisma, merchantId, body.paymentId);
  });

  app.post(`${prefix}/payments/recovery/:id/execute`, async (request) => {
    const merchantId = await getDemoMerchantId(prisma);
    const params = idParamsSchema.parse(request.params);
    const body = recoveryExecutionRequestSchema.parse(request.body);
    return executeRecovery(prisma, merchantId, params.id, body.idempotencyKey);
  });
}
