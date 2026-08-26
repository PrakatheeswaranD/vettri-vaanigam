/**
 * Readiness → Growth connection (PART 04 §48-§51, §87-§89).
 *
 * Attaches the ACTUAL current value of the relevant Agentic Readiness
 * dimension (PART 02) to each blocked growth opportunity — never a
 * fabricated "fix this and gain N points" estimate. Reads the merchant's
 * latest `ReadinessSnapshot` (already computed by PART 02's
 * `AgenticReadinessEngine`) rather than recalculating anything here; if no
 * snapshot exists yet, both fields are honestly `null` rather than a
 * guessed number.
 */
import type { PrismaClient, ReadinessSnapshot } from "@prisma/client";
import type { BlockedGrowthOpportunityDTO, GrowthBlockerCodeDTO } from "@razorgrowth/contracts";
import { findLatestSnapshot } from "../readiness/repository.js";

const BLOCKER_TO_DIMENSION: Record<string, { key: keyof ReadinessSnapshot; label: string }> = {
  UNKNOWN_INVENTORY: { key: "inventoryReliability", label: "Inventory Reliability" },
  MISSING_PRICE: { key: "priceFreshness", label: "Price Freshness" },
  MISSING_VARIANT_ATTRIBUTE: { key: "metadataQuality", label: "Commerce Metadata Quality" },
  MISSING_POLICY_DATA: { key: "policyCompleteness", label: "Policy Completeness" },
  PRODUCT_NOT_AGENT_VISIBLE: { key: "aiDiscoverability", label: "AI Discoverability" },
};

export interface BlockedOpportunityInput {
  productId: string;
  actionType: string;
  blockerCode: string;
  remediation: string;
}

export async function attachReadinessContext(
  prisma: PrismaClient,
  merchantId: string,
  blocked: BlockedOpportunityInput[],
): Promise<BlockedGrowthOpportunityDTO[]> {
  if (blocked.length === 0) return [];

  const snapshot = await findLatestSnapshot(prisma, merchantId);

  return blocked.map((b) => {
    const mapping = BLOCKER_TO_DIMENSION[b.blockerCode];
    const score = mapping && snapshot ? (snapshot[mapping.key] as number) : null;
    return {
      productId: b.productId,
      actionType: b.actionType as BlockedGrowthOpportunityDTO["actionType"],
      blockerCode: b.blockerCode as GrowthBlockerCodeDTO,
      remediation: b.remediation,
      relatedReadinessDimension: mapping?.label ?? null,
      currentReadinessDimensionScore: score,
    };
  });
}
