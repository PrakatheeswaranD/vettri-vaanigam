/**
 * The real ACP surface (TECH_SPEC §2.1), spec version 2026-04-17.
 *
 * ACP is the one of the three protocols with a complete, stable public
 * reference, so it is the one implemented properly rather than shimmed:
 * the actual endpoints, the actual stateful session lifecycle, and real
 * idempotency-key semantics.
 *
 * WHY A SESSION IS PERSISTED
 *
 * ACP is stateful by design — create, update, then complete — and each
 * call has to see what the previous one did. A stateless "just send me the
 * cart" endpoint would be easier and would not be ACP.
 *
 * WHERE THE GOVERNANCE HAPPENS
 *
 * `/complete` is the only endpoint that can move money, so that is the one
 * that runs the full Vaanigam gate: mandate, then merchant policy, then a
 * Decision Record. Creating or updating a session commits the merchant to
 * nothing, so those are deliberately cheap.
 *
 * AUTHENTICATION — every route here requires it
 *
 * The ACP specification requires bearer authentication on every endpoint,
 * and an earlier version of this file had none: anyone could create and
 * complete a session. Worse, the unsigned Allowance was accepted precisely
 * BECAUSE "it arrives over an authenticated ACP channel" — an assumption
 * that was simply false. Both halves of that mistake are fixed here:
 * `requireAgent` authenticates the caller against a merchant-issued
 * credential, and the allowance's own `merchant_id` scope is now compared
 * against the merchant rather than parsed and ignored.
 *
 * An unsigned allowance is still never described as a cryptographically
 * verified mandate — the Decision Record records which one applied.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "../../db/client.js";
import { AppError } from "../../http/errors.js";
import { getPaymentGateway } from "../payments/gateway-factory.js";
import { handleAgentPurchaseIntent } from "../gateway/service.js";
import { withIdempotency } from "./idempotency.js";
import { authenticateAgent } from "../gateway/agent-registry.js";
import { stableSensitiveFingerprint } from "../privacy/redaction.js";
import { issueDelegatedPaymentToken, verifyDelegatedPaymentToken } from "./delegated-payment-token.js";
import { executeExternalAgentPurchase } from "../gateway/execution-service.js";
import { verifyAcpRequestSignature } from "./request-signature.js";
import { buildAcpMessages, type AcpMessage } from "@razorgrowth/domain";

export const ACP_API_VERSION = "2026-04-17";

const lineItemSchema = z.object({
  id: z.string().min(1).max(120),
  quantity: z.number().int().min(1).max(999).default(1),
});

const allowanceSchema = z.object({
  reason: z.string().max(60).optional(),
  max_amount: z.number().int().min(0),
  currency: z.string().min(3).max(3),
  checkout_session_id: z.string().max(120).optional(),
  merchant_id: z.string().max(120).optional(),
  expires_at: z.string().max(40).optional(),
});

/** `risk_signals` from DelegatePaymentRequest. The spec says a
 * `manual_review`/`blocked` signal must feed the Step-Up decision rather
 * than being discarded — an agent's own fraud system flagging a purchase
 * is exactly the evidence a ceiling cannot capture. */
const riskSignalSchema = z.object({
  type: z.string().max(60),
  score: z.number().optional(),
  action: z.enum(["blocked", "manual_review", "authorized"]),
});

const createSessionSchema = z.object({
  line_items: z.array(lineItemSchema).min(1).max(50),
  currency: z.string().min(3).max(3),
  capabilities: z.array(z.string().max(60)).optional(),
  buyer: z.object({ email: z.string().max(200).optional(), name: z.string().max(120).optional() }).optional(),
  allowance: allowanceSchema.optional(),
  risk_signals: z.array(riskSignalSchema).max(20).optional(),
});

const updateSessionSchema = createSessionSchema.partial();

const delegatedPaymentMethodSchema = z.object({
  type: z.enum(["tokenized_card", "network_token", "upi_token", "wallet_token"]),
  // A token from the caller's PCI/payment vault. Raw PAN/CVV fields are
  // intentionally not accepted by this service.
  token: z.string().min(16).max(2_048),
  last4: z.string().regex(/^\d{4}$/).optional(),
});

