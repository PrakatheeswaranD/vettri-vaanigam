/**
 * Agent identity, keys and credentials.
 *
 * WHAT THIS FIXES
 *
 * Mandate signatures used to be checked against the public key inside the
 * same request. That is self-signed: an attacker generates a keypair,
 * authorises any amount, signs it, and is accepted. The key must come from
 * somewhere the attacker does not control.
 *
 * TWO WAYS A KEY BECOMES TRUSTED
 *
 * 1. `MERCHANT_REGISTERED` — an authenticated merchant user enrolled it.
 *    This is the real answer, and the only one that should be used in
 *    production.
 *
 * 2. `PINNED_ON_FIRST_USE` — trust-on-first-use. The first key an unseen
 *    agent presents is pinned, and every later mandate must match it.
 *
 * TOFU IS NOT A PKI AND IS NOT DESCRIBED AS ONE. It does not authenticate
 * first contact; it only guarantees CONTINUITY — the party spending today
 * is the party that spent yesterday. A first-contact impostor is still
 * bounded by the unknown-agent ceiling and by the step-up gate above it,
 * which is exactly why those exist. It is off by default and a merchant
 * turns it on knowingly.
 */
import { createHash, randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { AgentProtocol } from "@razorgrowth/domain";
import { AppError } from "../../http/errors.js";
import { logger } from "../../observability/logger.js";

export type KeyTrustSource = "MERCHANT_REGISTERED" | "PINNED_ON_FIRST_USE";

/** Ed25519 raw public keys are 32 bytes; base64 of that is 44 chars. */
const ED25519_KEY_B64_LENGTH = 44;

export function isPlausibleEd25519Key(value: string): boolean {
  if (value.length !== ED25519_KEY_B64_LENGTH) return false;
  try {
    return Buffer.from(value, "base64").length === 32;
  } catch {
    return false;
  }
}

export function hashApiKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/**
 * Resolves the agent and the key this merchant trusts for it.
 *
 * Returns `trustedPublicKey: null` when nothing is on file — the verifier
 * then refuses, rather than falling back to whatever the request carried.
 */
export async function resolveAgentForIntent(
  prisma: PrismaClient,
  params: {
    merchantId: string;
    externalAgentId: string;
    firstSeenProtocol: AgentProtocol;
    /** The key the request presented. Only ever used for FIRST-USE pinning. */
    presentedPublicKey: string | null;
    allowFirstUsePinning: boolean;
  },
): Promise<{ id: string; trustedPublicKey: string | null; keyTrustSource: KeyTrustSource | null; settledOrderCount: number }> {
  const existing = await prisma.agentIdentity.findUnique({
    where: { merchantId_externalAgentId: { merchantId: params.merchantId, externalAgentId: params.externalAgentId } },
  });

  if (existing) {
    // A key already on file is never replaced by one from a request. If it
    // were, an attacker could simply present a new key and be re-pinned —
    // which is the original vulnerability wearing a different hat.
    await prisma.agentIdentity.update({ where: { id: existing.id }, data: { lastSeenAt: new Date() } });
    return {
      id: existing.id,
      trustedPublicKey: existing.registeredPublicKey,
      keyTrustSource: (existing.keyTrustSource as KeyTrustSource | null) ?? null,
      settledOrderCount: existing.settledOrderCount,
    };
  }

  const pin =
    params.allowFirstUsePinning && params.presentedPublicKey && isPlausibleEd25519Key(params.presentedPublicKey)
      ? params.presentedPublicKey
      : null;

  const created = await prisma.agentIdentity.create({
    data: {
      merchantId: params.merchantId,
      externalAgentId: params.externalAgentId,
      firstSeenProtocol: params.firstSeenProtocol,
      ...(pin ? { registeredPublicKey: pin, keyTrustSource: "PINNED_ON_FIRST_USE", keyRegisteredAt: new Date() } : {}),
    },
  });

  if (pin) {
    logger.warn(
      { event: "vaanigam.key_pinned_on_first_use", merchantId: params.merchantId, agentId: params.externalAgentId },
      "Pinned an agent key on first use — this guarantees continuity, not first-contact authenticity",
    );
  }

  return { id: created.id, trustedPublicKey: pin, keyTrustSource: pin ? "PINNED_ON_FIRST_USE" : null, settledOrderCount: 0 };
}

/** Merchant-side enrolment: the authenticated, production-correct path. */
export async function registerAgentKey(
  prisma: PrismaClient,
  merchantId: string,
  params: { externalAgentId: string; publicKey: string; displayName?: string },
): Promise<{ id: string; externalAgentId: string; apiKey: string }> {
  if (!isPlausibleEd25519Key(params.publicKey)) {
    throw AppError.validation("That is not a base64-encoded 32-byte Ed25519 public key.");
  }

  // Issued once and never retrievable again — only its hash is stored, the
  // same treatment a user session token gets.
  const apiKey = `ak_${randomBytes(24).toString("base64url")}`;

  const agent = await prisma.agentIdentity.upsert({
    where: { merchantId_externalAgentId: { merchantId, externalAgentId: params.externalAgentId } },
    create: {
      merchantId,
      externalAgentId: params.externalAgentId,
      displayName: params.displayName ?? null,
      firstSeenProtocol: "ACP",
      registeredPublicKey: params.publicKey,
      keyTrustSource: "MERCHANT_REGISTERED",
      keyRegisteredAt: new Date(),
      apiKeyHash: hashApiKey(apiKey),
      apiKeyIssuedAt: new Date(),
    },
    update: {
      displayName: params.displayName ?? undefined,
      registeredPublicKey: params.publicKey,
      keyTrustSource: "MERCHANT_REGISTERED",
      keyRegisteredAt: new Date(),
      apiKeyHash: hashApiKey(apiKey),
      apiKeyIssuedAt: new Date(),
      apiKeyRevokedAt: null,
    },
  });

  return { id: agent.id, externalAgentId: agent.externalAgentId, apiKey };
}

export async function revokeAgent(prisma: PrismaClient, merchantId: string, externalAgentId: string): Promise<void> {
  await prisma.agentIdentity.update({
    where: { merchantId_externalAgentId: { merchantId, externalAgentId } },
    data: { apiKeyRevokedAt: new Date(), apiKeyHash: null },
  });
}

/**
 * Authenticates an agent presenting `Authorization: Bearer <api key>`.
 *
 * ACP requires bearer auth on every endpoint; this is that. A revoked or
 * unknown credential resolves to null and the caller refuses — there is no
 * anonymous fallback.
 */
export async function authenticateAgent(
  prisma: PrismaClient,
  merchantId: string,
  bearer: string | undefined,
): Promise<{ id: string; externalAgentId: string; registeredPublicKey: string | null } | null> {
  if (!bearer || !bearer.startsWith("Bearer ")) return null;
  const raw = bearer.slice("Bearer ".length).trim();
  if (raw.length === 0) return null;

  const agent = await prisma.agentIdentity.findFirst({
    where: { merchantId, apiKeyHash: hashApiKey(raw), apiKeyRevokedAt: null },
    select: { id: true, externalAgentId: true, registeredPublicKey: true },
  });
  return agent;
}
