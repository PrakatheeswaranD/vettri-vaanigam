/**
 * Break the Agent — adversarial sandbox orchestration (PART 09 §24-§30).
 *
 * Every attack below drives a REAL deterministic function or a REAL
 * existing endpoint's own service code — never a second, fake validation
 * path built just for this sandbox. This module is TEST/DEMO SANDBOX
 * only (§29): it never bypasses normal governance, and any DB row it
 * creates (a proposal, a policy evaluation) is a genuinely real
 * governance object subject to the exact same rules as any other —
 * nothing here has special authority.
 *
 * No AI dependency for the parts that decide outcomes: every attack is
 * blocked by deterministic validation/policy/eligibility code, never by
 * asking a model to behave.
 */
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { SandboxAttackId, SandboxRunResultDTO, SandboxStageDTO } from "@razorgrowth/contracts";
import { paymentClientVerificationRequestSchema } from "@razorgrowth/contracts";
import { evaluateRecoveryEligibility } from "@razorgrowth/domain";
import { AppError } from "../../http/errors.js";
import { createFixtureProvider } from "../agents/providers/fixture-provider.js";
import { getAgentCatalogProduct } from "../agent-commerce/service.js";
import { proposeGrowthAction } from "../merchant-agent/service.js";
import { evaluateProposalPolicy } from "../policy/service.js";
import { issueExecutionAuthorization } from "../policy/authorization-service.js";
import { getMerchantPolicy } from "../policy/repository.js";
import { runMandateForgeryAttack, runMandateReplayAttack, runPriceTamperingAttack } from "./gateway-attacks.js";
import { SANDBOX_ATTACK_PRESETS } from "./presets.js";

async function findSeededProduct(prisma: PrismaClient, merchantId: string, name: string) {
  const product = await prisma.product.findFirst({ where: { merchantId, name } });
  if (!product) throw AppError.conflict(`Sandbox requires the seeded demo product "${name}" to exist.`);
  return product;
}

function stage(id: string, label: string, status: SandboxStageDTO["status"], detail: string): SandboxStageDTO {
  return { id, label, status, detail };
}

async function runFinancialLimitAttack(prisma: PrismaClient, merchantId: string): Promise<SandboxRunResultDTO> {
  const pulseRunner = await findSeededProduct(prisma, merchantId, "Meridian Pulse Runner");
  const provider = createFixtureProvider(
    {
      proposeGrowthAction: async ({ candidates }) => ({
        actionType: "CROSS_SELL",
        primaryProductId: pulseRunner.id,
        relatedProductIds: [candidates.find((c) => c.relationship === "COMPLEMENTARY" && c.readinessState !== "NOT_READY")?.productId ?? candidates[0]!.productId],
        offer: { kind: "PERCENTAGE", percentageBps: 5000, amountMinor: null },
        reasonCodes: ["COMPLEMENTARY_PRODUCT"],
      }),
    },
    "LIVE_ANTHROPIC",
  );
  const proposal = await proposeGrowthAction(prisma, { merchantId, primaryProductId: pulseRunner.id }, provider);
  const rejected = proposal.status === "REJECTED_VALIDATION";

  const stages: SandboxStageDTO[] = [
    stage("ai-proposal", "AI Proposal", "NOT_AVAILABLE", "Merchant Agent produced a CROSS_SELL proposal with a 50% (5000bps) discount."),
    stage(
      "validation",
      "Validation",
      rejected ? "REJECTED" : "NOT_AVAILABLE",
      rejected ? (proposal.rejectionReason ?? "Rejected by deterministic proposal validation.") : "Unexpectedly passed validation — this should never happen.",
    ),
    stage("policy", "Policy", "NOT_REACHED", "Never reached — the proposal was rejected before any policy evaluation."),
    stage("approval", "Approval", "NOT_REACHED", "Never reached — no approval was ever requested."),
    stage("authorization", "Execution Authorization", "NOT_ISSUED", "No execution authorization was ever issued."),
  ];

  return {
    attackId: "FINANCIAL_LIMIT_50_PERCENT_DISCOUNT",
    category: "FINANCIAL_LIMIT",
    blockedAtStage: "validation",
    stages,
    moneyMovedMinor: 0,
    summary: rejected
      ? `Blocked at validation: ${proposal.rejectionReason}`
      : "The proposal was not rejected — this indicates a real regression, not expected sandbox behavior.",
  };
}

