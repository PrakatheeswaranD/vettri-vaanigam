import type { GrowthOpportunity } from "@prisma/client";
import type { GrowthOpportunityDTO } from "@razorgrowth/contracts";

export function toGrowthOpportunityDTO(opportunity: GrowthOpportunity): GrowthOpportunityDTO {
  return {
    id: opportunity.id,
    merchantId: opportunity.merchantId,
    category: opportunity.category,
    signal: opportunity.signal,
    recommendation: opportunity.recommendation,
    estimatedValue:
      opportunity.estimatedValueMinor !== null && opportunity.currency
        ? { amountMinor: opportunity.estimatedValueMinor, currency: opportunity.currency }
        : null,
    valueClassification: opportunity.valueClassification,
    status: opportunity.status,
    isSyntheticDemo: opportunity.isSyntheticDemo,
    createdAt: opportunity.createdAt.toISOString(),
  };
}
