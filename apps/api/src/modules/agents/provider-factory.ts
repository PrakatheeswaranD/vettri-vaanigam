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
import { createDemoRuleBasedProvider } from "./providers/demo-rule-based-provider.js";

let cachedProvider: AIProvider | null = null;

export function getAIProvider(): AIProvider {
  if (cachedProvider) return cachedProvider;

  if (env.AI_PROVIDER_API_KEY) {
    logger.info({ event: "ai_provider.selected", mode: "LIVE_ANTHROPIC", model: env.AI_PROVIDER_MODEL }, "Using live Anthropic provider for AI agents");
    cachedProvider = createAnthropicProvider({
      apiKey: env.AI_PROVIDER_API_KEY,
      model: env.AI_PROVIDER_MODEL,
      timeoutMs: env.AI_PROVIDER_TIMEOUT_MS,
    });
  } else {
    logger.info({ event: "ai_provider.selected", mode: "DEMO_RULE_BASED" }, "Using deterministic demo provider for AI agents (no AI_PROVIDER_API_KEY configured)");
    cachedProvider = createDemoRuleBasedProvider();
  }
  return cachedProvider;
}