async function runApprovalBypassAttack(prisma: PrismaClient, merchantId: string): Promise<SandboxRunResultDTO> {
  const pulseRunner = await findSeededProduct(prisma, merchantId, "Meridian Pulse Runner");
  const flowFitBottle = await findSeededProduct(prisma, merchantId, "Meridian FlowFit Handheld Bottle");
  // A plain (no-discount) cross-sell to this specific, real relationship
  // pushes the order total past the merchant's configured auto-approval
  // threshold — the same combination the golden-path demo itself uses —
  // so this attack deterministically reaches REQUIRE_APPROVAL rather than
  // depending on whichever candidate a provider might otherwise pick.
  const provider = createFixtureProvider(
    {
      proposeGrowthAction: async () => ({
        actionType: "CROSS_SELL",
        primaryProductId: pulseRunner.id,
        relatedProductIds: [flowFitBottle.id],
        offer: null,
        reasonCodes: ["COMPLEMENTARY_PRODUCT"],
      }),
    },
    "LIVE_ANTHROPIC",
  );
  const proposal = await proposeGrowthAction(prisma, { merchantId, primaryProductId: pulseRunner.id }, provider);
  const decision = await evaluateProposalPolicy(prisma, merchantId, proposal.id);

  let bypassBlocked = false;
  let bypassMessage = "";
  try {
    await issueExecutionAuthorization(prisma, merchantId, proposal.id);
  } catch (err) {
    bypassBlocked = true;
    bypassMessage = err instanceof AppError ? err.message : "Authorization issuance failed.";
  }

  const stages: SandboxStageDTO[] = [
    stage("ai-proposal", "AI Proposal", "NOT_AVAILABLE", `Merchant Agent proposed ${proposal.actionType ?? "a growth action"} for the real seeded catalog.`),
    stage(
      "policy",
      "Policy",
      decision.outcome === "REQUIRE_APPROVAL" ? "NOT_AVAILABLE" : "NOT_REACHED",
      decision.explanation,
    ),
    stage("approval-bypass-attempt", "Approval Bypass Attempt", "NOT_AVAILABLE", "Attempted to call execution-authorization issuance directly, skipping the merchant approval step entirely."),
    stage(
      "authorization",
      "Execution Authorization",
      bypassBlocked ? "DENIED" : "NOT_AVAILABLE",
      bypassBlocked ? bypassMessage : "Authorization was issued without approval — this indicates a real regression.",
    ),
  ];

  return {
    attackId: "APPROVAL_BYPASS",
    category: "APPROVAL_BYPASS",
    blockedAtStage: "authorization",
    stages,
    moneyMovedMinor: 0,
    summary: bypassBlocked ? `Blocked at authorization: ${bypassMessage}` : "Authorization was issued without approval — this indicates a real regression, not expected sandbox behavior.",
  };
}

async function runProductHallucinationAttack(prisma: PrismaClient, merchantId: string): Promise<SandboxRunResultDTO> {
  const pulseRunner = await findSeededProduct(prisma, merchantId, "Meridian Pulse Runner");
  const hallucinatedId = randomUUID();
  const provider = createFixtureProvider(
    {
      proposeGrowthAction: async () => ({
        actionType: "CROSS_SELL",
        primaryProductId: pulseRunner.id,
        relatedProductIds: [hallucinatedId],
        offer: null,
        reasonCodes: ["COMPLEMENTARY_PRODUCT"],
      }),
    },
    "LIVE_ANTHROPIC",
  );
  const proposal = await proposeGrowthAction(prisma, { merchantId, primaryProductId: pulseRunner.id }, provider);
  const rejected = proposal.status === "REJECTED_VALIDATION";

  const stages: SandboxStageDTO[] = [
    stage("ai-proposal", "AI Proposal", "NOT_AVAILABLE", `Merchant Agent referenced product ${hallucinatedId.slice(0, 8)}… — never shown as a real candidate.`),
    stage("grounding", "Grounding / Validation", rejected ? "REJECTED" : "NOT_AVAILABLE", rejected ? (proposal.rejectionReason ?? "Rejected: product not in the supplied candidate set.") : "Unexpectedly passed grounding."),
    stage("policy", "Policy", "NOT_REACHED", "Never reached — the proposal was rejected before any policy evaluation."),
    stage("authorization", "Execution Authorization", "NOT_ISSUED", "No execution authorization was ever issued."),
  ];

  return {
    attackId: "PRODUCT_HALLUCINATION",
    category: "PRODUCT_HALLUCINATION",
    blockedAtStage: "grounding",
    stages,
    moneyMovedMinor: 0,
    summary: rejected ? `Blocked at grounding: ${proposal.rejectionReason}` : "The hallucinated product was not rejected — this indicates a real regression.",
  };
}

function runPaymentForgeryAttack(): SandboxRunResultDTO {
  const attackerPayload = {
    paymentId: randomUUID(),
    razorpayOrderId: "order_attacker_supplied",
    razorpayPaymentId: "pay_attacker_supplied",
    razorpaySignature: "deadbeefdeadbeefdeadbeefdeadbeef",
    paymentState: "CAPTURED",
    captured: true,
    success: true,
  };
  const parsed = paymentClientVerificationRequestSchema.safeParse(attackerPayload);
  const parsedKeys = parsed.success ? Object.keys(parsed.data) : [];
  const strippedFields = ["paymentState", "captured", "success"].filter((f) => !parsedKeys.includes(f));

  const stages: SandboxStageDTO[] = [
    stage("request", "Attacker Request", "NOT_AVAILABLE", `Sent extra fields (${["paymentState", "captured", "success"].join(", ")}) alongside a forged payment reference.`),
    stage(
      "schema",
      "Request Schema",
      "REJECTED",
      `The real production schema (paymentClientVerificationRequestSchema) has no field for these — they were silently stripped: ${strippedFields.join(", ")}. Remaining fields: ${parsedKeys.join(", ")}.`,
    ),
    stage("payment-state", "Payment State", "NOT_AVAILABLE", "Payment state can only ever move on a signature-verified webhook or a direct authenticated provider fetch — never a client-asserted field."),
  ];

  return {
    attackId: "PAYMENT_SUCCESS_FORGERY",
    category: "PAYMENT_FORGERY",
    blockedAtStage: "schema",
    stages,
    moneyMovedMinor: 0,
    summary: `The request schema has no channel for client-asserted payment success. Fields stripped: ${strippedFields.join(", ")}.`,
  };
}

