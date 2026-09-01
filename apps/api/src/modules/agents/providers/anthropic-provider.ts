/**
 * Live Anthropic-backed `AIProvider` (PART 03 §8, §26, §85-§86).
 *
 * Talks to the Anthropic Messages API directly over `fetch` — no SDK
 * dependency, keeping this the one file that knows about the provider's
 * wire format (PART 00 §26 provider isolation). Only instantiated when
 * `AI_PROVIDER_API_KEY` is configured (see `provider-factory.ts`); every
 * other module depends on the `AIProvider` interface, never on this file
 * or Anthropic's response shape directly.
 *
 * Output here is still UNTRUSTED (PART 03 §24) — this module only owns
 * "did the HTTP call and JSON parsing succeed", not "is the content
 * safe/grounded". That validation happens in `intent-extraction.ts` and
 * `recommendation-service.ts`.
 */
import {
  AIProviderError,
  type AIProvider,
  type ExtractIntentParams,
  type ProposeGrowthActionParams,
  type ProposeRecoveryActionParams,
  type RankCandidatesParams,
  type RawGrowthProposal,
  type RawIntentExtraction,
  type RawRankedItem,
  type RawRecoveryProposal,
  type NormalizeCatalogRowParams,
  type RawNormalizedProduct,
  type ProposeAgentUpsellParams,
  type CompilePolicyParams,
  type RawPolicyDraftResponse,
  type RawAgentUpsell,
} from "../ai-provider.js";
import {
  CATALOG_COMPILER_SYSTEM_PROMPT,
  NEGOTIATOR_SYSTEM_PROMPT,
  POLICY_AUTHOR_SYSTEM_PROMPT,
  buildPolicyAuthorUserMessage,
  buildCatalogCompilerUserMessage,
  buildNegotiatorUserMessage,
} from "../prompts/vaanigam-prompts.js";
import {
  INTENT_EXTRACTION_SYSTEM_PROMPT,
  RECOMMENDATION_SYSTEM_PROMPT,
  buildIntentExtractionUserMessage,
  buildRecommendationUserMessage,
} from "../prompts/buyer-prompts.js";
import {
  GROWTH_PROPOSAL_SYSTEM_PROMPT,
  RECOVERY_PROPOSAL_SYSTEM_PROMPT,
  buildGrowthProposalUserMessage,
  buildRecoveryProposalUserMessage,
} from "../prompts/merchant-prompts.js";

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

export interface AnthropicProviderConfig {
  apiKey: string;
  model: string;
  timeoutMs: number;
}

async function callAnthropic(config: AnthropicProviderConfig, system: string, userMessage: string, temperature: number): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  let response: Response;
  try {
    response = await fetch(ANTHROPIC_MESSAGES_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: 1024,
        temperature,
        system,
        messages: [{ role: "user", content: userMessage }],
      }),
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new AIProviderError("AI_TIMEOUT", `Anthropic request exceeded ${config.timeoutMs}ms.`);
    }
    throw new AIProviderError("AI_PROVIDER_UNAVAILABLE", `Anthropic request failed: ${(err as Error).message}`);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new AIProviderError("AI_PROVIDER_UNAVAILABLE", `Anthropic API returned HTTP ${response.status}.`);
  }

  const body = (await response.json().catch(() => null)) as { content?: { type: string; text?: string }[] } | null;
  const text = body?.content?.find((block) => block.type === "text")?.text;
  if (!text) {
    throw new AIProviderError("AI_OUTPUT_INVALID", "Anthropic response contained no text content.");
  }
  return text;
}

/** The model is instructed to return only JSON, but strip any incidental
 * markdown fence defensively before parsing. */
function extractJson(text: string): unknown {
  const stripped = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(stripped);
  } catch {
    throw new AIProviderError("AI_OUTPUT_INVALID", "Anthropic response was not valid JSON.");
  }
}

