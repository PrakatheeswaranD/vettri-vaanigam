/**
 * x402 challenge/response (TECH_SPEC §2.3).
 *
 * The spec's own guidance: the HTTP shape is cheap to do for real, so do
 * it. An unpaid request to a protected resource gets a genuine `402
 * Payment Required` carrying an `accepts` array; the client retries with
 * an `X-PAYMENT` header; the gateway treats a well-formed payload as a
 * mandate and runs the normal Anumati gate.
 *
 * WHAT IS REAL AND WHAT IS NOT — stated, not implied
 *
 * REAL: the 402 response, the `accepts` offer, header decoding, the retry
 * exchange, and every downstream governance check.
 *
 * NOT REAL: settlement. No facilitator is called and nothing moves
 * on-chain. A signature in the payload is carried and recorded but never
 * verified against a chain, so this is a challenge/response
 * implementation with simulated settlement — never described as an x402
 * payment that actually cleared. Every response says so in
 * `settlement_status`, so a client cannot mistake one for the other.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "../../db/client.js";
import { AppError } from "../../http/errors.js";
import { getPaymentGateway } from "../payments/gateway-factory.js";
import { handleAgentPurchaseIntent } from "../gateway/service.js";

export const X402_VERSION = 2;

/** Mirrors the spec's `accepts[]` entry. `network` is a test chain id
 * because nothing here settles; naming mainnet would imply otherwise. */
const NETWORK = "eip155:84532";
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
    amount: z.union([z.string(), z.number()]),
  }),
  payload: z.object({
    signature: z.string().min(16).max(400),
    authorization: z.object({
      from: z.string().min(1).max(120),
      to: z.string().min(1).max(120),
      value: z.union([z.string(), z.number()]),
      validAfter: z.union([z.string(), z.number()]).optional(),
      validBefore: z.union([z.string(), z.number()]),
    }),
  }),
});

function asAmount(value: string | number): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(n) ? Math.round(n) : null;
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
  quotedMinor: number,
): string | null {
  if (parsed.x402Version !== X402_VERSION) return `This gateway speaks x402 v${X402_VERSION}; the payload declared v${parsed.x402Version}.`;
  if (parsed.accepted.scheme !== "exact") return `Only the "exact" scheme is supported; the payload used "${parsed.accepted.scheme}".`;
  if (parsed.accepted.network !== NETWORK) return `The payload settles on "${parsed.accepted.network}", not the network quoted (${NETWORK}).`;

  const accepted = asAmount(parsed.accepted.amount);
  const authorised = asAmount(parsed.payload.authorization.value);
  if (accepted === null || authorised === null) return "The payload's amounts are not numbers.";
  if (accepted !== quotedMinor) return `The payload accepts ${accepted} but the quote was ${quotedMinor}.`;
  if (authorised !== quotedMinor) return `The signed authorisation covers ${authorised} but the quote was ${quotedMinor}.`;

  const validBefore = asAmount(parsed.payload.authorization.validBefore);
  if (validBefore === null) return "The authorisation has no readable expiry.";
  // Seconds since epoch, per EIP-3009.
  if (validBefore * 1000 <= Date.now()) return "The signed authorisation had already expired when it arrived.";

  return null;
}

const purchaseBodySchema = z.object({
  items: z.array(z.object({ sku: z.string().min(1).max(120), quantity: z.number().int().min(1).max(999).default(1) })).min(1).max(50),
  currency: z.string().min(3).max(3).default("INR"),
});

function decodePaymentHeader(request: FastifyRequest): unknown | null {
  const raw = request.headers["x-payment"];
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

    // Price it before quoting. An `accepts.amount` we had not computed
    // would be a number the client could later hold us to.
    const variants = await prisma.productVariant.findMany({
      where: { sku: { in: body.items.map((i) => i.sku) }, active: true, product: { merchantId: merchant.id, status: "ACTIVE" } },
    });
    const bySku = new Map(variants.map((v) => [v.sku, v]));
    let totalMinor = 0;
    for (const item of body.items) {
      const variant = bySku.get(item.sku);
      if (!variant) {
        throw AppError.notFound(`No purchasable product matches SKU "${item.sku}".`);
      }
      totalMinor += variant.priceMinor * item.quantity;
    }

    const presented = decodePaymentHeader(request);

    // ── The challenge ────────────────────────────────────────────────
    if (!presented) {
      return reply.status(402).send({
        x402Version: X402_VERSION,
        resource: {
          url: `${request.protocol}://${request.hostname}${request.url}`,
          description: `Order for ${body.items.length} item(s)`,
        },
        accepts: [
          {
            scheme: "exact",
            network: NETWORK,
            amount: String(totalMinor),
            asset: variants[0]?.currency ?? "INR",
            payTo: merchantSlug,
            maxTimeoutSeconds: MAX_TIMEOUT_SECONDS,
          },
        ],
      });
    }

    const parsed = paymentPayloadSchema.safeParse(presented);
    if (!parsed.success) {
      return reply.status(402).send({
        x402Version: X402_VERSION,
        error: "malformed_payment_payload",
        detail:
          "The X-PAYMENT header is missing required fields. scheme, network, amount, signature and the full authorization block are all mandatory.",
        issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      });
    }

    const inconsistency = inconsistencyWithQuote(parsed.data, totalMinor);
    if (inconsistency) {
      return reply.status(402).send({
        x402Version: X402_VERSION,
        error: "payment_payload_rejected",
        detail: `${inconsistency} Nothing was charged.`,
      });
    }

    // ── The retry, now governed ──────────────────────────────────────
    const paymentGateway = getPaymentGateway();
    const result = await handleAgentPurchaseIntent(
      prisma,
      {
        merchantId: merchant.id,
        headers: { ...request.headers, "x-agent-protocol": "X402" },
        body: {
          x402Version: X402_VERSION,
          currency: variants[0]?.currency ?? body.currency,
          items: body.items,
          payload: parsed.data.payload,
          // NO FABRICATED ALLOWANCE.
          //
          // This route used to mint an allowance for exactly the amount it
          // had just quoted, scoped to itself — the server authorising its
          // own charge and then verifying its own authorisation. That is
          // not consent; it is a rubber stamp with extra steps.
          //
          // The x402 signature cannot be verified without a facilitator,
          // which this build does not have. So no permission is asserted at
          // all: the intent carries none, `x402_unverified_settlement`
          // marks why, and the gateway routes it to a human instead of
          // auto-approving something nobody verified.
          x402_unverified_settlement: true,
          protocol_actor_ref: parsed.data.payload.signature,
        },
      },
      paymentGateway
        ? async ({ amountMinor, currency, description }) => {
            const link = await paymentGateway.createPaymentLink({ amountMinor, currency, description, referenceId: `x402-${Date.now()}` });
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

    const status = result.outcome === "AUTO_APPROVE" ? 200 : result.outcome === "STEP_UP" ? 202 : 403;
    return reply.status(status).send({
      x402Version: X402_VERSION,
      // Named explicitly so no caller can read a 200 here as an on-chain
      // payment. The governance is real; the settlement is not.
      settlement_status: "simulated",
      settlement_note: "The 402 challenge/response is implemented; no facilitator was called and nothing settled on-chain.",
      anumati: {
        decision: result.outcome,
        reason_code: result.reasonCode,
        reason: result.explanation,
        order_id: result.providerOrderId,
        step_up_url: result.stepUpUrl,
      },
    });
  });
}