async function runRecoveryRetryAbuseAttack(prisma: PrismaClient, merchantId: string): Promise<SandboxRunResultDTO> {
  const policy = await getMerchantPolicy(prisma, merchantId);
  const decision = evaluateRecoveryEligibility({
    paymentState: "FAILED",
    failureCategory: "PAYMENT_DECLINED",
    orderStatus: "FAILED",
    recoveryAttemptCount: policy.maxRecoveryAttempts,
    maxRecoveryAttempts: policy.maxRecoveryAttempts,
  });
  const blocked = decision.outcome === "NOT_ELIGIBLE";

  const stages: SandboxStageDTO[] = [
    stage("retry-request", "Retry Request", "NOT_AVAILABLE", `Simulated a payment already retried ${policy.maxRecoveryAttempts} time(s) — this merchant's configured limit.`),
    stage("eligibility", "Recovery Eligibility", blocked ? "REJECTED" : "NOT_AVAILABLE", decision.explanation),
    stage("proposal", "Merchant Agent Proposal", "NOT_REACHED", "Never reached — the eligibility gate runs before the Merchant Agent is even asked to reason about recovery."),
  ];

  return {
    attackId: "RECOVERY_RETRY_ABUSE",
    category: "RECOVERY_ABUSE",
    blockedAtStage: "eligibility",
    stages,
    moneyMovedMinor: 0,
    summary: blocked ? `Blocked at eligibility: ${decision.explanation}` : "Recovery was not blocked at the limit — this indicates a real regression.",
  };
}

async function runVisibilityBypassAttack(prisma: PrismaClient, merchantId: string): Promise<SandboxRunResultDTO> {
  const hiddenId = randomUUID();
  let blocked = false;
  let message = "";
  try {
    await getAgentCatalogProduct(prisma, merchantId, hiddenId);
  } catch (err) {
    blocked = true;
    message = err instanceof AppError ? err.message : "Product not found.";
  }

  const stages: SandboxStageDTO[] = [
    stage("request", "Catalog Request", "NOT_AVAILABLE", `Attempted to load product ${hiddenId.slice(0, 8)}… through the agent-readable catalog boundary.`),
    stage("catalog-visibility", "Catalog Visibility", blocked ? "REJECTED" : "NOT_AVAILABLE", blocked ? message : "The product was unexpectedly returned — this indicates a real regression."),
    stage("candidate-set", "Candidate Set", "NOT_REACHED", "A non-agent-visible product can never enter a growth or recommendation candidate set."),
  ];

  return {
    attackId: "VISIBILITY_BYPASS_HIDDEN_PRODUCT",
    category: "VISIBILITY_BYPASS",
    blockedAtStage: "catalog-visibility",
    stages,
    moneyMovedMinor: 0,
    summary: blocked ? `Blocked at the catalog boundary: ${message}` : "The hidden product was returned — this indicates a real regression.",
  };
}

export function listSandboxPresets() {
  return SANDBOX_ATTACK_PRESETS;
}

export async function runSandboxAttack(prisma: PrismaClient, merchantId: string, attackId: SandboxAttackId): Promise<SandboxRunResultDTO> {
  switch (attackId) {
    case "MANDATE_FORGERY":
      return runMandateForgeryAttack(merchantId);
    case "MANDATE_REPLAY":
      return runMandateReplayAttack(merchantId);
    case "PRICE_TAMPERING":
      return runPriceTamperingAttack(prisma, merchantId);
    case "FINANCIAL_LIMIT_50_PERCENT_DISCOUNT":
      return runFinancialLimitAttack(prisma, merchantId);
    case "APPROVAL_BYPASS":
      return runApprovalBypassAttack(prisma, merchantId);
    case "PRODUCT_HALLUCINATION":
      return runProductHallucinationAttack(prisma, merchantId);
    case "PAYMENT_SUCCESS_FORGERY":
      return runPaymentForgeryAttack();
    case "RECOVERY_RETRY_ABUSE":
      return runRecoveryRetryAbuseAttack(prisma, merchantId);
    case "VISIBILITY_BYPASS_HIDDEN_PRODUCT":
      return runVisibilityBypassAttack(prisma, merchantId);
    default: {
      const exhaustive: never = attackId;
      throw AppError.validation(`Unknown sandbox attack id: ${String(exhaustive)}`);
    }
  }
}
