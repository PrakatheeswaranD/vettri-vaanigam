/**
 * Intent Extraction evaluation suite (PART 03 §87-§92, §138-§139).
 *
 * Loads the held-out dataset at evals/buyer-intent/cases.json and runs the
 * extraction pipeline exactly as production does (raw provider call →
 * schema validation → deterministic normalization), then compares
 * semantic fields against each case's expectation.
 *
 * This is a CONTRACT/regression eval by default — it exercises whichever
 * `AIProvider` this environment would actually select in production (the
 * deterministic demo provider unless `AI_PROVIDER_API_KEY` is set). It
 * never fabricates a "live model" result: the report header states
 * explicitly which provider mode produced these numbers, and if no API
 * key is configured, live evaluation is honestly reported as not executed
 * rather than silently substituted with contract results.
 *
 * Run with: `pnpm eval:intent` (from repo root) or `pnpm --filter
 * @razorgrowth/api run eval:intent`.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { needsClarification, mergeIntentSignal } from "@razorgrowth/domain";
import { extractAndNormalizeIntent } from "../src/modules/buyer-agent/intent-extraction.js";
import { getAIProvider } from "../src/modules/agents/provider-factory.js";
import { EVAL_REQUEST_INTERVAL_MS, throttle } from "./eval-throttle.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CASES_PATH = path.resolve(__dirname, "../../../evals/buyer-intent/cases.json");

interface ExpectedFields {
  category?: string | null;
  budgetMinMinor?: number | null;
  budgetMaxMinor?: number | null;
  requiredAttributes?: Record<string, string>;
  preferredAttributes?: Record<string, string>;
  excludedAttributes?: Record<string, string[]>;
  quantity?: number;
  availabilityRequirement?: "PURCHASABLE_ONLY" | "INCLUDE_UNAVAILABLE";
  clarificationExpected?: boolean;
}

interface EvalCase {
  id: string;
  message: string;
  expected: ExpectedFields;
}

interface Dataset {
  datasetVersion: string;
  knownCategories: string[];
  /** The merchant's real variant-attribute keys and value formats. Held in
   * the dataset rather than read from the database so the suite stays
   * hermetic and reproducible, exactly like knownCategories. */
  knownAttributes?: Record<string, string[]>;
  cases: EvalCase[];
}

function recordEquals(actual: Record<string, string>, expected: Record<string, string> | undefined): boolean {
  if (!expected) return true;
  const actualLower = Object.fromEntries(Object.entries(actual).map(([k, v]) => [k.toLowerCase(), v.toLowerCase()]));
  return Object.entries(expected).every(([k, v]) => actualLower[k.toLowerCase()] === v.toLowerCase());
}

function exclusionEquals(actual: Record<string, string[]>, expected: Record<string, string[]> | undefined): boolean {
  if (!expected) return true;
  return Object.entries(expected).every(([k, values]) => {
    const actualValues = (actual[k] ?? []).map((v) => v.toLowerCase());
    return values.every((v) => actualValues.includes(v.toLowerCase()));
  });
}

