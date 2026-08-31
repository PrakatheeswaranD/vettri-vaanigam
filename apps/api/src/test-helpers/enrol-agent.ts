/**
 * Enrols a buyer agent the way a merchant actually would.
 *
 * WHY EVERY GATEWAY TEST NEEDS THIS NOW
 *
 * Mandates used to verify against the public key inside the request, so a
 * test could mint a keypair and be accepted. That was the vulnerability,
 * and the tests passed BECAUSE of it. Now a key is only trusted once a
 * merchant has registered it, so a test has to enrol first — which is also
 * a more honest rehearsal of what an integration really involves.
 */
import { generateKeyPairSync, sign as edSign, randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { mandateSigningPayload, type SpendMandate } from "@razorgrowth/domain";
import { registerAgentKey } from "../modules/gateway/agent-registry.js";
import { acpRequestSigningPayload } from "../modules/acp/request-signature.js";

export interface EnrolledAgent {
  externalAgentId: string;
  apiKey: string;
  publicKey: string;
  /** Signs a mandate as this agent, with the enrolled key. */
  mandate: (merchantId: string, overrides?: Partial<Omit<SpendMandate, "signature" | "publicKey">>) => Record<string, unknown>;
  /** ACP/gateway headers: credential plus a fresh idempotency key. */
  headers: (extra?: Record<string, string>) => Record<string, string>;
  /** ACP detached signature bound to method, path, timestamp and body. */
  requestHeaders: (method: string, path: string, body?: unknown, extra?: Record<string, string>) => Record<string, string>;
}

export async function enrolAgent(
  prisma: PrismaClient,
  merchantId: string,
  externalAgentId = `agent-${randomUUID().slice(0, 8)}`,
): Promise<EnrolledAgent> {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const rawPublicKey = publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64");

  const { apiKey } = await registerAgentKey(prisma, merchantId, { externalAgentId, publicKey: rawPublicKey });

  return {
    externalAgentId,
    apiKey,
    publicKey: rawPublicKey,

    mandate(scopeMerchantId, overrides = {}) {
      const now = Date.now();
      const terms = {
        mandateId: randomUUID(),
        buyerAgentId: externalAgentId,
        merchantScope: scopeMerchantId,
        maxAmountMinor: 10_000_000,
        currency: "INR" as const,
        notBefore: new Date(now - 60_000),
        expiresAt: new Date(now + 600_000),
        nonce: randomUUID(),
        ...overrides,
      };
      const signature = edSign(null, Buffer.from(mandateSigningPayload(terms), "utf8"), privateKey).toString("base64");
      return {
        ...terms,
        notBefore: terms.notBefore.toISOString(),
        expiresAt: terms.expiresAt.toISOString(),
        publicKey: rawPublicKey,
        signature,
      };
    },

    headers(extra = {}) {
      return {
        "x-agent-id": externalAgentId,
        authorization: `Bearer ${apiKey}`,
        "idempotency-key": randomUUID(),
        ...extra,
      };
    },

    requestHeaders(method, path, body = null, extra = {}) {
      const timestamp = new Date().toISOString();
      const idempotencyKey = extra["idempotency-key"] ?? randomUUID();
      const signature = edSign(
        null,
        Buffer.from(acpRequestSigningPayload(method, path, timestamp, body, idempotencyKey), "utf8"),
        privateKey,
      ).toString("base64");
      return {
        "x-agent-id": externalAgentId,
        authorization: `Bearer ${apiKey}`,
        "idempotency-key": idempotencyKey,
        "api-version": "2026-04-17",
        timestamp,
        signature,
        ...extra,
      };
    },
  };
}
