/**
 * The agent-facing door, plus the merchant-facing views of what came
 * through it.
 *
 * ONE ENDPOINT, NOT THREE
 *
 * `POST /agent-gateway/:merchantSlug/intents` accepts ACP, AP2 and x402 on
 * the same URL. A merchant publishes one address; the mesh works out the
 * dialect. Three endpoints would push protocol awareness onto the merchant,
 * which is the problem this exists to remove.
 *
 * WHY THIS ONE ROUTE IS UNAUTHENTICATED
 *
 * A buyer agent that has never met this merchant cannot hold a merchant
 * session — requiring one would defeat the entire premise. The gate is the
 * signed spend mandate plus merchant policy, not a session cookie.
 *
 * That exposure is real and worth naming: an unauthenticated caller can
 * cause `AgentIdentity` and `DecisionRecord` rows to be written. The
 * velocity limit bounds how fast one agent can do that, and every write is
 * an auditable record rather than a state change to anything financial —
 * nothing here can move money on its own. A production deployment would
 * put a rate limiter in front of this route as well; that is deliberately
 * not faked here.
 */
import type { FastifyInstance } from "fastify";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { prisma } from "../../db/client.js";
import { AppError } from "../../http/errors.js";
import { getAuthenticatedMerchantId } from "../authorization/demo-context.js";
import { requireOwnerRole, requireApprovalRole } from "../auth/middleware.js";
import { getPaymentGateway } from "../payments/gateway-factory.js";
import { handleAgentPurchaseIntent } from "./service.js";
import { buildDecisionMetrics, listDecisionRecords } from "./decision-query.js";
import { registerAgentKey, revokeAgent } from "./agent-registry.js";
import { executeExternalAgentPurchase, ExternalPurchaseExecutionError } from "./execution-service.js";
import { appendLedgerEvent } from "../audit/ledger.js";
import { verifyGatewayStatusToken } from "./status-token.js";

/**
 * The policy editor's payload.
 *
 * Ceilings are bounded above as well as below: an "unlimited" ceiling
 * would quietly turn the step-up gate off, which is the one control this
 * whole system exists to provide. A merchant who genuinely wants no
 * ceiling can set a very large number and see it, rather than having the
 * gate silently disappear behind a blank field.
 */
const policyBodySchema = z.object({
  unknownAgentCeilingMinor: z.number().int().min(0).max(1_000_000_000),
  knownAgentCeilingMinor: z.number().int().min(0).max(1_000_000_000),
  blockedCategories: z.array(z.string().min(1).max(80)).max(50),
  maxNegotiationDiscountBps: z.number().int().min(0).max(5000),
  negotiatorMinBundleItems: z.number().int().min(1).max(50),
  // Bounded below 10000bps: a "floor" of 100% margin would mean no
  // discount is ever permissible, which is what a zero ceiling already
  // expresses more honestly.
  negotiatorFloorMarginBps: z.number().int().min(0).max(9_000),
  velocityMaxIntentsPerHour: z.number().int().min(1).max(10_000),
  allowFirstUseKeyPinning: z.boolean().optional(),
});

const merchantParamsSchema = z.object({ merchantSlug: z.string().min(1).max(120) });
const decisionQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  outcome: z.enum(["AUTO_APPROVE", "STEP_UP", "DECLINE"]).optional(),
});

