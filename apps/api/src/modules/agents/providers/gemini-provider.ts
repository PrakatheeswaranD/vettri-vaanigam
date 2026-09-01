/**
 * Live Google Gemini-backed `AIProvider`.
 *
 * A second live provider alongside `anthropic-provider.ts`, deliberately
 * built against the SAME `AIProvider` interface and the SAME prompts. The
 * agents, grounding validator, policy engine and everything downstream are
 * unchanged and unaware of which provider answered — which is the point:
 * the model is a swappable component sitting OUTSIDE the financial path,
 * not a privileged part of it.
 *
 * Talks to the Generative Language API directly over `fetch`, no SDK — the
 * same provider-isolation rule the Anthropic provider follows (PART 00
 * §26): this is the one file that knows Gemini's wire format.
 *
 * Output here is UNTRUSTED (PART 03 §24). This module only owns "did the
 * HTTP call and JSON parsing succeed" — never "is the content safe or
 * grounded". A hallucinated product id returned by Gemini is caught by
 * `intent-extraction.ts` / `recommendation-service.ts` /
 * `growth-proposal-validation.ts` exactly as it would be from any provider.
 *
 * Two deliberate differences from the Anthropic path:
 *
 *  - The API key is sent as an `x-goog-api-key` HEADER, never as the
 *    `?key=` query parameter the API also accepts. Keys in URLs leak into
 *    access logs, proxy logs and browser history.
 *  - `responseMimeType: "application/json"` asks Gemini for native
 *    structured output, which is stronger than instructing a model to
 *    emit JSON and stripping markdown fences afterwards. The fence-strip
 *    fallback is still applied defensively.
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

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export interface GeminiProviderConfig {
  apiKey: string;
  model: string;
  timeoutMs: number;
}

interface GeminiResponseBody {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  promptFeedback?: { blockReason?: string };
}

async function callGemini(
  config: GeminiProviderConfig,
  system: string,
  userMessage: string,
  temperature: number,
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${GEMINI_API_BASE}/${encodeURIComponent(config.model)}:generateContent`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        // Header, never `?key=` — see the file header.
        "x-goog-api-key": config.apiKey,
      },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: userMessage }] }],
        generationConfig: {
          temperature,
          maxOutputTokens: 1024,
          responseMimeType: "application/json",
        },
      }),
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new AIProviderError("AI_TIMEOUT", `Gemini request exceeded ${config.timeoutMs}ms.`);
    }
    throw new AIProviderError("AI_PROVIDER_UNAVAILABLE", `Gemini request failed: ${(err as Error).message}`);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new AIProviderError("AI_PROVIDER_UNAVAILABLE", `Gemini API returned HTTP ${response.status}.`);
  }

  const body = (await response.json().catch(() => null)) as GeminiResponseBody | null;

  // A safety-filtered prompt returns 200 with no candidates. Surfacing it
  // as its own message matters: "blocked by the provider" is a different
  // operational problem from "the model returned malformed output".
  if (body?.promptFeedback?.blockReason) {
    throw new AIProviderError("AI_OUTPUT_INVALID", `Gemini blocked the request: ${body.promptFeedback.blockReason}.`);
  }

  // Gemini may split a reply across several parts; join them rather than
  // taking the first, which would silently truncate JSON.
  const text = body?.candidates?.[0]?.content?.parts
    ?.map((part) => part.text)
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .join("");

  if (!text) {
    throw new AIProviderError("AI_OUTPUT_INVALID", "Gemini response contained no text content.");
  }
  return text;
}

/** `responseMimeType: application/json` should make fences impossible, but
 * strip them defensively anyway — a provider-side change must degrade to a
 * clear parse error, never a crash. */
function extractJson(text: string): unknown {
  const stripped = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(stripped);
  } catch {
    throw new AIProviderError("AI_OUTPUT_INVALID", "Gemini response was not valid JSON.");
  }
}