async function main() {
  const dataset = JSON.parse(await readFile(CASES_PATH, "utf-8")) as Dataset;
  const provider = getAIProvider();

  let categoryChecked = 0;
  let categoryCorrect = 0;
  let budgetChecked = 0;
  let budgetCorrect = 0;
  let attributeChecked = 0;
  let attributeCorrect = 0;
  let clarificationChecked = 0;
  let clarificationCorrect = 0;
  let overallExactMatches = 0;

  const failures: string[] = [];
  console.log(
    provider.mode === "DEMO_RULE_BASED"
      ? ""
      : `Throttling to ${(60_000 / EVAL_REQUEST_INTERVAL_MS).toFixed(0)} req/min so provider rate limits are not scored as model failures.\n`,
  );

  for (const testCase of dataset.cases) {
    await throttle(provider.mode);
    const outcome = await extractAndNormalizeIntent(provider, testCase.message, dataset.knownCategories, dataset.knownAttributes ?? {});
    if (!outcome.ok) {
      failures.push(`${testCase.id}: extraction failed outright (${outcome.errorCode})`);
      continue;
    }

    const merged = mergeIntentSignal(null, outcome.result.signal);
    const exp = testCase.expected;
    let caseOk = true;

    if (exp.category !== undefined) {
      categoryChecked++;
      const match = merged.category === exp.category;
      if (match) categoryCorrect++;
      else {
        caseOk = false;
        failures.push(`${testCase.id}: category expected ${JSON.stringify(exp.category)}, got ${JSON.stringify(merged.category)}`);
      }
    }

    if (exp.budgetMaxMinor !== undefined || exp.budgetMinMinor !== undefined) {
      budgetChecked++;
      const maxOk = exp.budgetMaxMinor === undefined || merged.budget.maxMinor === exp.budgetMaxMinor;
      const minOk = exp.budgetMinMinor === undefined || merged.budget.minMinor === exp.budgetMinMinor;
      if (maxOk && minOk) budgetCorrect++;
      else {
        caseOk = false;
        failures.push(
          `${testCase.id}: budget expected max=${exp.budgetMaxMinor ?? "n/a"} min=${exp.budgetMinMinor ?? "n/a"}, got max=${merged.budget.maxMinor} min=${merged.budget.minMinor}`,
        );
      }
    }

    if (exp.requiredAttributes || exp.preferredAttributes || exp.excludedAttributes) {
      attributeChecked++;
      const ok =
        recordEquals(merged.requiredAttributes, exp.requiredAttributes) &&
        recordEquals(merged.preferredAttributes, exp.preferredAttributes) &&
        exclusionEquals(merged.excludedAttributes, exp.excludedAttributes);
      if (ok) attributeCorrect++;
      else {
        caseOk = false;
        failures.push(
          `${testCase.id}: attributes mismatch — required=${JSON.stringify(merged.requiredAttributes)}, preferred=${JSON.stringify(merged.preferredAttributes)}, excluded=${JSON.stringify(merged.excludedAttributes)}`,
        );
      }
    }

    if (exp.clarificationExpected !== undefined) {
      clarificationChecked++;
      const actual = needsClarification(merged);
      if (actual === exp.clarificationExpected) clarificationCorrect++;
      else {
        caseOk = false;
        failures.push(`${testCase.id}: clarification expected ${exp.clarificationExpected}, got ${actual}`);
      }
    }

    if (caseOk) overallExactMatches++;
  }

  const pct = (num: number, denom: number) => (denom === 0 ? "n/a" : `${((num / denom) * 100).toFixed(1)}%`);

  console.log("=== Intent Extraction Evaluation ===");
  console.log(`Dataset version: ${dataset.datasetVersion} | Cases: ${dataset.cases.length}`);
  console.log(`Provider mode: ${provider.mode}${provider.mode === "DEMO_RULE_BASED" ? " (CONTRACT eval — deterministic rule-based extractor, not a live model)" : ` (LIVE evaluation — real ${provider.mode === "LIVE_GEMINI" ? "Gemini" : "Anthropic"} model)`}`);
  console.log("");
  console.log(`Category accuracy:            ${pct(categoryCorrect, categoryChecked)} (${categoryCorrect}/${categoryChecked})`);
  console.log(`Budget accuracy:               ${pct(budgetCorrect, budgetChecked)} (${budgetCorrect}/${budgetChecked})`);
  console.log(`Attribute accuracy:            ${pct(attributeCorrect, attributeChecked)} (${attributeCorrect}/${attributeChecked})`);
  console.log(`Clarification decision acc.:   ${pct(clarificationCorrect, clarificationChecked)} (${clarificationCorrect}/${clarificationChecked})`);
  console.log(`Overall exact semantic match:  ${pct(overallExactMatches, dataset.cases.length)} (${overallExactMatches}/${dataset.cases.length})`);

  if (failures.length > 0) {
    console.log("\n--- Failures ---");
    for (const f of failures) console.log(`  ✗ ${f}`);
  }

  if (provider.mode === "DEMO_RULE_BASED") {
    console.log("\nLIVE MODEL EVALUATION NOT EXECUTED — AI_PROVIDER_API_KEY is not configured in this environment.");
    console.log("Set a live provider (AI_PROVIDER=gemini with GEMINI_API_KEY, or AI_PROVIDER=anthropic with AI_PROVIDER_API_KEY) and rerun to evaluate the real model-backed extractor.");
  }
}

main()
  .catch((err) => {
    console.error("Eval run failed:", err);
    process.exitCode = 1;
  });