export function registerAgentGatewayRoutes(app: FastifyInstance, prefix: string): void {
  app.post(`${prefix}/agent-gateway/:merchantSlug/intents`, async (request, reply) => {
    const params = merchantParamsSchema.safeParse(request.params);
    if (!params.success) throw AppError.validation("A merchant must be named in the gateway URL.");

    const merchant = await prisma.merchant.findUnique({
      where: { slug: params.data.merchantSlug },
      select: { id: true, status: true },
    });
    if (!merchant || merchant.status !== "ACTIVE") {
      throw AppError.notFound(`No active merchant is published at "${params.data.merchantSlug}".`);
    }

    const paymentGateway = getPaymentGateway();
    const result = await handleAgentPurchaseIntent(
      prisma,
      { merchantId: merchant.id, headers: request.headers, body: request.body },
      undefined,
      paymentGateway
        ? async ({ decisionId, workflowId, amountMinor, currency, lines }) =>
            executeExternalAgentPurchase(prisma, {
              merchantId: merchant.id,
              decisionId,
              workflowId,
              amountMinor,
              currency,
              lines,
            })
        : undefined,
    );

    // The HTTP status carries the same meaning as the decision, so an agent
    // that reads only the status code still behaves correctly: 200 it may
    // proceed, 202 a human is deciding, 403 refused.
    const status = result.outcome === "AUTO_APPROVE" ? 200 : result.outcome === "STEP_UP" ? 202 : 403;
    return reply.status(status).send(result);
  });

  /** Opaque bearer continuation for the buyer agent. It exposes only the
   * decision/payment state tied to this capability, never merchant-wide data. */
  app.get(`${prefix}/agent-gateway/decisions/:decisionId/status`, async (request) => {
    const { decisionId } = request.params as { decisionId: string };
    const header = request.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
    if (!token || !verifyGatewayStatusToken(token, decisionId)) {
      throw AppError.unauthorized("A valid decision status token is required.");
    }
    const decision = await prisma.decisionRecord.findUnique({
      where: { id: decisionId },
      select: {
        id: true,
        outcome: true,
        reasonCode: true,
        explanation: true,
        stepUpStatus: true,
        settlementStatus: true,
        providerOrderId: true,
        internalOrderId: true,
        internalPaymentId: true,
        settledAt: true,
      },
    });
    if (!decision) throw AppError.notFound(`No decision ${decisionId}.`);
    return decision;
  });

  // ── Merchant-facing (authenticated) ──────────────────────────────────
  app.get(`${prefix}/agent-gateway/decisions`, async (request) => {
    const merchantId = getAuthenticatedMerchantId(request);
    const query = decisionQuerySchema.parse(request.query);
    return listDecisionRecords(prisma, merchantId, query);
  });

  app.get(`${prefix}/agent-gateway/policy`, async (request) => {
    const merchantId = getAuthenticatedMerchantId(request);
    const existing = await prisma.agentGatewayPolicy.findUnique({ where: { merchantId } });
    if (existing) return existing;
    // Never invent a saved policy: report that none is configured, so the
    // console can say "defaults in force" instead of implying the merchant
    // chose these numbers.
    return {
      merchantId,
      policyVersion: 0,
      configured: false,
      currency: "INR",
      unknownAgentCeilingMinor: 1_000_000,
      knownAgentCeilingMinor: 5_000_000,
      blockedCategories: [],
      maxNegotiationDiscountBps: 1000,
      negotiatorMinBundleItems: 2,
      negotiatorFloorMarginBps: 2000,
      velocityMaxIntentsPerHour: 20,
      allowFirstUseKeyPinning: false,
    };
  });

  app.put(`${prefix}/agent-gateway/policy`, async (request) => {
    const merchantId = getAuthenticatedMerchantId(request);
    requireOwnerRole(request);
    const body = policyBodySchema.parse(request.body);
    const existing = await prisma.agentGatewayPolicy.findUnique({ where: { merchantId } });

    // Every save bumps the version. A decision records the version that
    // produced it, so a merchant can tell which rules a past decision ran
    // under rather than assuming today's.
    return prisma.agentGatewayPolicy.upsert({
      where: { merchantId },
      create: { merchantId, policyVersion: 1, ...body },
      update: { policyVersion: (existing?.policyVersion ?? 0) + 1, ...body },
    });
  });

  /**
   * Agent enrolment — how a key becomes trusted.
   *
   * Mandate signatures are verified against the key registered HERE, by an
   * authenticated merchant user. Without this the gateway was verifying
   * signatures against a key supplied in the same request, which any
   * attacker can generate.
   *
   * The API key is returned ONCE and only its hash is stored, the same
   * treatment a user session token gets.
   */
  app.post(`${prefix}/agent-gateway/agents`, async (request) => {
    const merchantId = getAuthenticatedMerchantId(request);
    requireOwnerRole(request);
    const body = z
      .object({
        externalAgentId: z.string().min(1).max(120),
        publicKey: z.string().min(40).max(64),
        displayName: z.string().max(120).optional(),
      })
      .parse(request.body);

    const agent = await registerAgentKey(prisma, merchantId, body);
    return {
      ...agent,
      note: "Store this key now — it is not retrievable again. The agent sends it as `Authorization: Bearer <key>` on ACP routes.",
    };
  });

  app.get(`${prefix}/agent-gateway/agents`, async (request) => {
    const merchantId = getAuthenticatedMerchantId(request);
    const rows = await prisma.agentIdentity.findMany({
      where: { merchantId },
      orderBy: { lastSeenAt: "desc" },
      take: 100,
    });
    return {
      items: rows.map((a) => ({
        id: a.id,
        externalAgentId: a.externalAgentId,
        displayName: a.displayName,
        // The key itself is never echoed; whether one is trusted, and how,
        // is the part a merchant needs to see.
        hasRegisteredKey: Boolean(a.registeredPublicKey),
        keyTrustSource: a.keyTrustSource,
        hasActiveCredential: Boolean(a.apiKeyHash) && !a.apiKeyRevokedAt,
        settledOrderCount: a.settledOrderCount,
        lastSeenAt: a.lastSeenAt.toISOString(),
      })),
    };
  });

  app.post(`${prefix}/agent-gateway/agents/:externalAgentId/revoke`, async (request) => {
    const merchantId = getAuthenticatedMerchantId(request);
    requireOwnerRole(request);
    const { externalAgentId } = request.params as { externalAgentId: string };
    await revokeAgent(prisma, merchantId, externalAgentId);
    return { externalAgentId, revoked: true };
  });

  /**
   * The step-up decision — the thing that was actually missing.
   *
   * A payment link handed back to the buyer agent is not merchant
   * approval: the buyer choosing to pay proves nothing about whether the
   * merchant wanted the sale. This is an authenticated OWNER/APPROVER
   * decision, recorded against the Decision Record with who decided and
   * when, and it reuses the same RBAC as every other approval in the
   * product.
   */
  app.post(`${prefix}/agent-gateway/decisions/:decisionId/decide`, async (request) => {
    const merchantId = getAuthenticatedMerchantId(request);
    requireApprovalRole(request);

    const { decisionId } = request.params as { decisionId: string };
    const body = z
      .object({ decision: z.enum(["APPROVED", "REJECTED"]), note: z.string().max(500).optional() })
      .parse(request.body);

    const record = await prisma.decisionRecord.findUnique({ where: { id: decisionId } });
    if (!record || record.merchantId !== merchantId) throw AppError.notFound(`No decision ${decisionId}.`);
    if (record.outcome !== "STEP_UP") {
      throw new AppError("CONFLICT", "Only an intent that stepped up to a human needs a decision.");
    }
    const STALE_LOCK_TIMEOUT_MS = 60_000;
    const isStaleProcessing =
      record.stepUpStatus === "PROCESSING" &&
      record.stepUpDecidedAt &&
      Date.now() - record.stepUpDecidedAt.getTime() > STALE_LOCK_TIMEOUT_MS;

    if (record.stepUpStatus !== "PENDING" && !isStaleProcessing) {
      throw new AppError("CONFLICT", `This step-up is already ${record.stepUpStatus?.toLowerCase() ?? "being decided"}.`);
    }
    const now = new Date();
    if (body.decision === "APPROVED" && record.protocol !== "X402") {
      const consentInvalid =
        !record.authorizationExpiresAt ||
        record.authorizationExpiresAt.getTime() <= now.getTime() ||
        record.authorizationMerchantScope !== merchantId ||
        record.authorizationCurrency !== record.currency ||
        record.authorizationMaxAmountMinor === null ||
        record.computedTotalMinor === null ||
        record.authorizationMaxAmountMinor < record.computedTotalMinor;
      if (consentInvalid) {
        await prisma.$transaction(async (tx) => {
          const rejected = await tx.decisionRecord.updateMany({
            where: {
              id: decisionId,
              merchantId,
              outcome: "STEP_UP",
              OR: [
                { stepUpStatus: "PENDING" },
                { stepUpStatus: "PROCESSING", stepUpDecidedAt: { lt: new Date(now.getTime() - STALE_LOCK_TIMEOUT_MS) } },
              ],
            },
            data: { stepUpStatus: "REJECTED", stepUpDecidedAt: now, stepUpDecidedById: request.merchantUserId, settlementStatus: "AUTHORIZATION_EXPIRED" },
          });
          if (rejected.count !== 1) throw AppError.conflict("This step-up is already being decided.");
          await appendLedgerEvent(tx, {
            workflowId: record.workflowId ?? `agent-decision-${record.id}`,
            merchantId,
            actorType: "POLICY_ENGINE",
            actionType: "AGENT_STEP_UP_AUTHORIZATION_EXPIRED",
            status: "REJECTED",
            conciseReason: "The buyer's original authorization was expired, out of scope, or insufficient when the merchant attempted approval.",
            relatedEntityType: "DecisionRecord",
            relatedEntityId: record.id,
            executedAt: now,
          });
        });
        throw new AppError("AUTHORIZATION_EXPIRED", "The buyer's authorization is no longer valid; request a fresh signed intent.");
      }
    }

    // Conditional claim and ledger append share one transaction. Two
    // approvers cannot both leave PENDING, and a ledger failure rolls the
    // claim back before any provider call occurs.
    let updated = await prisma.$transaction(async (tx) => {
      const claim = await tx.decisionRecord.updateMany({
        where: {
          id: decisionId,
          merchantId,
          outcome: "STEP_UP",
          OR: [
            { stepUpStatus: "PENDING" },
            { stepUpStatus: "PROCESSING", stepUpDecidedAt: { lt: new Date(now.getTime() - STALE_LOCK_TIMEOUT_MS) } },
          ],
        },
        data: {
          stepUpStatus: body.decision === "APPROVED" ? "PROCESSING" : "REJECTED",
          stepUpDecidedById: request.merchantUserId,
          stepUpDecidedAt: now,
          stepUpDecisionNote: body.note ?? null,
        },
      });
      if (claim.count !== 1) throw AppError.conflict("This step-up is already being decided.");
      const claimed = await tx.decisionRecord.findUniqueOrThrow({ where: { id: decisionId } });
      await appendLedgerEvent(tx, {
        workflowId: claimed.workflowId ?? `agent-decision-${claimed.id}`,
        merchantId,
        actorType: "MERCHANT_USER",
        actionType: body.decision === "APPROVED" ? "AGENT_STEP_UP_APPROVED" : "AGENT_STEP_UP_REJECTED",
        status: body.decision === "APPROVED" ? "APPROVED" : "REJECTED",
        conciseReason:
          body.decision === "APPROVED"
            ? "An authenticated merchant approver authorized the stepped-up agent purchase."
            : "An authenticated merchant approver rejected the stepped-up agent purchase.",
        relatedEntityType: "DecisionRecord",
        relatedEntityId: claimed.id,
        metadata: { decidedById: request.merchantUserId, note: body.note ?? null },
        executedAt: now,
      });
      return claimed;
    });

    const workflowId = updated.workflowId ?? `agent-decision-${updated.id}`;

    if (body.decision === "APPROVED" && updated.protocol === "X402") {
      // A merchant approval cannot silently switch an x402 purchase onto
      // Razorpay. The original payment authorization was intentionally not
      // retained; the buyer must retry with a fresh x402 authorization so
      // the facilitator can verify and settle the exact approved payment.
      updated = await prisma.decisionRecord.update({
        where: { id: updated.id },
        data: { stepUpStatus: "APPROVED", settlementStatus: "REQUIRES_NEW_X402_AUTHORIZATION" },
      });
    } else if (body.decision === "APPROVED") {
      const lines = updated.normalizedBasket as
        | { productId: string; variantId: string; quantity: number; unitPriceMinor: number }[]
        | null;
      if (!lines || !updated.computedTotalMinor || !updated.currency) {
        updated = await prisma.decisionRecord.update({
          where: { id: updated.id },
          data: { stepUpStatus: "APPROVED", settlementStatus: "EXECUTION_FAILED" },
        });
      } else {
        try {
          const execution = await executeExternalAgentPurchase(prisma, {
            merchantId,
            decisionId: updated.id,
            workflowId,
            amountMinor: updated.computedTotalMinor,
            currency: updated.currency,
            lines,
          });
          updated = await prisma.decisionRecord.update({
            where: { id: updated.id },
            data: {
              providerOrderId: execution.providerOrderId,
              internalOrderId: execution.orderId,
              internalPaymentId: execution.paymentId,
              settlementStatus: "AWAITING_PAYMENT",
              stepUpStatus: "APPROVED",
            },
          });
        } catch (error) {
          request.log.error({ err: error, decisionId: updated.id }, "approved step-up execution failed safely");
          const executionError = error instanceof ExternalPurchaseExecutionError ? error : null;
          updated = await prisma.decisionRecord.update({
            where: { id: updated.id },
            data: {
              stepUpStatus: "APPROVED",
              settlementStatus: executionError?.executionStatus ?? "EXECUTION_FAILED",
              internalOrderId: executionError?.refs.orderId,
              internalPaymentId: executionError?.refs.paymentId,
              providerOrderId: executionError?.refs.providerOrderId,
            },
          });
        }
      }
      if (updated.internalPaymentId) {
        await prisma.acpCheckoutSession.updateMany({
          where: { decisionRecordId: updated.id },
          data: { status: updated.settlementStatus === "AWAITING_PAYMENT" ? "payment_in_progress" : "payment_failed" },
        });
      }
    }

    return {
      id: updated.id,
      stepUpStatus: updated.stepUpStatus,
      decidedAt: updated.stepUpDecidedAt?.toISOString() ?? null,
      settlementStatus: updated.settlementStatus,
      orderId: updated.providerOrderId,
      paymentId: updated.internalPaymentId,
      // The agent receives a normal Razorpay order only after approval;
      // there is never a pre-approval buyer-payable link.
      paymentLinkUrl: null,
    };
  });

  app.get(`${prefix}/agent-gateway/step-ups`, async (request) => {
    const merchantId = getAuthenticatedMerchantId(request);
    const rows = await prisma.decisionRecord.findMany({
      where: { merchantId, outcome: "STEP_UP", stepUpStatus: "PENDING" },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return {
      items: rows.map((r) => ({
        id: r.id,
        externalAgentId: r.externalAgentId,
        protocol: r.protocol,
        computedTotalMinor: r.computedTotalMinor,
        currency: r.currency,
        appliedCeilingMinor: r.appliedCeilingMinor,
        reasonCode: r.reasonCode,
        explanation: r.explanation,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  });

  /**
   * Fires the five scripted intents from the console (TECH_SPEC §8), so a
   * jury watches the log populate live rather than reading a screenshot.
   *
   * The script is spawned as a child process rather than imported: it is a
   * demo artifact that talks to the API over real HTTP, and running it
   * in-process would quietly turn it into something else — a set of
   * function calls that skips the very transport the demo is meant to show.
   */
  app.post(`${prefix}/agent-gateway/run-demo`, async (request) => {
    getAuthenticatedMerchantId(request);

    const scriptPath = fileURLToPath(new URL("../../../scripts/demo-agent-swarm.ts", import.meta.url));
    const started = Date.now();

    const output = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
      const child = spawn(process.execPath, ["--import", "tsx", scriptPath], {
        env: { ...process.env, API_BASE: process.env.PUBLIC_API_BASE ?? `http://127.0.0.1:${process.env.PORT ?? 4000}/api/v1` },
        cwd: fileURLToPath(new URL("../../..", import.meta.url)),
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => (stdout += String(chunk)));
      child.stderr.on("data", (chunk) => (stderr += String(chunk)));
      child.on("close", (code) => resolve({ code, stdout, stderr }));
      // A demo that hangs must not hang the console with it.
      setTimeout(() => child.kill("SIGTERM"), 120_000).unref();
    });

    return {
      ok: output.code === 0,
      exitCode: output.code,
      durationMs: Date.now() - started,
      // Returned so a failure is visible in the console rather than
      // silently reported as "ran".
      output: output.stdout
        .split("\n")
        // Structured log lines are noise in a demo panel; the script's own
        // human-readable report is the point.
        .filter((line) => !line.trim().startsWith("{"))
        .join("\n")
        .slice(-4000),
      error: output.code === 0 ? null : output.stderr.slice(-1000),
    };
  });

  app.get(`${prefix}/agent-gateway/metrics`, async (request) => {
    const merchantId = getAuthenticatedMerchantId(request);
    return buildDecisionMetrics(prisma, merchantId);
  });
}
