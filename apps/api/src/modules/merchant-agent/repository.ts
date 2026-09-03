import type { Prisma, PrismaClient, ProductRelationshipType } from "@prisma/client";

const DEFAULT_GROWTH_CONFIG = {
  growthActionsEnabled: true,
  // Unattended cycles are opt-in. A merchant with no config row has not
  // agreed to anything, so the fallback must never be the permissive one.
  autonomousRunsEnabled: false,
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

/**
 * Changes the envelope the agent operates inside.
 *
 * An upsert rather than an update: a merchant whose config row has never
 * been written is running on `DEFAULT_GROWTH_CONFIG`, and the first change
 * they make must create the row rather than fail on a missing one. The
 * defaults are spread first so a partial change cannot silently reset
 * every boundary the merchant did not mention.
 */
export function updateGrowthConfig(
  prisma: PrismaClient,
  merchantId: string,
  changes: Partial<typeof DEFAULT_GROWTH_CONFIG>,
) {
  return prisma.merchantGrowthConfig.upsert({
    where: { merchantId },
    update: changes,
    create: { merchantId, ...DEFAULT_GROWTH_CONFIG, ...changes },
  });
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
/**
 * The buyer's disclosed intent — what a recovery offer is sized against.
 *
 * Scoped by conversation id alone for the same reason as
 * `getRecommendationRecord`: a `BuyerConversation` belongs to the SHOPPER,
 * not to the merchant whose product it discussed. Filtering by the
 * caller's merchant id returned null for every real cross-merchant
 * conversation, which read to the caller as "this buyer disclosed no
 * budget" — so the recovery path computed no gap, declined to propose,
 * and the merchant saw "no relevant growth candidate" for a shopper who
 * had stated a budget in plain words.
 *
 * Nothing merchant-confidential is exposed: the snapshot is the shopper's
 * own stated constraints, and the caller can only act on it for a product
 * it already proved it owns.
 */
export async function getConversationIntentSnapshot(prisma: PrismaClient, conversationId: string) {
  const conversation = await prisma.buyerConversation.findUnique({
    where: { id: conversationId },
    select: { currentIntent: true },
  });
  return conversation?.currentIntent ?? null;
}

/** Same ownership reasoning as `getConversationIntentSnapshot`. */
export async function getRecommendationIntentSnapshot(prisma: PrismaClient, recommendationId: string) {
  const record = await prisma.recommendationRecord.findUnique({
    where: { id: recommendationId },
    select: { intentSnapshot: true },
  });
  return record?.intentSnapshot ?? null;
}

/** PART 04 §15, §28 — used to detect a NEAR_MATCH Buyer Agent outcome so
 * the Merchant Agent can propose a bounded recovery offer closing the
 * exact disclosed budget gap, reusing PART 03's own recorded outcome
 * rather than re-deriving it. */
/**
 * A recommendation the merchant is being asked to make a recovery offer on.
 *
 * WHY THIS IS NOT SCOPED BY `merchantId`
 *
 * A `RecommendationRecord` is filed under the context that OWNS THE
 * CONVERSATION — the shopper's — because that is who the conversation
 * belongs to. The merchant making a recovery offer is the SELLER of a
 * product inside it. Those are two different parties, so filtering this
 * lookup by the caller's merchant id could only ever match when the
 * shopper and the seller were the same row, which stopped being true the
 * moment shoppers stopped being merchants. The recovery path then silently
 * found nothing, fell through to the generic growth proposer, and the
 * merchant got REJECTED_VALIDATION instead of the offer.
 *
 * The authorization that matters is still enforced, and enforced better,
 * by the caller: the primary product is loaded through
 * `getAgentCatalogProduct(prisma, merchantId, …)`, which only resolves
 * products this merchant owns, and the caller then requires that the
 * record actually recommended that product. A merchant can therefore only
 * reach a recommendation that named something they sell — which is the
 * real rule — rather than only their own shoppers' recommendations, which
 * is a rule that describes a single-tenant marketplace.
 */
export function getRecommendationRecord(prisma: PrismaClient, recommendationId: string) {
  return prisma.recommendationRecord.findUnique({
    where: { id: recommendationId },
  });
}

export type { ProductRelationshipType };