const completeSessionSchema = z.object({
  payment_data: z.object({
    type: z.literal("delegated_payment_token"),
    token: z.string().min(40).max(500),
  }),
});

type SessionRow = Awaited<ReturnType<typeof prisma.acpCheckoutSession.findUnique>>;

function idempotencyKeyOf(request: FastifyRequest): string | undefined {
  const raw = request.headers["idempotency-key"];
  return Array.isArray(raw) ? raw[0] : raw;
}

/** The ACP wire representation of a session. */
function toAcpSession(
  row: NonNullable<SessionRow>,
  continuation?: { decisionId: string; paymentId: string | null; providerOrderId: string | null; settlementStatus: string | null } | null,
) {
  return {
    id: row.id,
    status: row.status,
    currency: row.currency,
    line_items: row.lineItems,
    totals: { total: row.totalAmountMinor },
    buyer: row.buyerEmail || row.buyerName ? { email: row.buyerEmail, name: row.buyerName } : undefined,
    allowance: row.allowance ?? undefined,
    // ACP's own channel back to the calling agent. Always an array, never
    // omitted: a client that reads `messages.length` should not have to
    // handle undefined on the happy path.
    messages: (row.messages as AcpMessage[] | null) ?? [],
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    ...(continuation ? { vaanigam: continuation } : {}),
  };
}

async function priceLineItems(
  merchantId: string,
  lineItems: { id: string; quantity: number }[],
): Promise<{ totalMinor: number; currency: string } | null> {
  const variants = await prisma.productVariant.findMany({
    where: { sku: { in: lineItems.map((l) => l.id) }, active: true, product: { merchantId, status: "ACTIVE" } },
  });
  const bySku = new Map(variants.map((v) => [v.sku, v]));

  let totalMinor = 0;
  let currency: string | null = null;
  for (const line of lineItems) {
    const variant = bySku.get(line.id);
    if (!variant) return null;
    if (currency && variant.currency !== currency) return null;
    currency = variant.currency;
    totalMinor += variant.priceMinor * line.quantity;
  }
  return { totalMinor, currency: currency ?? "INR" };
}

/**
 * Authenticates the calling agent. There is no anonymous path: an
 * unrecognised or revoked credential is refused before anything is read,
 * created or priced.
 */
async function requireAgent(request: FastifyRequest, merchantId: string) {
  const raw = request.headers.authorization;
  const header = Array.isArray(raw) ? raw[0] : raw;
  const agent = await authenticateAgent(prisma, merchantId, header);
  if (!agent) {
    throw AppError.unauthorized(
      "This endpoint requires an agent credential issued by the merchant. Send it as `Authorization: Bearer <key>`.",
    );
  }
  const requestedVersion = request.headers["api-version"];
  const version = Array.isArray(requestedVersion) ? requestedVersion[0] : requestedVersion;
  if (version !== ACP_API_VERSION) {
    throw AppError.validation(`API-Version must be ${ACP_API_VERSION}.`);
  }
  const signatureHeader = request.headers.signature;
  const timestampHeader = request.headers.timestamp;
  const idempotencyKey = idempotencyKeyOf(request);
  const verified = verifyAcpRequestSignature({
    method: request.method,
    path: request.url,
    timestamp: Array.isArray(timestampHeader) ? timestampHeader[0] : timestampHeader,
    signature: Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader,
    body: request.body,
    idempotencyKey,
    publicKeyBase64: agent.registeredPublicKey,
  });
  if (!verified.valid) throw AppError.unauthorized(`ACP request signature rejected: ${verified.reason}`);
  if (request.method !== "GET" && (!idempotencyKey || idempotencyKey.trim().length === 0)) {
    throw new AppError("IDEMPOTENCY_KEY_REQUIRED", "An Idempotency-Key header is required on ACP mutations.");
  }
  return agent;
}

async function resolveMerchant(slug: string) {
  const merchant = await prisma.merchant.findUnique({ where: { slug }, select: { id: true, status: true } });
  if (!merchant || merchant.status !== "ACTIVE") {
    throw AppError.notFound(`No active merchant is published at "${slug}".`);
  }
  return merchant;
}

