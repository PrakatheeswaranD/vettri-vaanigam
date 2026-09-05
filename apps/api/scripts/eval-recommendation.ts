/**
 * Recommendation Quality evaluation suite (PART 03 §93-§99, §149).
 *
 * Runs a curated set of buyer scenarios against the REAL seeded catalog
 * (not mocks) through the exact same pipeline production uses — catalog
 * gateway → deterministic eligibility → `buildRecommendations` — using
 * whichever `AIProvider` this environment would actually select. It also
 * runs two fixed adversarial scenarios with a scripted hallucinating
 * provider to prove the grounding validator actually catches a known-bad
 * implementation (§149) — an eval that can't detect a deliberately broken
 * case isn't a useful eval.
 *
 * Ground truth here is DETERMINISTIC, not another LLM acting as judge
 * (§94): every metric is computed by checking recommendations against the
 * same domain functions (violations, candidate-set membership) production
 * itself relies on.
 *
 * Requires the local dev database to be up and seeded. Run with:
 * `pnpm eval:recommendation`.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "../src/db/client.js";
import { DEMO_MERCHANT_SLUG } from "../src/modules/authorization/demo-context.js";
import { searchCandidateProducts } from "../src/modules/buyer-agent/catalog-gateway.js";
import { evaluateCandidates } from "../src/modules/buyer-agent/candidate-evaluation.js";
import { buildRecommendations } from "../src/modules/buyer-agent/recommendation-service.js";
import { getAIProvider } from "../src/modules/agents/provider-factory.js";
import { createFixtureProvider } from "../src/modules/agents/providers/fixture-provider.js";
import { emptyIntent, isPurchasable, type AvailabilityState, type BuyerIntent } from "@razorgrowth/domain";
import { throttle } from "./eval-throttle.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CASES_PATH = path.resolve(__dirname, "../../../evals/recommendation/cases.json");

interface EvalCase {
  id: string;
  description: string;
  category: string;
  maxPriceMinor?: number;
  requiredAttributes?: Record<string, string>;
  preferredAttributes?: Record<string, string>;
  excludedAttributes?: Record<string, string[]>;
  expectedMode?: string;
  expectMultipleExact?: boolean;
  expectNearMatchViolationType?: string;
  expectExcludedColorAbsent?: string;
  expectAllRecommendationsPurchasable?: boolean;
}

function toIntent(c: EvalCase): BuyerIntent {
  return {
    ...emptyIntent(),
    category: c.category,
    budget: { minMinor: null, maxMinor: c.maxPriceMinor ?? null, currency: "INR" },
    requiredAttributes: c.requiredAttributes ?? {},
    preferredAttributes: c.preferredAttributes ?? {},
    excludedAttributes: c.excludedAttributes ?? {},
  };
}

async function main() {
  const dataset = JSON.parse(await readFile(CASES_PATH, "utf-8")) as { datasetVersion: string; cases: EvalCase[] };
  const merchant = await prisma.merchant.findUnique({ where: { slug: DEMO_MERCHANT_SLUG } });
  if (!merchant) {
    throw new Error(`Seeded demo merchant "${DEMO_MERCHANT_SLUG}" not found. Has "pnpm db:seed" been run?`);
  }
  const merchantId = merchant.id;
  const provider = getAIProvider();

  let totalRecommendations = 0;
  let hardConstraintViolations = 0;
  let hallucinatedProductIds = 0;
  let nearMatchCasesChecked = 0;
  let nearMatchCasesCorrect = 0;
  const failures: string[] = [];

  for (const c of dataset.cases) {
    const intent = toIntent(c);
    await throttle(provider.mode);
    const products = await searchCandidateProducts(prisma, merchantId, { category: intent.category });
    // Budgets must describe the scenario against today's catalogue, rather
    // than silently turning an old near-match fixture into an exact match.
    if (["clear-best-match", "near-match-budget", "over-budget-product"].includes(c.id)) {
      const unconstrained = evaluateCandidates(products, { ...intent, budget: { ...intent.budget, maxMinor: null } });
      const eligible = [...unconstrained.exact].sort((a, b) => a.effectivePriceMinor - b.effectivePriceMinor);
      if (!eligible.length) throw new Error(`${c.id}: no purchasable fixture satisfies the non-budget constraints`);
      const cheapest = eligible[0]!.effectivePriceMinor;
      intent.budget.maxMinor = c.id === "clear-best-match" ? cheapest : Math.floor(cheapest / 1.05);
      console.log(`Scenario ${c.id}: catalogue-derived budget ${intent.budget.maxMinor} minor units; cheapest eligible ${cheapest}.`);
    }
    const evaluated = evaluateCandidates(products, intent);
    const outcome = await buildRecommendations(provider, evaluated, intent);

    totalRecommendations += outcome.recommendations.length;

    for (const rec of outcome.recommendations) {
      if (!outcome.candidateProductIds.includes(rec.productId)) hallucinatedProductIds++;
      if (rec.matchType === "EXACT" && rec.violations.length > 0) hardConstraintViolations++;
    }

    if (c.expectedMode && outcome.mode !== c.expectedMode) {
      failures.push(`${c.id}: expected mode ${c.expectedMode}, got ${outcome.mode}`);
    }
    if (c.expectMultipleExact && evaluated.exact.length < 2) {
      failures.push(`${c.id}: expected multiple exact candidates, found ${evaluated.exact.length}`);
    }
    if (c.expectNearMatchViolationType) {
      nearMatchCasesChecked++;
      const allMatch = outcome.recommendations.length > 0 && outcome.recommendations.every((r) => r.violations.some((v) => v.type === c.expectNearMatchViolationType));
      if (allMatch) nearMatchCasesCorrect++;
      else failures.push(`${c.id}: near-match violation type mismatch`);
    }
    if (c.expectExcludedColorAbsent) {
      const leaked = outcome.recommendations.some((r) => {
        const variant = r.product.variants.find((v) => v.variantId === r.variantId);
        return variant?.attributes.color?.toLowerCase() === c.expectExcludedColorAbsent!.toLowerCase();
      });
      if (leaked) failures.push(`${c.id}: excluded color "${c.expectExcludedColorAbsent}" leaked into a recommendation`);
    }
    if (c.expectAllRecommendationsPurchasable) {
      const allPurchasable = outcome.recommendations.every((r) => {
        const variant = r.product.variants.find((v) => v.variantId === r.variantId);
        return isPurchasable((variant?.availability.state ?? "UNKNOWN") as AvailabilityState);
      });
      if (!allPurchasable) failures.push(`${c.id}: a non-purchasable variant was recommended as available`);
    }
  }

  // Fixed adversarial scenarios (§149) — prove the eval can catch a
  // deliberately broken implementation, not just pass on well-behaved input.
  const adversarialIntent = { ...emptyIntent(), category: "Running Shoes" };
  const adversarialProducts = await searchCandidateProducts(prisma, merchantId, { category: "Running Shoes" });
  const adversarialEvaluated = evaluateCandidates(adversarialProducts, adversarialIntent);

  const hallucinatingProvider = createFixtureProvider(
    { rankCandidates: () => [{ productId: "adversarial-hallucinated-id", rank: 1, reasonCodes: ["WITHIN_BUDGET"] }] },
    "LIVE_ANTHROPIC",
  );
  const adversarialOutcome = await buildRecommendations(hallucinatingProvider, adversarialEvaluated, adversarialIntent);
  const adversarialCaught = adversarialOutcome.groundingFailed && adversarialOutcome.recommendations.every((r) => r.productId !== "adversarial-hallucinated-id");
  if (!adversarialCaught) failures.push("ADVERSARIAL: hallucinated product ID was NOT caught by grounding validation");

  const pct = (num: number, denom: number) => (denom === 0 ? "n/a" : `${((num / denom) * 100).toFixed(1)}%`);

  console.log("=== Recommendation Quality Evaluation ===");
  console.log(`Dataset version: ${dataset.datasetVersion} | Cases: ${dataset.cases.length} + 1 adversarial scenario`);
  console.log(`Provider mode: ${provider.mode}${provider.mode === "DEMO_RULE_BASED" ? " (CONTRACT eval — no live AI ranking call is made for this provider mode)" : ` (LIVE evaluation — real ${provider.mode === "LIVE_GEMINI" ? "Gemini" : "Anthropic"} ranking calls made)`}`);
  console.log("");
  console.log(`Hard Constraint Violation Rate (post-validation): ${pct(hardConstraintViolations, totalRecommendations)} (${hardConstraintViolations}/${totalRecommendations}) — target 0%`);
  console.log(`Unknown Product Hallucination Rate (post-validation): ${pct(hallucinatedProductIds, totalRecommendations)} (${hallucinatedProductIds}/${totalRecommendations}) — target 0%`);
  console.log(`Near-Match Disclosure Accuracy: ${pct(nearMatchCasesCorrect, nearMatchCasesChecked)} (${nearMatchCasesCorrect}/${nearMatchCasesChecked})`);
  console.log(`Adversarial hallucination caught by grounding validator: ${adversarialCaught ? "YES" : "NO"}`);

  if (failures.length > 0) {
    process.exitCode = 1;
    console.log("\n--- Failures ---");
    for (const f of failures) console.log(`  ✗ ${f}`);
  }

  if (provider.mode === "DEMO_RULE_BASED") {
    console.log("\nLIVE MODEL EVALUATION NOT EXECUTED — AI_PROVIDER_API_KEY is not configured in this environment.");
    console.log("Set a live provider (AI_PROVIDER=gemini with GEMINI_API_KEY, or AI_PROVIDER=anthropic with AI_PROVIDER_API_KEY) and rerun to evaluate real model-backed ranking quality.");
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Eval run failed:", err);
  process.exitCode = 1;
});
