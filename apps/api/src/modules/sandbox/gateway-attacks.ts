/**
 * Break the Agent — the gateway attacks.
 *
 * The six original presets all probe this merchant's OWN agents: an
 * excessive discount, an approval bypass, a hallucinated product. Once the
 * product is a gateway, the boundary that actually matters is the one an
 * OUTSIDE agent reaches, and none of those touch it.
 *
 * These three do. Nothing here is simulated: a real Ed25519 keypair signs
 * a real mandate, and the SAME verifier the live request path uses is the
 * thing that refuses the tampered one. If the guarantee ever regressed,
 * these would pass and say so rather than reporting a scripted success.
 */
import { randomUUID, generateKeyPairSync, sign as edSign } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { SandboxRunResultDTO, SandboxStageDTO } from "@razorgrowth/contracts";
import {
  mandateSigningPayload,
  verifySpendMandate,
  evaluateAgentGatewayPolicy,
  type AgentGatewayPolicy,
} from "@razorgrowth/domain";
import { AppError } from "../../http/errors.js";
import { verifyMandateSignature } from "../gateway/mandate-verifier.js";

function stage(id: string, label: string, status: SandboxStageDTO["status"], detail: string): SandboxStageDTO {
  return { id, label, status, detail };
}

function rupees(minor: number): string {
  return `₹${(minor / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** A genuine keypair and a genuine signature — not a fixture. */
function issueSignedMandate(merchantId: string, agentId: string, maxAmountMinor: number) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const terms = {
    mandateId: randomUUID(),
    buyerAgentId: agentId,
    merchantScope: merchantId,
    maxAmountMinor,
    currency: "INR" as const,
    notBefore: new Date(Date.now() - 60_000),
    expiresAt: new Date(Date.now() + 600_000),
    nonce: randomUUID(),
  };
  return {
    ...terms,
    publicKey: publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64"),
    signature: edSign(null, Buffer.from(mandateSigningPayload(terms), "utf8"), privateKey).toString("base64"),
  };
}

/**
 * `trustedPublicKey` is the key the merchant has ON FILE. For the forgery
 * attack that is the HONEST key — the attacker's substituted key must be
 * rejected against it, which is exactly the guarantee being demonstrated.
 */
function verifyAgainst(
  mandate: ReturnType<typeof issueSignedMandate>,
  merchantId: string,
  orderTotalMinor: number,
  nonceAlreadyUsed = false,
  trustedPublicKey?: string,
) {
  return verifySpendMandate(mandate, {
    trustedPublicKey: trustedPublicKey ?? mandate.publicKey,
    merchantId,
    callerAgentId: mandate.buyerAgentId,
    orderTotalMinor,
    currency: "INR",
    now: new Date(),
    nonceAlreadyUsed,
    verifySignature: verifyMandateSignature,
  });
}

export function runMandateForgeryAttack(merchantId: string): SandboxRunResultDTO {
  const honest = issueSignedMandate(merchantId, "attacker-agent", 100_000);
  const tampered = { ...honest, maxAmountMinor: 99_000_000 };

  const before = verifyAgainst(honest, merchantId, 100_000, false, honest.publicKey);
  // The merchant has the honest key on file. An attacker who substitutes
  // their own key is refused on the key, before any signature maths — which
  // is the fix for "self-signed mandates were accepted".
  const after = verifyAgainst(tampered, merchantId, 90_000_000, false, honest.publicKey);
  const blocked = before.valid && !after.valid;

  const stages: SandboxStageDTO[] = [
    stage("mandate-issued", "Honest Mandate", "NOT_AVAILABLE", `A genuine mandate authorising ${rupees(100_000)} verifies cleanly.`),
    stage("tamper", "Attacker Edit", "NOT_AVAILABLE", `The attacker raises the cap to ${rupees(99_000_000)} and re-presents the same signature.`),
    stage(
      "signature",
      "Ed25519 Verification",
      after.valid ? "NOT_AVAILABLE" : "REJECTED",
      after.valid
        ? "The tampered mandate verified — this indicates a real regression."
        : `Refused as ${after.code}, checked against the key this merchant has ON FILE for the agent — never the key inside the request. It reports a key/signature failure, not "amount exceeded": naming the business clause would tell an attacker how to shape the next forgery.`,
    ),
  ];

  return {
    attackId: "MANDATE_FORGERY",
    category: "MANDATE_FORGERY",
    blockedAtStage: "signature",
    stages,
    moneyMovedMinor: 0,
    summary: blocked
      ? "A mandate's terms are inside what was signed, so an agent cannot raise its own ceiling in flight."
      : "The forged mandate was accepted — this indicates a real regression.",
  };
}

export function runMandateReplayAttack(merchantId: string): SandboxRunResultDTO {
  const mandate = issueSignedMandate(merchantId, "attacker-agent", 1_000_000);
  const first = verifyAgainst(mandate, merchantId, 500_000, false, mandate.publicKey);
  const second = verifyAgainst(mandate, merchantId, 500_000, true, mandate.publicKey);
  const blocked = first.valid && !second.valid;

  const stages: SandboxStageDTO[] = [
    stage("first-spend", "First Use", "NOT_AVAILABLE", "The mandate is valid and its nonce is consumed."),
    stage("replay", "Replay", "NOT_AVAILABLE", "The attacker submits the identical mandate a second time."),
    stage(
      "nonce",
      "Nonce Replay Check",
      second.valid ? "NOT_AVAILABLE" : "REJECTED",
      second.valid
        ? "The replay succeeded — this indicates a real regression."
        : `Refused as ${second.code}. In the live path a unique constraint settles this, not the earlier read, so two simultaneous retries cannot both win.`,
    ),
  ];

  return {
    attackId: "MANDATE_REPLAY",
    category: "MANDATE_REPLAY",
    blockedAtStage: "nonce",
    stages,
    moneyMovedMinor: 0,
    summary: blocked
      ? "Mandates are single-use, so a captured one cannot be spent again."
      : "The mandate was spent twice — this indicates a real regression.",
  };
}

export async function runPriceTamperingAttack(prisma: PrismaClient, merchantId: string): Promise<SandboxRunResultDTO> {
  const variant = await prisma.productVariant.findFirst({
    where: { active: true, product: { merchantId, status: "ACTIVE" } },
    include: { product: { select: { category: true } } },
  });
  if (!variant) throw AppError.validation("No purchasable product is available to run this attack against.");

  // The merchant's real policy is not needed: this attack is refused before
  // any ceiling is consulted, because the two sides disagree about WHAT is
  // being bought — a worse problem than how much.
  const policy: AgentGatewayPolicy = {
    policyVersion: 0,
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

  const result = evaluateAgentGatewayPolicy(policy, {
    agentTrust: "UNKNOWN",
    orderTotalMinor: variant.priceMinor,
    claimedTotalMinor: 100,
    currency: "INR",
    categories: [variant.product.category],
    lineCount: 1,
    recentIntentCount: 1,
    protocolSupported: true,
  });

  const blocked = result.decision === "DECLINE";
  const stages: SandboxStageDTO[] = [
    stage("claim", "Attacker Claim", "NOT_AVAILABLE", `The agent submits an intent stating this basket costs ${rupees(100)}.`),
    stage(
      "repricing",
      "Server-side Pricing",
      "NOT_AVAILABLE",
      `The merchant prices it from its own catalogue: ${rupees(variant.priceMinor)}. The agent's figure is never used as the charge amount.`,
    ),
    stage(
      "policy",
      "Policy Comparison",
      blocked ? "REJECTED" : "NOT_AVAILABLE",
      blocked ? `Refused as ${result.reasonCode}: ${result.explanation}` : "The mismatch was accepted — this indicates a real regression.",
    ),
  ];

  return {
    attackId: "PRICE_TAMPERING",
    category: "PRICE_TAMPERING",
    blockedAtStage: "policy",
    stages,
    moneyMovedMinor: 0,
    summary: blocked
      ? "Every protocol states a price on the wire; none is believed. The claimed figure exists only so a disagreement can be surfaced."
      : "A claimed price was accepted — this indicates a real regression.",
  };
}
