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
      paymentGateway
        ? async ({ amountMinor, currency, description }) => {
            const link = await paymentGateway.createPaymentLink({
              amountMinor,
              currency,
              description,
              referenceId: `anumati-${Date.now()}`,
            });
            return { id: link.providerPaymentLinkId, url: link.shortUrl };
          }
        : undefined,
      paymentGateway
        ? async ({ amountMinor, currency, reference }) => {
            const order = await paymentGateway.createPaymentOrder({
              internalPaymentId: reference,
              amountMinor,
              currency,
            });
            return order.providerOrderId;
          }
        : undefined,
    );

    // The HTTP status carries the same meaning as the decision, so an agent
    // that reads only the status code still behaves correctly: 200 it may
    // proceed, 202 a human is deciding, 403 refused.
    const status = result.outcome === "AUTO_APPROVE" ? 200 : result.outcome === "STEP_UP" ? 202 : 403;
    return reply.status(status).send(result);
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
    // Deciding twice would overwrite the first person's judgement without
    // trace. A decided step-up is final.
    if (record.stepUpStatus && record.stepUpStatus !== "PENDING") {
      throw new AppError("CONFLICT", `This step-up was already ${record.stepUpStatus.toLowerCase()}.`);
    }

    const updated = await prisma.decisionRecord.update({
      where: { id: decisionId },
      data: {
        stepUpStatus: body.decision,
        stepUpDecidedById: request.merchantUserId,
        stepUpDecidedAt: new Date(),
        stepUpDecisionNote: body.note ?? null,
      },
    });

    return {
      id: updated.id,
      stepUpStatus: updated.stepUpStatus,
      decidedAt: updated.stepUpDecidedAt?.toISOString() ?? null,
      // Only an APPROVED step-up should ever be paid, so the link is
      // withheld until then rather than being live from the moment the
      // intent arrived.
      paymentLinkUrl: updated.stepUpStatus === "APPROVED" ? updated.stepUpPaymentLinkUrl : null,
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
