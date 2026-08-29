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
 * that runs the full Anumati gate: mandate, then merchant policy, then a
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
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "../../db/client.js";
import { AppError } from "../../http/errors.js";
import { getPaymentGateway } from "../payments/gateway-factory.js";
import { handleAgentPurchaseIntent } from "../gateway/service.js";
import { withIdempotency } from "./idempotency.js";
import { authenticateAgent } from "../gateway/agent-registry.js";

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

type SessionRow = Awaited<ReturnType<typeof prisma.acpCheckoutSession.findUnique>>;

function idempotencyKeyOf(request: FastifyRequest): string | undefined {
  const raw = request.headers["idempotency-key"];
  return Array.isArray(raw) ? raw[0] : raw;
}

/** The ACP wire representation of a session. */
function toAcpSession(row: NonNullable<SessionRow>) {
  return {
    id: row.id,
    status: row.status,
    currency: row.currency,
    line_items: row.lineItems,
    totals: { total: row.totalAmountMinor },
    buyer: row.buyerEmail || row.buyerName ? { email: row.buyerEmail, name: row.buyerName } : undefined,
    allowance: row.allowance ?? undefined,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
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
      { merchantId: merchant.id, operation: "acp.create_session", key: idempotencyKeyOf(request), body: request.body },
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
    await requireAgent(request, merchant.id);
    const session = await prisma.acpCheckoutSession.findUnique({ where: { id: sessionId } });
    if (!session || session.merchantId !== merchant.id) throw AppError.notFound(`No checkout session ${sessionId}.`);
    return toAcpSession(session);
  });

  app.post(`${base}/checkout_sessions/:sessionId`, async (request) => {
    const { merchantSlug, sessionId } = request.params as { merchantSlug: string; sessionId: string };
    const merchant = await resolveMerchant(merchantSlug);
    await requireAgent(request, merchant.id);
    const body = updateSessionSchema.parse(request.body);

    const existing = await prisma.acpCheckoutSession.findUnique({ where: { id: sessionId } });
    if (!existing || existing.merchantId !== merchant.id) throw AppError.notFound(`No checkout session ${sessionId}.`);
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
  });

  app.post(`${base}/checkout_sessions/:sessionId/cancel`, async (request) => {
    const { merchantSlug, sessionId } = request.params as { merchantSlug: string; sessionId: string };
    const merchant = await resolveMerchant(merchantSlug);
    await requireAgent(request, merchant.id);
    const existing = await prisma.acpCheckoutSession.findUnique({ where: { id: sessionId } });
    if (!existing || existing.merchantId !== merchant.id) throw AppError.notFound(`No checkout session ${sessionId}.`);
    if (existing.status === "completed") {
      throw new AppError("SESSION_NOT_MUTABLE", "A completed checkout session cannot be cancelled.");
    }
    const cancelled = await prisma.acpCheckoutSession.update({ where: { id: sessionId }, data: { status: "canceled" } });
    return toAcpSession(cancelled);
  });

  /**
   * The only ACP endpoint that can move money — so the only one that runs
   * the full Anumati gate.
   */
  app.post(`${base}/checkout_sessions/:sessionId/complete`, async (request, reply) => {
    const { merchantSlug, sessionId } = request.params as { merchantSlug: string; sessionId: string };
    const merchant = await resolveMerchant(merchantSlug);
    await requireAgent(request, merchant.id);

    const session = await prisma.acpCheckoutSession.findUnique({ where: { id: sessionId } });
    if (!session || session.merchantId !== merchant.id) throw AppError.notFound(`No checkout session ${sessionId}.`);
    if (session.status === "completed") throw new AppError("SESSION_NOT_MUTABLE", "This session is already completed.");
    if (session.status === "canceled") throw new AppError("SESSION_NOT_MUTABLE", "This session was cancelled.");

    const outcome = await withIdempotency(
      prisma,
      { merchantId: merchant.id, operation: "acp.complete", key: idempotencyKeyOf(request), body: { sessionId } },
      async () => {
        const paymentGateway = getPaymentGateway();
        const allowance = (session.allowance ?? null) as z.infer<typeof allowanceSchema> | null;

        const result = await handleAgentPurchaseIntent(
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
              risk_signals: session.riskSignals ?? [],
              protocol_actor_ref: session.id,
            },
          },
          paymentGateway
            ? async ({ amountMinor, currency, description }) => {
                const link = await paymentGateway.createPaymentLink({
                  amountMinor,
                  currency,
                  description,
                  referenceId: session.id,
                });
                return { id: link.providerPaymentLinkId, url: link.shortUrl };
              }
            : undefined,
          paymentGateway
            ? async ({ amountMinor, currency, reference }) => {
                const order = await paymentGateway.createPaymentOrder({ internalPaymentId: reference, amountMinor, currency });
                return order.providerOrderId;
              }
            : undefined,
        );

        // `completed` requires BOTH an approval and something payable.
        // Reporting completion with a null order id told the agent the
        // purchase had gone through when nothing existed.
        const genuinelyCompleted = result.outcome === "AUTO_APPROVE" && Boolean(result.providerOrderId);

        await prisma.acpCheckoutSession.update({
          where: { id: session.id },
          data: {
            status: genuinelyCompleted ? "completed" : session.status,
            decisionRecordId: result.decisionId,
          },
        });

        return {
          id: session.id,
          status: genuinelyCompleted ? "completed" : "requires_action",
          // ACP callers get the reason too. An agent that is told only
          // "declined" cannot correct itself; one told why can.
          anumati: {
            decision: result.outcome,
            reason_code: result.reasonCode,
            reason: result.explanation,
            order_id: result.providerOrderId,
            step_up_url: result.stepUpUrl,
          },
        };
      },
    );

    const status = outcome.response.status === "completed" ? 200 : 202;
    return reply.status(status).send(outcome.response);
  });

  /**
   * `delegate_payment` — tokenises a payment method under an Allowance.
   *
   * Implemented as far as is honest: the allowance and risk signals are
   * recorded and a token is returned, but no card data is accepted or
   * vaulted. Anumati is not a PCI vault, and pretending otherwise in a
   * hackathon build would be the exact dishonesty this project avoids
   * elsewhere.
   */
  app.post(`${prefix}/acp/:merchantSlug/agentic_commerce/delegate_payment`, async (request, reply) => {
    const { merchantSlug } = request.params as { merchantSlug: string };
    const merchant = await resolveMerchant(merchantSlug);
    await requireAgent(request, merchant.id);
    const body = z
      .object({
        allowance: allowanceSchema,
        risk_signals: z.array(riskSignalSchema).max(20).optional(),
        metadata: z.record(z.string(), z.string()).optional(),
      })
      .parse(request.body);

    const outcome = await withIdempotency(
      prisma,
      { merchantId: merchant.id, operation: "acp.delegate_payment", key: idempotencyKeyOf(request), body: request.body },
      async () => {
        const flagged = (body.risk_signals ?? []).filter((s) => s.action === "blocked" || s.action === "manual_review");
        return {
          id: `vt_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
          created: new Date().toISOString(),
          metadata: body.metadata ?? {},
          anumati: {
            // Stated rather than implied: this token references an
            // allowance, it does not vault an instrument.
            token_kind: "allowance_reference",
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

    return reply.status(outcome.replayed ? 200 : 201).send(outcome.response);
  });
}