export function createAnthropicProvider(config: AnthropicProviderConfig): AIProvider {
  return {
    mode: "LIVE_ANTHROPIC",

    async extractIntent(params: ExtractIntentParams): Promise<RawIntentExtraction> {
      const userMessage = buildIntentExtractionUserMessage(params.message, params.knownCategories, params.knownAttributes);
      const text = await callAnthropic(config, INTENT_EXTRACTION_SYSTEM_PROMPT, userMessage, 0);
      const parsed = extractJson(text);
      if (typeof parsed !== "object" || parsed === null) {
        throw new AIProviderError("AI_OUTPUT_INVALID", "Anthropic intent extraction did not return a JSON object.");
      }
      return parsed as RawIntentExtraction;
    },

    async rankCandidates(params: RankCandidatesParams): Promise<RawRankedItem[]> {
      const userMessage = buildRecommendationUserMessage(params.preferredAttributes, params.candidates);
      const text = await callAnthropic(config, RECOMMENDATION_SYSTEM_PROMPT, userMessage, 0.3);
      const parsed = extractJson(text);
      if (!Array.isArray(parsed)) {
        throw new AIProviderError("AI_OUTPUT_INVALID", "Anthropic ranking did not return a JSON array.");
      }
      return parsed as RawRankedItem[];
    },

    async proposeGrowthAction(params: ProposeGrowthActionParams): Promise<RawGrowthProposal> {
      const userMessage = buildGrowthProposalUserMessage(params);
      const text = await callAnthropic(config, GROWTH_PROPOSAL_SYSTEM_PROMPT, userMessage, 0.3);
      const parsed = extractJson(text);
      if (typeof parsed !== "object" || parsed === null) {
        throw new AIProviderError("AI_OUTPUT_INVALID", "Anthropic growth proposal did not return a JSON object.");
      }
      return parsed as RawGrowthProposal;
    },

    async proposeRecoveryAction(params: ProposeRecoveryActionParams): Promise<RawRecoveryProposal> {
      const userMessage = buildRecoveryProposalUserMessage(params);
      const text = await callAnthropic(config, RECOVERY_PROPOSAL_SYSTEM_PROMPT, userMessage, 0.2);
      const parsed = extractJson(text);
      if (typeof parsed !== "object" || parsed === null) {
        throw new AIProviderError("AI_OUTPUT_INVALID", "Anthropic recovery proposal did not return a JSON object.");
      }
      return parsed as RawRecoveryProposal;
    },

    async normalizeCatalogRow(params: NormalizeCatalogRowParams): Promise<RawNormalizedProduct> {
      const userMessage = buildCatalogCompilerUserMessage(params.row, params.knownCategories);
      const text = await callAnthropic(config, CATALOG_COMPILER_SYSTEM_PROMPT, userMessage, 0.1);
      const parsed = extractJson(text);
      if (typeof parsed !== "object" || parsed === null) {
        throw new AIProviderError("AI_OUTPUT_INVALID", "Anthropic catalogue normalisation did not return a JSON object.");
      }
      return parsed as RawNormalizedProduct;
    },

    async proposeAgentUpsell(params: ProposeAgentUpsellParams): Promise<RawAgentUpsell> {
      const userMessage = buildNegotiatorUserMessage(params);
      const text = await callAnthropic(config, NEGOTIATOR_SYSTEM_PROMPT, userMessage, 0.4);
      const parsed = extractJson(text);
      if (typeof parsed !== "object" || parsed === null) {
        throw new AIProviderError("AI_OUTPUT_INVALID", "Anthropic negotiator did not return a JSON object.");
      }
      return parsed as RawAgentUpsell;
    },

    async compilePolicyFromInstruction(params: CompilePolicyParams): Promise<RawPolicyDraftResponse> {
      const userMessage = buildPolicyAuthorUserMessage(params);
      // Low temperature: a translation task with one right answer.
      const text = await callAnthropic(config, POLICY_AUTHOR_SYSTEM_PROMPT, userMessage, 0.1);
      const parsed = extractJson(text);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new AIProviderError("AI_OUTPUT_INVALID", "Anthropic policy author did not return a JSON object.");
      }
      return parsed as RawPolicyDraftResponse;
    },
  };
}