export function registerAcpRoutes(app: FastifyInstance, prefix: string): void {
  const base = `${prefix}/acp/:merchantSlug`;

  app.addHook("onSend", async (request, reply, payload) => {
    if (request.url.includes("/acp/")) reply.header("API-Version", ACP_API_VERSION);
    return payload;
  });

  app.post(`${base}/checkout_sessions`, async (request, reply) => {
    const { merchantSlug } = request.params as { merchantSlug: string };
    const merchant = await resolveMerchant(merchantSlug);
    const agent = await requireAgent(request, merchant.id);
    const body = createSessionSchema.parse(request.body);

    const outcome = await withIdempotency(
      prisma,
      { merchantId: merchant.id, operation: `acp.create_session:${agent.id}`, key: idempotencyKeyOf(request), body: request.body },
      async () => {
        const priced = await priceLineItems(merchant.id, body.line_items);
        const session = await prisma.acpCheckoutSession.create({
          data: {
            // ACP's own id convention, so the value is recognisable in an
            // agent's logs rather than looking like an internal UUID.
            id: `csn_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
            merchantId: merchant.id,
            // A basket we cannot price is not ready for payment, and saying
            // so is more useful than refusing the session outright — the
            // agent can correct the cart and update.
            status: priced ? "ready_for_payment" : "not_ready_for_payment",
            currency: priced?.currency ?? body.currency.toUpperCase(),
            lineItems: body.line_items,
            totalAmountMinor: priced?.totalMinor ?? 0,
            buyerEmail: body.buyer?.email ?? null,
            buyerName: body.buyer?.name ?? null,
            allowance: body.allowance ?? undefined,
            riskSignals: body.risk_signals ?? undefined,
            // From the CREDENTIAL, never a self-asserted header.
            externalAgentId: agent.externalAgentId,
          },
        });
        return toAcpSession(session);
      },
    );

    return reply.status(outcome.replayed ? 200 : 201).send(outcome.response);
  });

  app.get(`${base}/checkout_sessions/:sessionId`, async (request) => {
    const { merchantSlug, sessionId } = request.params as { merchantSlug: string; sessionId: string };
    const merchant = await resolveMerchant(merchantSlug);
    const agent = await requireAgent(request, merchant.id);
    const session = await prisma.acpCheckoutSession.findUnique({ where: { id: sessionId } });
    if (!session || session.merchantId !== merchant.id || session.externalAgentId !== agent.externalAgentId) {
      throw AppError.notFound(`No checkout session ${sessionId}.`);
    }
    const decision = session.decisionRecordId
      ? await prisma.decisionRecord.findUnique({
          where: { id: session.decisionRecordId },
          select: { id: true, internalPaymentId: true, providerOrderId: true, settlementStatus: true },
        })
      : null;
    return toAcpSession(
      session,
      decision
        ? {
            decisionId: decision.id,
            paymentId: decision.internalPaymentId,
            providerOrderId: decision.providerOrderId,
            settlementStatus: decision.settlementStatus,
          }
        : null,
    );
  });

  app.post(`${base}/checkout_sessions/:sessionId`, async (request) => {
    const { merchantSlug, sessionId } = request.params as { merchantSlug: string; sessionId: string };
    const merchant = await resolveMerchant(merchantSlug);
    const agent = await requireAgent(request, merchant.id);
    const body = updateSessionSchema.parse(request.body);

    const outcome = await withIdempotency(
      prisma,
      { merchantId: merchant.id, operation: `acp.update_session:${agent.id}`, key: idempotencyKeyOf(request), body: { sessionId, ...body } },
      async () => {
        const existing = await prisma.acpCheckoutSession.findUnique({ where: { id: sessionId } });
        if (!existing || existing.merchantId !== merchant.id || existing.externalAgentId !== agent.externalAgentId) {
          throw AppError.notFound(`No checkout session ${sessionId}.`);
        }
        if (existing.status === "completed" || existing.status === "canceled") {
          throw new AppError("SESSION_NOT_MUTABLE", `A ${existing.status} checkout session cannot be updated.`);
        }
        const lineItems = body.line_items ?? (existing.lineItems as { id: string; quantity: number }[]);
        const priced = await priceLineItems(merchant.id, lineItems);
        const updated = await prisma.acpCheckoutSession.update({
          where: { id: sessionId },
          data: {
            lineItems,
            totalAmountMinor: priced?.totalMinor ?? 0,
            status: priced ? "ready_for_payment" : "not_ready_for_payment",
            ...(body.buyer?.email !== undefined ? { buyerEmail: body.buyer.email } : {}),
            ...(body.buyer?.name !== undefined ? { buyerName: body.buyer.name } : {}),
            ...(body.allowance ? { allowance: body.allowance } : {}),
            ...(body.risk_signals ? { riskSignals: body.risk_signals } : {}),
          },
        });
        return toAcpSession(updated);
      },
    );
    return outcome.response;
  });

  app.post(`${base}/checkout_sessions/:sessionId/cancel`, async (request) => {
    const { merchantSlug, sessionId } = request.params as { merchantSlug: string; sessionId: string };
    const merchant = await resolveMerchant(merchantSlug);
    const agent = await requireAgent(request, merchant.id);
    const outcome = await withIdempotency(
      prisma,
      { merchantId: merchant.id, operation: `acp.cancel_session:${agent.id}`, key: idempotencyKeyOf(request), body: { sessionId } },
      async () => {
        const existing = await prisma.acpCheckoutSession.findUnique({ where: { id: sessionId } });
        if (!existing || existing.merchantId !== merchant.id || existing.externalAgentId !== agent.externalAgentId) {
          throw AppError.notFound(`No checkout session ${sessionId}.`);
        }
        if (existing.status === "completed") {
          throw new AppError("SESSION_NOT_MUTABLE", "A completed checkout session cannot be cancelled.");
        }
        const cancelled = await prisma.acpCheckoutSession.update({ where: { id: sessionId }, data: { status: "canceled" } });
        return toAcpSession(cancelled);
      },
    );
    return outcome.response;
  });

  /**
   * The only ACP endpoint that can move money — so the only one that runs
   * the full Vaanigam gate.
   */
  app.post(`${base}/checkout_sessions/:sessionId/complete`, async (request, reply) => {
    const { merchantSlug, sessionId } = request.params as { merchantSlug: string; sessionId: string };
    const merchant = await resolveMerchant(merchantSlug);
    const agent = await requireAgent(request, merchant.id);
    const completion = completeSessionSchema.parse(request.body);

    const session = await prisma.acpCheckoutSession.findUnique({ where: { id: sessionId } });
    if (!session || session.merchantId !== merchant.id || session.externalAgentId !== agent.externalAgentId) {
      throw AppError.notFound(`No checkout session ${sessionId}.`);
    }
    if (session.status === "completed") throw new AppError("SESSION_NOT_MUTABLE", "This session is already completed.");
    if (session.status === "canceled") throw new AppError("SESSION_NOT_MUTABLE", "This session was cancelled.");
    if (session.status !== "ready_for_payment") {
      throw new AppError("SESSION_NOT_READY", "This checkout session cannot be priced and is not ready for payment.");
    }

    const outcome = await withIdempotency(
      prisma,
      { merchantId: merchant.id, operation: `acp.complete:${agent.id}`, key: idempotencyKeyOf(request), body: { sessionId, ...completion } },
      async () => {
        const delegatedPaymentId = verifyDelegatedPaymentToken(completion.payment_data.token);
        if (!delegatedPaymentId) {
          throw AppError.unauthorized("The delegated payment token is invalid.");
        }
        const delegated = await prisma.acpDelegatedPayment.findUnique({ where: { id: delegatedPaymentId } });
        if (
          !delegated ||
          delegated.merchantId !== merchant.id ||
          delegated.agentIdentityId !== agent.id ||
          delegated.status !== "ACTIVE" ||
          delegated.expiresAt.getTime() <= Date.now() ||
          (delegated.checkoutSessionId !== null && delegated.checkoutSessionId !== session.id)
        ) {
          throw AppError.forbidden(
            "This delegated payment is expired, consumed, or not bound to this merchant, agent, and checkout session.",
          );
        }

        // Atomic one-caller claim. A second completion cannot use the same
        // delegated authorization while this one is executing.
        const claimed = await prisma.acpDelegatedPayment.updateMany({
          where: { id: delegated.id, status: "ACTIVE", expiresAt: { gt: new Date() } },
          data: { status: "IN_FLIGHT" },
        });
        if (claimed.count !== 1) {
          throw new AppError("DELEGATED_PAYMENT_IN_USE", "This delegated payment is already being used or has expired.");
        }

        const paymentGateway = getPaymentGateway();
        const allowance = {
          ...(delegated.allowance as z.infer<typeof allowanceSchema>),
          expires_at: delegated.expiresAt.toISOString(),
        };

        let result: Awaited<ReturnType<typeof handleAgentPurchaseIntent>>;
        try {
          result = await handleAgentPurchaseIntent(
            prisma,
            {
            merchantId: merchant.id,
            headers: { ...request.headers, "x-agent-protocol": "ACP", "x-agent-id": session.externalAgentId ?? "unknown" },
            body: {
              items: (session.lineItems as { id: string; quantity: number }[]).map((l) => ({ id: l.id, quantity: l.quantity })),
              buyer: { email: session.buyerEmail, name: session.buyerName },
              currency: session.currency,
              totals: { total: session.totalAmountMinor },
              // ACP's Allowance IS the mandate here (§2.1 mapping). It is
              // not signed, and the gateway records it as an allowance
              // rather than a verified mandate.
              acp_allowance: allowance,
              // Payment authorization and risk evidence come from the
              // authenticated delegated-payment record, not mutable
              // checkout-session fields supplied earlier.
              risk_signals: delegated.riskSignals ?? [],
              protocol_actor_ref: session.id,
            },
            authorizationAttestation: "TRUSTED_ACP_DELEGATION",
          },
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
        } catch (error) {
          await prisma.acpDelegatedPayment
            .updateMany({ where: { id: delegated.id, status: "IN_FLIGHT" }, data: { status: "ACTIVE" } })
            .catch(() => undefined);
          throw error;
        }

        // In a delegated payment flow, the verified delegated token grants authorization
        // to charge the buyer directly. On auto-approval, capture the payment, settle the checkout,
        // and complete the session.
        const paymentInitiated = result.outcome === "AUTO_APPROVE" && Boolean(result.providerOrderId);
        const isCompleted = result.outcome === "AUTO_APPROVE" && Boolean(result.internalPaymentId);

        const acpMessages = buildAcpMessages({
          outcome: result.outcome,
          reasonCode: result.reasonCode,
          explanation: result.explanation,
          stepUpUrl: result.stepUpUrl,
        });

        if (isCompleted && result.internalPaymentId) {
          await prisma.$transaction([
            prisma.payment.update({
              where: { id: result.internalPaymentId },
              data: {
                state: "CAPTURED",
                capturedAt: new Date(),
              },
            }),
            prisma.acpCheckoutSession.update({
              where: { id: session.id },
              data: {
                status: "completed",
                decisionRecordId: result.decisionId,
                messages: acpMessages as never,
              },
            }),
            prisma.acpDelegatedPayment.update({
              where: { id: delegated.id },
              data: { status: "CONSUMED", consumedAt: new Date() },
            }),
          ]);
        } else {
          await prisma.$transaction([
            prisma.acpCheckoutSession.update({
              where: { id: session.id },
              data: {
                status: paymentInitiated ? "payment_in_progress" : session.status,
                decisionRecordId: result.decisionId,
                messages: acpMessages as never,
              },
            }),
            prisma.acpDelegatedPayment.update({
              where: { id: delegated.id },
              data: paymentInitiated
                ? { status: "CONSUMED", consumedAt: new Date() }
                : result.outcome === "STEP_UP"
                  ? { status: "IN_FLIGHT" }
                  : { status: "ACTIVE" },
            }),
          ]);
        }

        return {
          id: session.id,
          status: isCompleted ? "completed" : "requires_action",
          // ACP's own `messages` array — the protocol field built for
          // exactly this, rather than a private one we invented. An agent
          // that speaks only ACP can act on `approval_required` without
          // knowing anything about Vaanigam.
          messages: acpMessages,
          // The machine-readable Vaanigam reason stays in our own
          // namespace, alongside rather than inside the protocol's enum.
          vaanigam: {
            decision: result.outcome,
            reason_code: result.reasonCode,
            reason: result.explanation,
            order_id: result.providerOrderId,
            payment_id: result.internalPaymentId,
            settlement_status: isCompleted ? "settled" : paymentInitiated ? "awaiting_payment" : result.outcome === "STEP_UP" ? "awaiting_merchant_approval" : "not_started",
            status_token: result.statusToken,
            step_up_url: result.stepUpUrl,
          },
        };
      },
    );

    const httpStatus = outcome.response.status === "completed" ? 200 : 202;
    return reply.status(httpStatus).send(outcome.response);
  });

  /**
   * `delegate_payment` — tokenises a payment method under an Allowance.
   *
   * The caller supplies a token from its own PCI/payment vault. Vaanigam
   * stores only a one-way fingerprint and returns its own signed, bounded
   * token. Raw PAN/CVV fields are not accepted and no instrument secret is
   * persisted in either this table or the idempotency response snapshot.
   */
  app.post(`${prefix}/acp/:merchantSlug/agentic_commerce/delegate_payment`, async (request, reply) => {
    const { merchantSlug } = request.params as { merchantSlug: string };
    const merchant = await resolveMerchant(merchantSlug);
    const agent = await requireAgent(request, merchant.id);
    const body = z
      .object({
        allowance: allowanceSchema,
        payment_method: delegatedPaymentMethodSchema,
        risk_signals: z.array(riskSignalSchema).max(20).optional(),
        metadata: z.record(z.string(), z.string()).optional(),
      })
      .parse(request.body);

    if (body.allowance.merchant_id !== merchant.id) {
      throw AppError.forbidden("A delegated payment must be explicitly scoped to this merchant.");
    }
    const allowanceExpiry = body.allowance.expires_at ? new Date(body.allowance.expires_at) : null;
    if (allowanceExpiry && Number.isNaN(allowanceExpiry.getTime())) {
      throw AppError.validation("allowance.expires_at must be an ISO-8601 timestamp.");
    }
    const expiresAt = allowanceExpiry ?? new Date(Date.now() + 15 * 60_000);
    if (expiresAt.getTime() <= Date.now()) {
      throw AppError.validation("A delegated payment cannot be issued from an expired allowance.");
    }
    if (body.allowance.checkout_session_id) {
      const boundSession = await prisma.acpCheckoutSession.findUnique({ where: { id: body.allowance.checkout_session_id } });
      if (!boundSession || boundSession.merchantId !== merchant.id || boundSession.externalAgentId !== agent.externalAgentId) {
        throw AppError.forbidden("The delegated payment's checkout_session_id is not owned by this merchant and agent.");
      }
    }

    const outcome = await withIdempotency(
      prisma,
      { merchantId: merchant.id, operation: `acp.delegate_payment:${agent.id}`, key: idempotencyKeyOf(request), body: request.body },
      async () => {
        const flagged = (body.risk_signals ?? []).filter((s) => s.action === "blocked" || s.action === "manual_review");
        const delegatedPaymentId = `acpdp_${randomBytes(18).toString("base64url")}`;
        await prisma.acpDelegatedPayment.create({
          data: {
            id: delegatedPaymentId,
            merchantId: merchant.id,
            agentIdentityId: agent.id,
            checkoutSessionId: body.allowance.checkout_session_id ?? null,
            paymentMethodType: body.payment_method.type,
            paymentInstrumentFingerprint: stableSensitiveFingerprint(
              `${body.payment_method.type}:${body.payment_method.token}`,
            ),
            allowance: body.allowance,
            riskSignals: body.risk_signals ?? undefined,
            expiresAt,
          },
        });
        return {
          delegatedPaymentId,
          created: new Date().toISOString(),
          metadata: body.metadata ?? {},
          expiresAt: expiresAt.toISOString(),
          vaanigam: {
            token_kind: "delegated_payment_token",
            payment_instrument_vaulted: false,
            allowance_max_amount: body.allowance.max_amount,
            allowance_currency: body.allowance.currency,
            risk_signals_forwarded: flagged.length,
            note:
              flagged.length > 0
                ? "Risk signals requiring review were supplied; a purchase completed under this allowance will be sent for human approval."
                : "No blocking risk signals were supplied.",
          },
        };
      },
    );

    return reply.status(outcome.replayed ? 200 : 201).send({
      id: issueDelegatedPaymentToken(outcome.response.delegatedPaymentId),
      created: outcome.response.created,
      expires_at: outcome.response.expiresAt,
      metadata: outcome.response.metadata,
      vaanigam: outcome.response.vaanigam,
    });
  });
}
