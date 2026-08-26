/**
 * Deterministic growth Opportunity Engine (PART 04 §7, §26-§27, §31-§32,
 * §78).
 *
 * Converts a primary product's configured `ProductRelationship` rows into
 * a bounded candidate set the Merchant Agent may reason over — never the
 * whole catalog, and never a raw ORM record. Every candidate is hydrated
 * through PART 02's `agent-commerce` boundary (`getAgentCatalogProduct`),
 * so a DRAFT/ARCHIVED product can never appear as a candidate: it simply
 * 404s and is treated as `PRODUCT_NOT_AGENT_VISIBLE` (blocked), not as an
 * error.
 */
import type { PrismaClient } from "@prisma/client";
import type { AgentReadableProductDTO } from "@razorgrowth/contracts";
import { evaluateGrowthCandidates, type GrowthActionType, type GrowthCandidateEvidence, type GrowthCandidateSet } from "@razorgrowth/domain";
import { getAgentCatalogProduct } from "../agent-commerce/service.js";
import { listRelationshipsForProduct } from "./repository.js";

/** Bounded server-side fetch (PART 04 §63) — this catalog's relationship
 * graph per product is tiny by construction (a handful of curated rows),
 * so this bound is generous, not a real constraint on this dataset. */
export const MAX_GROWTH_CANDIDATES = 20;

function toEvidence(product: AgentReadableProductDTO, relationshipType: GrowthCandidateEvidence["relationshipType"]): GrowthCandidateEvidence {
  const activeVariants = product.variants.filter((v) => v.active);
  const purchasable = activeVariants.filter(
    (v) => v.availability.state === "IN_STOCK" || v.availability.state === "LOW_STOCK",
  );
  const anyUnknown = activeVariants.some((v) => v.availability.state === "UNKNOWN");

  const availabilityState = purchasable.length > 0 ? "IN_STOCK" : anyUnknown ? "UNKNOWN" : "OUT_OF_STOCK";
  const representativeVariant = purchasable[0] ?? activeVariants[0] ?? null;

  return {
    productId: product.productId,
    relationshipType,
    priceMinor: product.commerce.priceRange?.minMinor ?? null,
    availabilityState,
    attributes: representativeVariant?.attributes ?? {},
    readinessState: product.readiness.state,
    hasStructuredAttributes: activeVariants.length > 0 && activeVariants.every((v) => Object.keys(v.attributes).length > 0),
    hasPolicyData: product.policies.returns.status === "KNOWN" && product.policies.shipping.status === "KNOWN",
    isAgentVisible: true,
  };
}

export interface BuildGrowthCandidatesResult {
  primaryProduct: AgentReadableProductDTO;
  candidateSet: GrowthCandidateSet;
  /** Every hydrated candidate, eligible or blocked — for grounding the
   * model's product-ID references (PART 04 §57). */
  allCandidateProductIds: string[];
}

export async function buildGrowthCandidates(
  prisma: PrismaClient,
  merchantId: string,
  primaryProductId: string,
  allowedActionTypes: readonly GrowthActionType[],
): Promise<BuildGrowthCandidatesResult> {
  const primaryProduct = await getAgentCatalogProduct(prisma, merchantId, primaryProductId);
  const relationships = (await listRelationshipsForProduct(prisma, merchantId, primaryProductId)).slice(0, MAX_GROWTH_CANDIDATES);

  const evidence: GrowthCandidateEvidence[] = [];
  for (const rel of relationships) {
    try {
      const targetProduct = await getAgentCatalogProduct(prisma, merchantId, rel.targetProductId);
      evidence.push(toEvidence(targetProduct, rel.relationshipType));
    } catch {
      // Not agent-visible (DRAFT/ARCHIVED, or deleted) — a real
      // relationship exists but the target can't currently be shown.
      evidence.push({
        productId: rel.targetProductId,
        relationshipType: rel.relationshipType,
        priceMinor: null,
        availabilityState: "UNAVAILABLE",
        attributes: {},
        readinessState: "NOT_READY",
        hasStructuredAttributes: false,
        hasPolicyData: false,
        isAgentVisible: false,
      });
    }
  }

  const candidateSet = evaluateGrowthCandidates(evidence, allowedActionTypes);
  return {
    primaryProduct,
    candidateSet,
    allCandidateProductIds: [primaryProduct.productId, ...evidence.map((e) => e.productId)],
  };
}
