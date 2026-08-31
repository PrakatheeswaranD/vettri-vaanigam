import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../db/client.js";
import { AppError } from "../../http/errors.js";
import { appendLedgerEvent, withLedgerConcurrencyRetry } from "../audit/ledger.js";
import { randomUUID } from "node:crypto";
import { recalculateReadiness } from "../readiness/service.js";
import { evaluatePaymentRisk } from "@razorgrowth/domain";
import { toPaymentDTO } from "../payments/mapper.js";

export function registerPlatformAdminRoutes(app: FastifyInstance, prefix: string): void {
  app.post(`${prefix}/admin/merchants/:id/readiness`, async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    if (!await prisma.merchant.findUnique({ where: { id } })) throw AppError.notFound("Merchant not found.");
    return recalculateReadiness(prisma, id);
  });
  app.put(`${prefix}/admin/merchants/:id/status`, async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const { status } = z.object({ status: z.enum(["ACTIVE", "SUSPENDED"]) }).parse(request.body);
    return withLedgerConcurrencyRetry(prisma, async (tx) => {
      const merchant = await tx.merchant.findUnique({ where: { id } });
      if (!merchant || merchant.businessCategory === "Identity context") throw AppError.notFound("Commerce merchant not found.");
      await tx.merchant.update({ where: { id }, data: { status } });
      await appendLedgerEvent(tx, { merchantId: id, workflowId: randomUUID(), actorType: "SYSTEM", actionType: "PLATFORM_MERCHANT_STATUS_CHANGED", status: "EXECUTED", conciseReason: `Platform administrator changed merchant status from ${merchant.status} to ${status}.`, relatedEntityType: "Merchant", relatedEntityId: id, metadata: { administratorId: request.merchantUserId } });
      return { id, status };
    });
  });
  app.get(`${prefix}/admin/overview`, async () => {
    const [merchants, payments, exceptions, users] = await Promise.all([
      prisma.merchant.count({ where: { businessCategory: { not: "Identity context" } } }), prisma.payment.count(),
      prisma.payment.count({ where: { OR: [{ state: "UNKNOWN" }, { customerDebitStatus: "DEBITED", merchantCreditStatus: { not: "CREDITED" } }] } }), prisma.merchantUser.count(),
    ]);
    return { merchants, payments, exceptions, users };
  });
  app.get(`${prefix}/admin/merchants`, async () => ({ items: await prisma.merchant.findMany({ where: { businessCategory: { not: "Identity context" } }, orderBy: { name: "asc" }, take: 100, select: { id: true, name: true, slug: true, status: true, businessCategory: true, _count: { select: { products: true } } } }) }));
  app.post(`${prefix}/admin/merchants`, async (request) => {
    const body = z.object({ name: z.string().trim().min(2).max(100), slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).min(2).max(80), businessCategory: z.string().trim().min(2).max(100) }).parse(request.body);
    if (await prisma.merchant.findUnique({ where: { slug: body.slug } })) throw AppError.conflict("Merchant slug already exists.");
    return withLedgerConcurrencyRetry(prisma, async (tx) => {
      const merchant = await tx.merchant.create({ data: { ...body, defaultCurrency: "INR", status: "ACTIVE" } });
      await appendLedgerEvent(tx, { merchantId: merchant.id, workflowId: randomUUID(), actorType: "SYSTEM", actionType: "PLATFORM_MERCHANT_ONBOARDED", status: "EXECUTED", conciseReason: "Platform administrator created a merchant. Catalog and readiness setup are still required.", relatedEntityType: "Merchant", relatedEntityId: merchant.id, metadata: { administratorId: request.merchantUserId } });
      return { id: merchant.id, name: merchant.name, slug: merchant.slug };
    });
  });
  app.get(`${prefix}/admin/payments`, async () => ({ items: await prisma.payment.findMany({ orderBy: { createdAt: "desc" }, take: 100, select: { id: true, merchantId: true, orderId: true, amountMinor: true, currency: true, state: true, customerDebitStatus: true, merchantCreditStatus: true, automaticRetryBlocked: true, provider: true, createdAt: true } }) }));
  app.get(`${prefix}/admin/risk`, async () => ({ items: await prisma.payment.findMany({ where: { OR: [{ state: { in: ["UNKNOWN", "FAILED"] } }, { customerDebitStatus: "DEBITED", merchantCreditStatus: { not: "CREDITED" } }] }, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, merchantId: true, state: true, failureCategory: true, customerDebitStatus: true, merchantCreditStatus: true, automaticRetryBlocked: true } }) }));
  app.post(`${prefix}/admin/risk/failure-first`, async () => {
    const payment = await prisma.payment.findFirst({
      where: { customerDebitStatus: "DEBITED", merchantCreditStatus: "NOT_CREDITED", automaticRetryBlocked: true },
      orderBy: { createdAt: "desc" },
    });
    if (!payment) throw AppError.conflict("The failure-first fixture is not available. Seed a controlled demo merchant before running this scenario.");
    const risk = evaluatePaymentRisk({ amountMinor: payment.amountMinor, highValueThresholdMinor: 500_000, paymentState: payment.state, customerDebitStatus: payment.customerDebitStatus, merchantCreditStatus: payment.merchantCreditStatus, repeatedAttemptCount: payment.attemptNumber - 1, merchantTrusted: true, authorizationValid: true });
    return { classification: "DEBIT_CREDIT_MISMATCH" as const, payment: toPaymentDTO(payment), automaticRetry: "BLOCKED" as const, reason: "The customer may already have been charged while merchant credit is not confirmed. Retrying could create a duplicate charge.", nextAction: "INVESTIGATION_AND_RECONCILIATION_REQUIRED" as const, risk: { ...risk, category: "DEBIT_CREDIT_MISMATCH" as const, level: "CRITICAL" as const, automaticRetryAllowed: false as const } };
  });
  app.get(`${prefix}/admin/audit`, async () => ({ items: await prisma.agentAction.findMany({ orderBy: { createdAt: "desc" }, take: 100, select: { id: true, merchantId: true, workflowId: true, actionType: true, status: true, conciseReason: true, eventHash: true, createdAt: true } }) }));
  app.get(`${prefix}/admin/users`, async () => ({ items: await prisma.merchantUser.findMany({ take: 100, orderBy: { email: "asc" }, select: { id: true, merchantId: true, email: true, role: true } }) }));
  app.get(`${prefix}/admin/readiness`, async () => ({ items: await prisma.merchant.findMany({ where: { businessCategory: { not: "Identity context" } }, take: 100, orderBy: { name: "asc" }, select: { id: true, name: true, status: true, readinessSnapshots: { orderBy: { createdAt: "desc" }, take: 1 } } }) }));
}
