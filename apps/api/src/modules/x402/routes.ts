/**
 * x402 challenge/response (TECH_SPEC §2.3).
 *
 * The spec's own guidance: the HTTP shape is cheap to do for real, so do
 * it. An unpaid request to a protected resource gets a genuine `402
 * Payment Required` carrying an `accepts` array; the client retries with
 * a `PAYMENT-SIGNATURE` header; the gateway verifies it through the
 * configured facilitator and then runs the normal Anumati gate.
 *
 * WHAT IS REAL AND WHAT IS NOT — stated, not implied
 *
 * REAL: the 402 response, the `accepts` offer, header decoding, the retry
 * exchange, and every downstream governance check. When configured, the
 * facilitator performs real verification and settlement.
 *
 * WITHOUT A FACILITATOR: nothing moves on-chain. The request is recorded
 * and stepped up, never presented as paid. With a facilitator, a 200 is
 * returned only after its `/verify` and `/settle` calls succeed.
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "../../db/client.js";
import { AppError } from "../../http/errors.js";
import { handleAgentPurchaseIntent } from "../gateway/service.js";
import { env } from "../../config/env.js";
import { appendLedgerEvent } from "../audit/ledger.js";
import {
  finalizeX402ExternalAgentPurchase,
  prepareX402ExternalAgentPurchase,
} from "../gateway/execution-service.js";
import { verifyGatewayStatusToken } from "../gateway/status-token.js";
import {
  encodeX402Header,
  settleX402Payment,
  verifyX402Payment,
  type X402PaymentPayload,
  type X402PaymentRequirements,
} from "./facilitator.js";

export const X402_VERSION = 2;

/** Mirrors the spec's `accepts[]` entry. The network and asset are always
 * explicit deployment configuration; this route never invents either. */
const MAX_TIMEOUT_SECONDS = 60;

/**
 * REQUIRED, not optional.
 *
 * Every field here used to be `.optional()`, which meant `{}` was a valid
 * "payment" and could produce a real Razorpay order. A payment payload
 * that carries no amount, no authorisation and no signature is not a
 * payment, and accepting it was the single worst hole on this route.
 */
const paymentPayloadSchema = z.object({
  x402Version: z.number().int(),
  accepted: z.object({
    scheme: z.string().min(1).max(40),
    network: z.string().min(1).max(60),
    amount: z.string().regex(/^\d+$/),
    asset: z.string().min(8).max(200),
    payTo: z.string().min(8).max(200),
    maxTimeoutSeconds: z.number().int().positive().max(600),
  }),
  payload: z.object({
    signature: z.string().min(16).max(400),
    authorization: z.object({
      from: z.string().min(1).max(120),
      to: z.string().min(1).max(120),
      value: z.string().regex(/^\d+$/),
      validAfter: z.union([z.string(), z.number()]),
      validBefore: z.union([z.string(), z.number()]),
      nonce: z.string().min(16).max(200),
    }),
  }),
});