export function createGeminiProvider(config: GeminiProviderConfig): AIProvider {
  return {
    mode: "LIVE_GEMINI",

    async extractIntent(params: ExtractIntentParams): Promise<RawIntentExtraction> {
      const userMessage = buildIntentExtractionUserMessage(params.message, params.knownCategories, params.knownAttributes);
      const text = await callGemini(config, INTENT_EXTRACTION_SYSTEM_PROMPT, userMessage, 0);
      const parsed = extractJson(text);
      if (typeof parsed !== "object" || parsed === null) {
        throw new AIProviderError("AI_OUTPUT_INVALID", "Gemini intent extraction did not return a JSON object.");
      }
      return parsed as RawIntentExtraction;
    },

    async rankCandidates(params: RankCandidatesParams): Promise<RawRankedItem[]> {
      const userMessage = buildRecommendationUserMessage(params.preferredAttributes, params.candidates);
      const text = await callGemini(config, RECOMMENDATION_SYSTEM_PROMPT, userMessage, 0.3);
      const parsed = extractJson(text);
      if (!Array.isArray(parsed)) {
        throw new AIProviderError("AI_OUTPUT_INVALID", "Gemini ranking did not return a JSON array.");
      }
      return parsed as RawRankedItem[];
    },

    async proposeGrowthAction(params: ProposeGrowthActionParams): Promise<RawGrowthProposal> {
      const userMessage = buildGrowthProposalUserMessage(params);
      const text = await callGemini(config, GROWTH_PROPOSAL_SYSTEM_PROMPT, userMessage, 0.3);
      const parsed = extractJson(text);
      if (typeof parsed !== "object" || parsed === null) {
        throw new AIProviderError("AI_OUTPUT_INVALID", "Gemini growth proposal did not return a JSON object.");
      }
      return parsed as RawGrowthProposal;
    },

    async proposeRecoveryAction(params: ProposeRecoveryActionParams): Promise<RawRecoveryProposal> {
      const userMessage = buildRecoveryProposalUserMessage(params);
      const text = await callGemini(config, RECOVERY_PROPOSAL_SYSTEM_PROMPT, userMessage, 0.2);
      const parsed = extractJson(text);
      if (typeof parsed !== "object" || parsed === null) {
        throw new AIProviderError("AI_OUTPUT_INVALID", "Gemini recovery proposal did not return a JSON object.");
      }
      return parsed as RawRecoveryProposal;
    },

    async normalizeCatalogRow(params: NormalizeCatalogRowParams): Promise<RawNormalizedProduct> {
      const userMessage = buildCatalogCompilerUserMessage(params.row, params.knownCategories);
      const text = await callGemini(config, CATALOG_COMPILER_SYSTEM_PROMPT, userMessage, 0.1);
      const parsed = extractJson(text);
      if (typeof parsed !== "object" || parsed === null) {
        throw new AIProviderError("AI_OUTPUT_INVALID", "Gemini catalogue normalisation did not return a JSON object.");
      }
      return parsed as RawNormalizedProduct;
    },

    async proposeAgentUpsell(params: ProposeAgentUpsellParams): Promise<RawAgentUpsell> {
      const userMessage = buildNegotiatorUserMessage(params);
      const text = await callGemini(config, NEGOTIATOR_SYSTEM_PROMPT, userMessage, 0.4);
      const parsed = extractJson(text);
      if (typeof parsed !== "object" || parsed === null) {
        throw new AIProviderError("AI_OUTPUT_INVALID", "Gemini negotiator did not return a JSON object.");
      }
      return parsed as RawAgentUpsell;
    },

    async compilePolicyFromInstruction(params: CompilePolicyParams): Promise<RawPolicyDraftResponse> {
      const userMessage = buildPolicyAuthorUserMessage(params);
      // Low temperature: this is a translation task with one right answer,
      // not a writing task.
      const text = await callGemini(config, POLICY_AUTHOR_SYSTEM_PROMPT, userMessage, 0.1);
      const parsed = extractJson(text);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new AIProviderError("AI_OUTPUT_INVALID", "Gemini policy author did not return a JSON object.");
      }
      return parsed as RawPolicyDraftResponse;
    },
  };
}
