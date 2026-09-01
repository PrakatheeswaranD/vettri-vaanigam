/**
 * Deterministic fixture `AIProvider` for tests (PART 03 §10, §92, §102,
 * §141; PART 04 §98-§104). Lets tests script exact extraction/ranking/
 * proposal responses — including deliberately broken ones (hallucinated
 * product IDs, malformed output, timeouts) — without any network
 * dependency, so `pnpm test` never needs `AI_PROVIDER_API_KEY` to pass
 * (PART 03 §141 build invariant).
 */
import type {
  AIProvider,
  ExtractIntentParams,
  ProposeGrowthActionParams,
  ProposeRecoveryActionParams,
  RankCandidatesParams,
  RawGrowthProposal,
  RawIntentExtraction,
  RawRankedItem,
  RawRecoveryProposal,
  NormalizeCatalogRowParams,
  RawNormalizedProduct,
  ProposeAgentUpsellParams,
  CompilePolicyParams,
  RawPolicyDraftResponse,
  RawAgentUpsell,
} from "../ai-provider.js";

export interface FixtureProviderScript {
  extractIntent?: (params: ExtractIntentParams) => Promise<RawIntentExtraction> | RawIntentExtraction;
  rankCandidates?: (params: RankCandidatesParams) => Promise<RawRankedItem[]> | RawRankedItem[];
  proposeGrowthAction?: (params: ProposeGrowthActionParams) => Promise<RawGrowthProposal> | RawGrowthProposal;
  proposeRecoveryAction?: (params: ProposeRecoveryActionParams) => Promise<RawRecoveryProposal> | RawRecoveryProposal;
  normalizeCatalogRow?: (params: NormalizeCatalogRowParams) => Promise<RawNormalizedProduct> | RawNormalizedProduct;
  proposeAgentUpsell?: (params: ProposeAgentUpsellParams) => Promise<RawAgentUpsell> | RawAgentUpsell;
  compilePolicyFromInstruction?: (
    params: CompilePolicyParams,
  ) => Promise<RawPolicyDraftResponse> | RawPolicyDraftResponse;
}

export function createFixtureProvider(script: FixtureProviderScript, mode: AIProvider["mode"] = "LIVE_ANTHROPIC"): AIProvider {
  return {
    mode,
    async extractIntent(params) {
      if (!script.extractIntent) {
        throw new Error("Fixture provider: extractIntent was not scripted for this test.");
      }
      return script.extractIntent(params);
    },
    async rankCandidates(params) {
      if (!script.rankCandidates) {
        throw new Error("Fixture provider: rankCandidates was not scripted for this test.");
      }
      return script.rankCandidates(params);
    },
    async proposeGrowthAction(params) {
      if (!script.proposeGrowthAction) {
        throw new Error("Fixture provider: proposeGrowthAction was not scripted for this test.");
      }
      return script.proposeGrowthAction(params);
    },
    async proposeRecoveryAction(params) {
      if (!script.proposeRecoveryAction) {
        throw new Error("Fixture provider: proposeRecoveryAction was not scripted for this test.");
      }
      return script.proposeRecoveryAction(params);
    },
    async normalizeCatalogRow(params) {
      if (!script.normalizeCatalogRow) {
        throw new Error("Fixture provider: normalizeCatalogRow was not scripted for this test.");
      }
      return script.normalizeCatalogRow(params);
    },
    async proposeAgentUpsell(params) {
      if (!script.proposeAgentUpsell) {
        throw new Error("Fixture provider: proposeAgentUpsell was not scripted for this test.");
      }
      return script.proposeAgentUpsell(params);
    },
    async compilePolicyFromInstruction(params) {
      if (!script.compilePolicyFromInstruction) {
        throw new Error("Fixture provider: compilePolicyFromInstruction was not scripted for this test.");
      }
      return script.compilePolicyFromInstruction(params);
    },
  };
}