function asAtomicAmount(value: string): bigint | null {
  if (!/^\d+$/.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function asEpochSeconds(value: string | number): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

/**
 * Checks the payload against the quote we actually issued.
 *
 * We cannot verify the EIP-3009 signature itself — that needs chain access
 * or a facilitator, and this build has neither. What we CAN do is refuse a
 * payload that does not match what we asked for, so a client cannot name
 * its own amount, settle on a different network, or present an
 * authorisation that has already expired. Returning a reason rather than a
 * boolean keeps the refusal explainable.
 */
function inconsistencyWithQuote(
  parsed: z.infer<typeof paymentPayloadSchema>,
  requirements: X402PaymentRequirements,
): string | null {
  if (parsed.x402Version !== X402_VERSION) return `This gateway speaks x402 v${X402_VERSION}; the payload declared v${parsed.x402Version}.`;
  if (parsed.accepted.scheme !== "exact") return `Only the "exact" scheme is supported; the payload used "${parsed.accepted.scheme}".`;
  if (parsed.accepted.network !== requirements.network) return `The payload settles on "${parsed.accepted.network}", not the network quoted (${requirements.network}).`;
  if (parsed.accepted.asset !== requirements.asset) return "The payload names a different on-chain asset from the quote.";
  if (parsed.accepted.payTo !== requirements.payTo) return "The payload names a different payment recipient from the quote.";
  if (parsed.accepted.maxTimeoutSeconds !== requirements.maxTimeoutSeconds) return "The payload changed the quoted settlement timeout.";
  if (parsed.payload.authorization.to !== requirements.payTo) return "The signed authorization pays a different recipient from the quote.";

  const accepted = asAtomicAmount(parsed.accepted.amount);
  const authorised = asAtomicAmount(parsed.payload.authorization.value);
  if (accepted === null || authorised === null) return "The payload's amounts are not numbers.";
  const quoted = asAtomicAmount(requirements.amount)!;
  if (accepted !== quoted) return `The payload accepts ${accepted} but the quote was ${quoted}.`;
  if (authorised !== quoted) return `The signed authorisation covers ${authorised} but the quote was ${quoted}.`;

  const validAfter = asEpochSeconds(parsed.payload.authorization.validAfter);
  if (validAfter === null || validAfter * 1000 > Date.now()) return "The signed authorization is not valid yet.";

  const validBefore = asEpochSeconds(parsed.payload.authorization.validBefore);
  if (validBefore === null) return "The authorisation has no readable expiry.";
  // Seconds since epoch, per EIP-3009.
  if (validBefore * 1000 <= Date.now()) return "The signed authorisation had already expired when it arrived.";

  return null;
}

const purchaseBodySchema = z.object({
  items: z.array(z.object({ sku: z.string().min(1).max(120), quantity: z.number().int().min(1).max(999).default(1) })).min(1).max(50),
  currency: z.string().min(3).max(3).default("INR"),
  approved_decision_id: z.string().uuid().optional(),
  status_token: z.string().min(40).max(500).optional(),
}).refine((body) => Boolean(body.approved_decision_id) === Boolean(body.status_token), {
  message: "approved_decision_id and status_token must be supplied together",
});

function decodePaymentHeader(request: FastifyRequest): unknown | null {
  // PAYMENT-SIGNATURE is x402 v2. X-PAYMENT remains a read-only migration
  // fallback and never changes the quoted v2 response headers.
  const raw = request.headers["payment-signature"] ?? request.headers["x-payment"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return null;

  // The spec allows base64 or raw JSON. Try base64 first, and fall back
  // rather than rejecting a client that sent plain JSON — being strict
  // here would refuse a technically-fine request for no safety gain.
  try {
    return JSON.parse(Buffer.from(value, "base64").toString("utf8"));
  } catch {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
}

export function registerX402Routes(app: FastifyInstance, prefix: string): void {
  app.post(`${prefix}/x402/:merchantSlug/purchase`, async (request, reply) => {
    const { merchantSlug } = request.params as { merchantSlug: string };
    const merchant = await prisma.merchant.findUnique({
      where: { slug: merchantSlug },
      select: { id: true, status: true },
    });
    if (!merchant || merchant.status !== "ACTIVE") {
      throw AppError.notFound(`No active merchant is published at "${merchantSlug}".`);
    }

    const body = purchaseBodySchema.parse(request.body);
    const quantities = new Map<string, number>();
    for (const item of body.items) {
      const quantity = (quantities.get(item.sku) ?? 0) + item.quantity;
      if (!Number.isSafeInteger(quantity) || quantity > 999) {
        throw AppError.validation(`The combined quantity for SKU "${item.sku}" exceeds 999.`);
      }
      quantities.set(item.sku, quantity);
    }
    const normalizedItems = [...quantities].map(([sku, quantity]) => ({ sku, quantity }));

    // Price it before quoting. An `accepts.amount` we had not computed
    // would be a number the client could later hold us to.
    const variants = await prisma.productVariant.findMany({
      where: { sku: { in: normalizedItems.map((item) => item.sku) }, active: true, product: { merchantId: merchant.id, status: "ACTIVE" } },
    });
    const bySku = new Map(variants.map((v) => [v.sku, v]));
    let totalMinor = 0;
    let catalogCurrency: string | null = null;
    for (const item of normalizedItems) {
      const variant = bySku.get(item.sku);
      if (!variant) {
        throw AppError.notFound(`No purchasable product matches SKU "${item.sku}".`);
      }
      if (catalogCurrency && variant.currency !== catalogCurrency) {
        throw AppError.validation("An x402 basket cannot contain multiple catalog currencies.");
      }
      catalogCurrency = variant.currency;
      totalMinor += variant.priceMinor * item.quantity;
    }

    let humanApprovalAttestation = false;
    if (body.approved_decision_id && body.status_token) {
      const approved = await prisma.decisionRecord.findUnique({ where: { id: body.approved_decision_id } });
      const approvedLines = approved?.normalizedBasket as
        | { variantId: string; quantity: number; unitPriceMinor: number }[]
        | null
        | undefined;
      const requestedFingerprint = normalizedItems
        .map((item) => {
          const variant = bySku.get(item.sku)!;
          return `${variant.id}:${item.quantity}:${variant.priceMinor}`;
        })
        .sort()
        .join("|");
      const approvedFingerprint = approvedLines
        ?.map((line) => `${line.variantId}:${line.quantity}:${line.unitPriceMinor}`)
        .sort()
        .join("|");
      if (
        !approved ||
        approved.merchantId !== merchant.id ||
        approved.protocol !== "X402" ||
        approved.stepUpStatus !== "APPROVED" ||
        approved.settlementStatus !== "REQUIRES_NEW_X402_AUTHORIZATION" ||
        approved.computedTotalMinor !== totalMinor ||
        approved.currency !== catalogCurrency ||
        approvedFingerprint !== requestedFingerprint ||
        !verifyGatewayStatusToken(body.status_token, approved.id)
      ) {
        throw AppError.forbidden("The x402 human-approval continuation is invalid or does not match this basket.");
      }
      humanApprovalAttestation = true;
    }

    const asset = env.X402_ASSET;
    const payTo = env.X402_PAY_TO;
    const atomicUnitsPerMinor = env.X402_ATOMIC_UNITS_PER_MINOR;
    if (!asset || !payTo || !atomicUnitsPerMinor) {
      throw new AppError(
        "PAYMENT_NOT_CONFIGURED",
        "x402 settlement is not configured for this server; no on-chain asset or merchant wallet was advertised.",
      );
    }
    if (catalogCurrency !== env.X402_ASSET_CURRENCY) {
      throw AppError.validation(
        `This x402 asset is configured for ${env.X402_ASSET_CURRENCY}, but the basket is priced in ${catalogCurrency}. No exchange rate was invented.`,
      );
    }

    const atomicAmount = totalMinor * atomicUnitsPerMinor;
    if (!Number.isSafeInteger(atomicAmount) || atomicAmount <= 0) {
      throw AppError.validation("The x402 quote exceeds the safely supported atomic-unit range.");
    }
    const requirements: X402PaymentRequirements = {
      scheme: "exact",
      network: env.X402_NETWORK,
      amount: String(atomicAmount),
      asset,
      payTo,
      maxTimeoutSeconds: MAX_TIMEOUT_SECONDS,
    };
    const paymentRequired = {
      x402Version: X402_VERSION,
      resource: {
        url: `${request.protocol}://${request.hostname}${request.url}`,
        description: `Order for ${normalizedItems.length} item(s)`,
        mimeType: "application/json",
      },
      accepts: [requirements],
    };
    const presented = decodePaymentHeader(request);

    // ── The challenge ────────────────────────────────────────────────
    if (!presented) {
      return reply.header("PAYMENT-REQUIRED", encodeX402Header(paymentRequired)).status(402).send(paymentRequired);
    }

    const parsed = paymentPayloadSchema.safeParse(presented);
    if (!parsed.success) {
      const decisionId = randomUUID();
      const workflowId = `agent-decision-${decisionId}`;
      await prisma.decisionRecord.create({
        data: {
          id: decisionId,
          merchantId: merchant.id,
          outcome: "DECLINE",
          reasonCode: "X402_MALFORMED_PAYLOAD",
          explanation: "The PAYMENT-SIGNATURE header is missing required fields. Nothing was charged.",
          protocol: "X402",
          protocolVersion: String(X402_VERSION),
          detectedVia: "HEADER",
          computedTotalMinor: totalMinor,
          currency: (catalogCurrency ?? body.currency ?? "INR") as "INR" | "USD",
          rawProtocolPayload: presented as never,
          workflowId,
          decisionLatencyMs: 5,
        },
      });
      await appendLedgerEvent(prisma, {
        merchantId: merchant.id,
        actorType: "POLICY_ENGINE",
        actionType: "DECISION_CREATED",
        conciseReason: "Malformed x402 payment payload rejected by gateway.",
        relatedEntityType: "DecisionRecord",
        relatedEntityId: decisionId,
        workflowId,
        metadata: { outcome: "DECLINE", reasonCode: "X402_MALFORMED_PAYLOAD", protocol: "X402" },
      }).catch(() => undefined);

      return reply.status(402).send({
        x402Version: X402_VERSION,
        error: "malformed_payment_payload",
        detail:
          "The PAYMENT-SIGNATURE header is missing required fields. scheme, network, amount, asset, payTo, signature and the full authorization block are mandatory.",
        issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      });
    }

    const inconsistency = inconsistencyWithQuote(parsed.data, requirements);
    if (inconsistency) {
      const decisionId = randomUUID();
      const workflowId = `agent-decision-${decisionId}`;
      await prisma.decisionRecord.create({
        data: {
          id: decisionId,
          merchantId: merchant.id,
          outcome: "DECLINE",
          reasonCode: "X402_QUOTE_INCONSISTENCY",
          explanation: `${inconsistency} Nothing was charged.`,
          protocol: "X402",
          protocolVersion: String(X402_VERSION),
          detectedVia: "HEADER",
          protocolActorRef: parsed.data.payload?.authorization?.nonce ?? null,
          computedTotalMinor: totalMinor,
          currency: (catalogCurrency ?? body.currency ?? "INR") as "INR" | "USD",
          rawProtocolPayload: parsed.data as never,
          workflowId,
          decisionLatencyMs: 5,
        },
      });
      await appendLedgerEvent(prisma, {
        merchantId: merchant.id,
        actorType: "POLICY_ENGINE",
        actionType: "DECISION_CREATED",
        conciseReason: `x402 quote inconsistency: ${inconsistency}`,
        relatedEntityType: "DecisionRecord",
        relatedEntityId: decisionId,
        workflowId,
        metadata: { outcome: "DECLINE", reasonCode: "X402_QUOTE_INCONSISTENCY", protocol: "X402" },
      }).catch(() => undefined);

      return reply.status(402).send({
        x402Version: X402_VERSION,
        error: "payment_payload_rejected",
        detail: `${inconsistency} Nothing was charged.`,
      });
    }

    const paymentPayload = parsed.data as unknown as X402PaymentPayload;
    let facilitatorVerification: Awaited<ReturnType<typeof verifyX402Payment>>;
    try {
      facilitatorVerification = await verifyX402Payment(paymentPayload, requirements);
    } catch (error) {
      request.log.error({ err: error }, "x402 facilitator verification failed");
      return reply.header("PAYMENT-REQUIRED", encodeX402Header({ ...paymentRequired, error: "facilitator_unavailable" })).status(402).send({
        ...paymentRequired,
        error: "facilitator_unavailable",
      });
    }
    if (facilitatorVerification.configured && !facilitatorVerification.isValid) {
      const decisionId = randomUUID();
      const workflowId = `agent-decision-${decisionId}`;
      const reasonCode = facilitatorVerification.invalidReason ?? "X402_INVALID_SETTLEMENT";
      await prisma.decisionRecord.create({
        data: {
          id: decisionId,
          merchantId: merchant.id,
          outcome: "DECLINE",
          reasonCode,
          explanation: `x402 facilitator verified this transaction as invalid: ${reasonCode}. Nothing was charged.`,
          protocol: "X402",
          protocolVersion: String(X402_VERSION),
          detectedVia: "HEADER",
          protocolActorRef: parsed.data.payload?.authorization?.nonce ?? null,
          computedTotalMinor: totalMinor,
          currency: (catalogCurrency ?? body.currency ?? "INR") as "INR" | "USD",
          rawProtocolPayload: parsed.data as never,
          workflowId,
          decisionLatencyMs: 5,
        },
      });
      await appendLedgerEvent(prisma, {
        merchantId: merchant.id,
        actorType: "POLICY_ENGINE",
        actionType: "DECISION_CREATED",
        conciseReason: `x402 facilitator rejected transaction: ${reasonCode}`,
        relatedEntityType: "DecisionRecord",
        relatedEntityId: decisionId,
        workflowId,
        metadata: { outcome: "DECLINE", reasonCode, protocol: "X402" },
      }).catch(() => undefined);

      return reply.header("PAYMENT-REQUIRED", encodeX402Header({ ...paymentRequired, error: facilitatorVerification.invalidReason ?? "invalid_payment" })).status(402).send({
        ...paymentRequired,
        error: facilitatorVerification.invalidReason ?? "invalid_payment",
      });
    }

    // ── The retry, now governed ──────────────────────────────────────
    const result = await handleAgentPurchaseIntent(
      prisma,
      {
        merchantId: merchant.id,
        headers: { ...request.headers, "x-agent-protocol": "X402" },
        body: {
          x402Version: X402_VERSION,
          currency: catalogCurrency ?? body.currency,
          items: normalizedItems,
          payload: parsed.data.payload,
          protocol_actor_ref: parsed.data.payload.authorization.nonce,
        },
        settlementAttestation:
          facilitatorVerification.configured && facilitatorVerification.isValid
            ? "VERIFIED_X402"
            : "UNVERIFIED_X402",
        authoritativeClaimedTotalMinor: totalMinor,
        humanApprovalAttestation,
      },
      undefined,
      undefined,
    );

    if (result.outcome === "AUTO_APPROVE" && facilitatorVerification.configured) {
      try {
        await prisma.spendMandateNonce.create({
          data: {
            merchantId: merchant.id,
            nonce: parsed.data.payload.authorization.nonce,
            mandateId: `x402:${result.decisionId}`,
            buyerAgentId: facilitatorVerification.payer ?? parsed.data.payload.authorization.from,
          },
        });
      } catch {
        const replayExplanation = "This x402 authorization nonce was already used; the replay was refused and nothing new was settled.";
        await prisma.decisionRecord.update({
          where: { id: result.decisionId },
          data: {
            outcome: "DECLINE",
            reasonCode: "PAYMENT_REPLAYED",
            explanation: replayExplanation,
            settlementStatus: "REPLAY_REJECTED",
          },
        });
        await appendLedgerEvent(prisma, {
          workflowId: `agent-decision-${result.decisionId}`,
          merchantId: merchant.id,
          actorType: "PAYMENT_SYSTEM",
          actionType: "X402_PAYMENT_REPLAY_REJECTED",
          status: "REJECTED",
          conciseReason: replayExplanation,
          relatedEntityType: "DecisionRecord",
          relatedEntityId: result.decisionId,
          executedAt: new Date(),
        });
        return reply.header("PAYMENT-REQUIRED", encodeX402Header({ ...paymentRequired, error: "replayed_payment" })).status(402).send({
          ...paymentRequired,
          error: "replayed_payment",
        });
      }

      const workflowId = `agent-decision-${result.decisionId}`;
      const executionLines = normalizedItems.map((item) => {
        const variant = bySku.get(item.sku)!;
        return {
          productId: variant.productId,
          variantId: variant.id,
          quantity: item.quantity,
          unitPriceMinor: variant.priceMinor,
        };
      });
      let prepared: Awaited<ReturnType<typeof prepareX402ExternalAgentPurchase>>;
      try {
        prepared = await prepareX402ExternalAgentPurchase(prisma, {
          merchantId: merchant.id,
          decisionId: result.decisionId,
          workflowId,
          currency: catalogCurrency ?? body.currency,
          amountMinor: totalMinor,
          authorizationReference: `x402:${parsed.data.payload.authorization.nonce}`,
          lines: executionLines,
        });
      } catch (error) {
        const fulfillmentExplanation = `${error instanceof Error ? error.message : "The basket could not be reserved."} The x402 authorization was not settled.`;
        await prisma.decisionRecord.update({
          where: { id: result.decisionId },
          data: {
            outcome: "DECLINE",
            reasonCode: "FULFILLMENT_UNAVAILABLE",
            explanation: fulfillmentExplanation,
            settlementStatus: "NOT_ATTEMPTED",
          },
        });
        await appendLedgerEvent(prisma, {
          workflowId,
          merchantId: merchant.id,
          actorType: "COMMERCE",
          actionType: "X402_FULFILLMENT_REFUSED",
          status: "REJECTED",
          conciseReason: fulfillmentExplanation,
          relatedEntityType: "DecisionRecord",
          relatedEntityId: result.decisionId,
          executedAt: new Date(),
        });
        return reply.status(409).send({
          x402Version: X402_VERSION,
          settlement_status: "not_attempted",
          error: "fulfillment_unavailable",
          anumati: { decision: "DECLINE", reason_code: "FULFILLMENT_UNAVAILABLE", reason: fulfillmentExplanation },
        });
      }

      let settlement: Awaited<ReturnType<typeof settleX402Payment>>;
      try {
        settlement = await settleX402Payment(paymentPayload, requirements);
      } catch (error) {
        request.log.error({ err: error, decisionId: result.decisionId }, "x402 settlement failed");
        await finalizeX402ExternalAgentPurchase(prisma, {
          merchantId: merchant.id,
          workflowId,
          prepared,
          lines: executionLines,
          outcome: "UNKNOWN",
          reason: "facilitator_unavailable",
        });
        const unknownExplanation =
          "The facilitator could not confirm whether settlement completed. The internal payment is UNKNOWN and inventory remains reserved for reconciliation; do not retry this authorization.";
        await prisma.decisionRecord.update({
          where: { id: result.decisionId },
          data: { reasonCode: "SETTLEMENT_UNKNOWN", explanation: unknownExplanation, settlementStatus: "UNKNOWN" },
        });
        return reply.status(202).send({
          x402Version: X402_VERSION,
          settlement_status: "unknown",
          error: "facilitator_unavailable",
          payment_id: prepared.paymentId,
          order_id: prepared.orderId,
          anumati: { decision: result.outcome, reason_code: "SETTLEMENT_UNKNOWN", reason: unknownExplanation },
        });
      }
      if (!settlement.success && !settlement.definitiveFailure) {
        await finalizeX402ExternalAgentPurchase(prisma, {
          merchantId: merchant.id,
          workflowId,
          prepared,
          lines: executionLines,
          outcome: "UNKNOWN",
          reason: settlement.errorReason ?? "invalid_facilitator_success_evidence",
        });
        const unknownExplanation =
          "The facilitator claimed success but returned incomplete or mismatched settlement evidence. The payment is UNKNOWN and inventory remains reserved for reconciliation; do not retry this authorization.";
        await prisma.decisionRecord.update({
          where: { id: result.decisionId },
          data: { reasonCode: "SETTLEMENT_EVIDENCE_INVALID", explanation: unknownExplanation, settlementStatus: "UNKNOWN" },
        });
        return reply.status(202).send({
          x402Version: X402_VERSION,
          settlement_status: "unknown",
          error: settlement.errorReason ?? "invalid_settlement_evidence",
          payment_id: prepared.paymentId,
          order_id: prepared.orderId,
          anumati: { decision: result.outcome, reason_code: "SETTLEMENT_EVIDENCE_INVALID", reason: unknownExplanation },
        });
      }
      if (!settlement.success) {
        const settlementExplanation = `The facilitator did not settle this payment (${settlement.errorReason ?? "settlement_failed"}). It was refused rather than switched to another payment rail.`;
        await finalizeX402ExternalAgentPurchase(prisma, {
          merchantId: merchant.id,
          workflowId,
          prepared,
          lines: executionLines,
          outcome: "FAILED",
          reason: settlement.errorReason ?? "settlement_failed",
        });
        await prisma.decisionRecord.update({
          where: { id: result.decisionId },
          data: {
            outcome: "DECLINE",
            reasonCode: "SETTLEMENT_FAILED",
            explanation: settlementExplanation,
            settlementStatus: "FAILED",
            stepUpStatus: null,
          },
        });
        await appendLedgerEvent(prisma, {
          workflowId,
          merchantId: merchant.id,
          actorType: "PAYMENT_SYSTEM",
          actionType: "X402_SETTLEMENT_FAILED_SAFE",
          status: "FAILED",
          conciseReason: settlementExplanation,
          relatedEntityType: "DecisionRecord",
          relatedEntityId: result.decisionId,
          metadata: { facilitatorReason: settlement.errorReason ?? null },
          executedAt: new Date(),
        });
        return reply.header("PAYMENT-REQUIRED", encodeX402Header({ ...paymentRequired, error: settlement.errorReason ?? "settlement_failed" })).status(402).send({
          ...paymentRequired,
          error: settlement.errorReason ?? "settlement_failed",
        });
      }

      await finalizeX402ExternalAgentPurchase(prisma, {
        merchantId: merchant.id,
        workflowId,
        prepared,
        lines: executionLines,
        outcome: "CAPTURED",
        transactionId: settlement.transaction,
      });
      const paymentResponse = {
        success: true,
        transaction: settlement.transaction,
        network: settlement.network,
        payer: settlement.payer,
        amount: settlement.amount,
      };
      return reply.header("PAYMENT-RESPONSE", encodeX402Header(paymentResponse)).status(200).send({
        x402Version: X402_VERSION,
        settlement_status: "settled",
        settlement: paymentResponse,
        order_id: prepared.orderId,
        payment_id: prepared.paymentId,
        anumati: { decision: result.outcome, reason_code: result.reasonCode, reason: result.explanation },
      });
    }

    const status = result.outcome === "AUTO_APPROVE" ? 200 : result.outcome === "STEP_UP" ? 202 : 403;
    return reply.status(status).send({
      x402Version: X402_VERSION,
      // Named explicitly so no caller can read governance approval as an
      // on-chain payment. Only the facilitator-settled branch returns
      // `settlement_status: settled`.
      settlement_status: "not_settled",
      settlement_note: facilitatorVerification.configured
        ? "The merchant policy did not authorize settlement."
        : "No facilitator is configured; the request was routed to human approval and nothing settled on-chain.",
      anumati: {
        decision: result.outcome,
        reason_code: result.reasonCode,
        reason: result.explanation,
        order_id: result.providerOrderId,
        step_up_url: result.stepUpUrl,
        status_token: result.statusToken,
      },
    });
  });
}
