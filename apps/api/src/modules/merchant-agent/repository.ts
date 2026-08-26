import type { Prisma, PrismaClient, ProductRelationshipType } from "@prisma/client";

const DEFAULT_GROWTH_CONFIG = {
  growthActionsEnabled: true,
  crossSellEnabled: true,
  upsellEnabled: true,
  bundleEnabled: true,
  boundedOffersEnabled: true,
  maxUpsellIncreaseBps: 1500,
  maxProposedDiscountBps: 1000,
  maxCrossSellItems: 3,
  maxBundleItems: 2,
  currency: "INR" as const,
};

/**
 * PART 04 §21-§23 — merchant growth boundaries. Falls back to sensible,
 * conservative defaults if a merchant somehow has no config row yet
 * (never crashes the growth flow over missing configuration), but never
 * lets the Merchant Agent itself create or modify this row.
 */
export async function getGrowthConfig(prisma: PrismaClient, merchantId: string) {
  const config = await prisma.merchantGrowthConfig.findUnique({ where: { merchantId } });
  return config ?? { merchantId, ...DEFAULT_GROWTH_CONFIG };
}

export function listRelationshipsForProduct(prisma: PrismaClient, merchantId: string, sourceProductId: string) {
  return prisma.productRelationship.findMany({
    where: { merchantId, sourceProductId },
    orderBy: { createdAt: "asc" },
  });
}

export interface CreateProposalInput {
  merchantId: string;
  conversationId: string | null;
  recommendationId: string | null;
  primaryProductId: string;
  actionType: "CROSS_SELL" | "UPSELL" | "BUNDLE" | "BOUNDED_OFFER" | "RECOVERY" | null;
  relatedProductIds: string[];
  offerKind: "PERCENTAGE" | "FIXED_AMOUNT" | null;
  offerPercentageBps: number | null;
  offerAmountMinor: number | null;
  offerCurrency: string | null;
  offerCalculation: Prisma.InputJsonValue | null;
  opportunity: Prisma.InputJsonValue | null;
  evidence: Prisma.InputJsonValue;
  reasonCodes: string[];
  explanation: string;
  mode: "AI_PROPOSED" | "DETERMINISTIC_RELATIONSHIP" | "DETERMINISTIC_FALLBACK" | "NO_OPPORTUNITY" | "BLOCKED_BY_DATA";
  status: "PROPOSED" | "REJECTED_VALIDATION";
  rejectionReason: string | null;
  blockedOpportunities: Prisma.InputJsonValue;
  traceId: string;
  /** PART 08 §19 — set only for a payment-failure recovery proposal. */
  recoveryAction?: string | null;
  sourceOrderId?: string | null;
  sourcePaymentId?: string | null;
  sourceCheckoutId?: string | null;
}

export function createProposal(prisma: PrismaClient, input: CreateProposalInput) {
  return prisma.growthActionProposal.create({
    data: {
      merchantId: input.merchantId,
      conversationId: input.conversationId,
      recommendationId: input.recommendationId,
      primaryProductId: input.primaryProductId,
      actionType: input.actionType,
      relatedProductIds: input.relatedProductIds,
      offerKind: input.offerKind,
      offerPercentageBps: input.offerPercentageBps,
      offerAmountMinor: input.offerAmountMinor,
      offerCurrency: input.offerCurrency as never,
      offerCalculation: input.offerCalculation ?? undefined,
      opportunity: input.opportunity ?? undefined,
      evidence: input.evidence,
      reasonCodes: input.reasonCodes,
      explanation: input.explanation,
      mode: input.mode,
      status: input.status,
      rejectionReason: input.rejectionReason,
      blockedOpportunities: input.blockedOpportunities,
      traceId: input.traceId,
      recoveryAction: input.recoveryAction ?? null,
      sourceOrderId: input.sourceOrderId ?? null,
      sourcePaymentId: input.sourcePaymentId ?? null,
      sourceCheckoutId: input.sourceCheckoutId ?? null,
    },
  });
}

export function findProposal(prisma: PrismaClient, merchantId: string, proposalId: string) {
  return prisma.growthActionProposal.findFirst({ where: { id: proposalId, merchantId } });
}

export function listProposals(prisma: PrismaClient, merchantId: string, limit: number) {
  return prisma.growthActionProposal.findMany({
    where: { merchantId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

/** PART 04 §28 — reuse the Buyer Agent's own already-validated,
 * already-normalized conversation intent rather than re-parsing raw text. */
export async function getConversationIntentSnapshot(prisma: PrismaClient, merchantId: string, conversationId: string) {
  const conversation = await prisma.buyerConversation.findFirst({
    where: { id: conversationId, merchantId },
    select: { currentIntent: true },
  });
  return conversation?.currentIntent ?? null;
}

export async function getRecommendationIntentSnapshot(prisma: PrismaClient, merchantId: string, recommendationId: string) {
  const record = await prisma.recommendationRecord.findFirst({
    where: { id: recommendationId, merchantId },
    select: { intentSnapshot: true },
  });
  return record?.intentSnapshot ?? null;
}

/** PART 04 §15, §28 — used to detect a NEAR_MATCH Buyer Agent outcome so
 * the Merchant Agent can propose a bounded recovery offer closing the
 * exact disclosed budget gap, reusing PART 03's own recorded outcome
 * rather than re-deriving it. */
export function getRecommendationRecord(prisma: PrismaClient, merchantId: string, recommendationId: string) {
  return prisma.recommendationRecord.findFirst({
    where: { id: recommendationId, merchantId },
  });
}

export type { ProductRelationshipType };
