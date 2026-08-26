/**
 * Conversion between the domain `BuyerIntent` (pure, minimal, used by
 * eligibility/near-match/grounding) and the wire `BuyerIntentDTO`
 * (adds `schemaVersion`, `originalQuery`, `confidence` — provenance-ish
 * metadata the frontend's Interpreted Intent panel needs, PART 03 §26,
 * §74). The DTO shape is what's actually persisted as
 * `BuyerConversation.currentIntent` — a single stored shape, not two.
 */
import { BUYER_INTENT_SCHEMA_VERSION, type BuyerIntentDTO } from "@razorgrowth/contracts";
import type { BuyerIntent } from "@razorgrowth/domain";

export function toIntentDTO(intent: BuyerIntent, originalQuery: string, confidence: number | null): BuyerIntentDTO {
  return {
    schemaVersion: BUYER_INTENT_SCHEMA_VERSION,
    originalQuery,
    category: intent.category,
    budget: intent.budget,
    quantity: intent.quantity,
    requiredAttributes: intent.requiredAttributes,
    preferredAttributes: intent.preferredAttributes,
    excludedAttributes: intent.excludedAttributes,
    availabilityRequirement: intent.availabilityRequirement,
    confidence,
  };
}

export function toDomainIntent(dto: BuyerIntentDTO | null): BuyerIntent | null {
  if (!dto) return null;
  return {
    category: dto.category,
    budget: dto.budget,
    quantity: dto.quantity,
    requiredAttributes: dto.requiredAttributes,
    preferredAttributes: dto.preferredAttributes,
    excludedAttributes: dto.excludedAttributes,
    availabilityRequirement: dto.availabilityRequirement,
  };
}
