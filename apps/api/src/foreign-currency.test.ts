/**
 * A budget stated in a currency this merchant does not transact in must be
 * DROPPED, never reinterpreted.
 *
 * "Under $50" previously produced budgetMaxMinor 5000 — ₹50 — because the
 * amount survived while the currency was discarded. That silently filters
 * the catalogue on a number the buyer never said. There is no rate to
 * convert with, and inventing one would put a fabricated figure into a
 * financial constraint.
 */
import { describe, it, expect } from "vitest";
import { extractAndNormalizeIntent } from "./modules/buyer-agent/intent-extraction.js";
import type { AIProvider } from "./modules/agents/ai-provider.js";

function providerReturning(raw: Record<string, unknown>): AIProvider {
  return {
    mode: "DEMO_RULE_BASED",
    extractIntent: async () => raw,
    rankCandidates: async () => [],
    proposeGrowthAction: async () => ({}) as never,
    proposeRecoveryAction: async () => ({}) as never,
    normalizeCatalogRow: async () => ({}) as never,
    proposeAgentUpsell: async () => ({}) as never,
  } as unknown as AIProvider;
}

const CATEGORIES = ["Running Shoes"];

describe("foreign-currency budgets", () => {
  it("drops the budget when the message names a foreign currency symbol", async () => {
    const provider = providerReturning({ category: null, budgetMaxMajor: 50, currency: null, confidence: 0.9 });
    const outcome = await extractAndNormalizeIntent(provider, "Under $50", CATEGORIES);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.signal.budgetMaxMinor).toBeNull();
  });

  it("drops the budget when the model reports an unsupported currency code", async () => {
    const provider = providerReturning({ category: null, budgetMaxMajor: 50, currency: "USD", confidence: 0.9 });
    const outcome = await extractAndNormalizeIntent(provider, "Under 50 dollars", CATEGORIES);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.signal.budgetMaxMinor).toBeNull();
  });

  it("keeps a budget stated with no currency at all", async () => {
    const provider = providerReturning({ category: null, budgetMaxMajor: 4500, currency: null, confidence: 0.9 });
    const outcome = await extractAndNormalizeIntent(provider, "Running shoes under 4500", CATEGORIES);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.signal.budgetMaxMinor).toBe(450000);
  });

  it("keeps a budget explicitly stated in the merchant's own currency", async () => {
    const provider = providerReturning({ category: null, budgetMaxMajor: 4500, currency: "INR", confidence: 0.9 });
    const outcome = await extractAndNormalizeIntent(provider, "Running shoes under ₹4,500", CATEGORIES);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.signal.budgetMaxMinor).toBe(450000);
  });
});
