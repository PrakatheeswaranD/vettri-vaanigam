/**
 * AIProvider selection, shared by the Buyer Agent and the Merchant Agent
 * (PART 03 §9, §130, §155; PART 04 §52).
 *
 * Chosen ONCE at startup from environment configuration, not per-request —
 * simple, predictable, and easy to reason about under judging questions.
 * When `AI_PROVIDER_API_KEY` is absent (the default), both agents still
 * fully function via the deterministic demo provider (PART 03 §10) rather
 * than the merchant dashboard degrading or crashing (§9).
 */
import { env } from "../../config/env.js";
import { logger } from "../../observability/logger.js";
import type { AIProvider } from "./ai-provider.js";
import { createAnthropicProvider } from "./providers/anthropic-provider.js";
import { createGeminiProvider } from "./providers/gemini-provider.js";
import { createDemoRuleBasedProvider } from "./providers/demo-rule-based-provider.js";

let cachedProvider: AIProvider | null = null;

function buildAnthropic(): AIProvider {
  logger.info(
    { event: "ai_provider.selected", mode: "LIVE_ANTHROPIC", model: env.AI_PROVIDER_MODEL },
    "Using live Anthropic provider for AI agents",
  );
  return createAnthropicProvider({
    apiKey: env.AI_PROVIDER_API_KEY!,
    model: env.AI_PROVIDER_MODEL,
    timeoutMs: env.AI_PROVIDER_TIMEOUT_MS,
  });
}

function buildGemini(): AIProvider {
  logger.info(
    { event: "ai_provider.selected", mode: "LIVE_GEMINI", model: env.GEMINI_MODEL },
    "Using live Gemini provider for AI agents",
  );
  return createGeminiProvider({
    apiKey: env.GEMINI_API_KEY!,
    model: env.GEMINI_MODEL,
    timeoutMs: env.AI_PROVIDER_TIMEOUT_MS,
  });
}

function buildDemo(reason: string): AIProvider {
  logger.info({ event: "ai_provider.selected", mode: "DEMO_RULE_BASED", reason }, `Using deterministic demo provider for AI agents (${reason})`);
  return createDemoRuleBasedProvider();
}

/**
 * Chosen ONCE at startup, never per request.
 *
 * `AI_PROVIDER` is explicit by default-of-intent: naming a provider that
 * has no key is treated as a configuration ERROR rather than silently
 * falling back to the demo extractor. Silently degrading would be worse
 * than failing here — the app would look like it was running a live model
 * while actually running rule-based code, which is precisely the kind of
 * claim this project refuses to make elsewhere.
 *
 * `auto` (the default) preserves the original behaviour for anyone who
 * has not set `AI_PROVIDER`: use whichever single key is present,
 * preferring Gemini, and fall back to the demo extractor when neither is.
 */
export function getAIProvider(): AIProvider {
  if (cachedProvider) return cachedProvider;

  // Tests ALWAYS use the deterministic extractor, regardless of what
  // `.env` says — the same rule `gateway-factory.ts` applies to payments.
  // A test suite whose assertions depend on a live model is not a test
  // suite: it needs network, costs money per run, and can fail because a
  // model phrased something differently today. Tests that specifically
  // need model-shaped output construct a `FixtureProvider` directly.
  if (env.NODE_ENV === "test") {
    cachedProvider = createDemoRuleBasedProvider();
    return cachedProvider;
  }

  switch (env.AI_PROVIDER) {
    case "anthropic":
      if (!env.AI_PROVIDER_API_KEY) {
        throw new Error('AI_PROVIDER="anthropic" but AI_PROVIDER_API_KEY is not set. Set the key, or use AI_PROVIDER="demo".');
      }
      cachedProvider = buildAnthropic();
      break;

    case "gemini":
      if (!env.GEMINI_API_KEY) {
        throw new Error('AI_PROVIDER="gemini" but GEMINI_API_KEY is not set. Set the key, or use AI_PROVIDER="demo".');
      }
      cachedProvider = buildGemini();
      break;

    case "demo":
      cachedProvider = buildDemo("AI_PROVIDER=demo — deterministic extractor forced by configuration");
      break;

    case "auto":
    default:
      if (env.GEMINI_API_KEY) cachedProvider = buildGemini();
      else if (env.AI_PROVIDER_API_KEY) cachedProvider = buildAnthropic();
      else cachedProvider = buildDemo("no GEMINI_API_KEY or AI_PROVIDER_API_KEY configured");
      break;
  }

  return cachedProvider;
}
