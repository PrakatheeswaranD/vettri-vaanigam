/**
 * Intent extraction pipeline (PART 03 §23-§26, §41, §162).
 *
 * LLM structured output → runtime schema validation → deterministic
 * normalization → `PartialIntentSignal` for `mergeIntentSignal`. Nothing
 * downstream ever sees raw, unvalidated model output.
 */
import { z } from "zod";
import { normalizeBudgetAmount, type PartialIntentSignal } from "@razorgrowth/domain";
import type { CurrencyCode } from "@razorgrowth/domain";
import { AIProviderError, type AIProvider } from "../agents/ai-provider.js";
import { logger } from "../../observability/logger.js";

const MAX_AI_RETRIES = 1;
const MAX_ATTRIBUTE_ENTRIES = 10;
const MAX_ATTRIBUTE_STRING_LENGTH = 60;

/** What the provider is REQUIRED to structurally return before we'll even
 * attempt to normalize it (PART 03 §24) — deliberately permissive on
 * content (any string category, any attribute keys) since normalization,
 * not this schema, is what decides whether the content is usable. */
const rawIntentSchema = z.object({
  category: z.string().max(100).nullable().optional(),
  budgetMinMajor: z.number().finite().nullable().optional(),
  budgetMaxMajor: z.number().finite().nullable().optional(),
  currency: z.string().max(10).nullable().optional(),
  quantity: z.number().finite().nullable().optional(),
  requiredAttributes: z.record(z.string().max(40), z.string().max(MAX_ATTRIBUTE_STRING_LENGTH)).optional(),
  preferredAttributes: z.record(z.string().max(40), z.string().max(MAX_ATTRIBUTE_STRING_LENGTH)).optional(),
  excludedAttributes: z.record(z.string().max(40), z.array(z.string().max(MAX_ATTRIBUTE_STRING_LENGTH))).optional(),
  availabilityRequirement: z.enum(["PURCHASABLE_ONLY", "INCLUDE_UNAVAILABLE"]).nullable().optional(),
  confidence: z.number().min(0).max(1).optional(),
});

function boundAttributeMap(map: Record<string, string> | undefined): Record<string, string> {
  if (!map) return {};
  return Object.fromEntries(Object.entries(map).slice(0, MAX_ATTRIBUTE_ENTRIES));
}

function boundExclusionMap(map: Record<string, string[]> | undefined): Record<string, string[]> {
  if (!map) return {};
  return Object.fromEntries(Object.entries(map).slice(0, MAX_ATTRIBUTE_ENTRIES));
}

const SUPPORTED_CURRENCY_CODES = ["INR", "USD"] as const;
function normalizeCurrency(raw: string | null | undefined): CurrencyCode | null {
  if (!raw) return null;
  const upper = raw.trim().toUpperCase();
  return (SUPPORTED_CURRENCY_CODES as readonly string[]).includes(upper) ? (upper as CurrencyCode) : null;
}

/**
 * True when the buyer named a currency that is not the one this merchant
 * prices in.
 *
 * Note this is a stricter test than `normalizeCurrency` returning null.
 * `SUPPORTED_CURRENCY_CODES` says which codes we can PARSE; it does not
 * say which currency the catalogue is priced in. USD parses cleanly and is
 * still not comparable to an INR price list without a rate.
 *
 * Naming no currency at all is different again: "under 4500" is safely
 * read in the merchant's own currency. The danger is only when a
 * DIFFERENT currency is named — the amount would otherwise survive while
 * the currency is discarded, so "$50" silently becomes ₹50 and filters the
 * catalogue on a number the buyer never said. Dropping the budget is the
 * only honest option: there is no rate to convert with, and inventing one
 * would put a fabricated figure into a financial constraint.
 */
function statedANonMerchantCurrency(raw: string | null | undefined, merchantCurrency: string): boolean {
  if (!raw) return false;
  return raw.trim().toUpperCase() !== merchantCurrency.toUpperCase();
}

/** Currency markers that are unambiguously NOT this merchant's. Checked
 * against the buyer's raw message rather than the model's `currency`
 * field, because the model frequently reads "Under $50" as a bare amount
 * and reports no currency at all — leaving nothing for
 * `statedANonMerchantCurrency` to catch. Financial truth is deterministic
 * code's job, so the guard does not depend on the model noticing. */
const FOREIGN_CURRENCY_PATTERN = /[$€£¥]|\b(usd|eur|gbp|jpy|aud|cad|chf|cny|sgd|aed)\b/i;

function messageNamesForeignCurrency(message: string): boolean {
  return FOREIGN_CURRENCY_PATTERN.test(message);
}

/**
 * Match the extractor's free-text category guess against what the
 * merchant ACTUALLY sells (PART 03 §25, §30). No fuzzy guessing beyond
 * case-insensitive exact/substring/singular match — an unresolved guess is
 * passed through as-is rather than silently dropped, so an unrecognized
 * category still filters honestly to zero results instead of the buyer
 * being shown an unrelated category's products (never silently broaden a
 * hard constraint).
 */
export function normalizeCategory(raw: string | null | undefined, knownCategories: string[]): string | null {
  if (!raw || raw.trim().length === 0) return null;
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();
  const exact = knownCategories.find((c) => c.toLowerCase() === lower);
  if (exact) return exact;
  const contains = knownCategories.find((c) => c.toLowerCase().includes(lower) || lower.includes(c.toLowerCase()));
  if (contains) return contains;
  const singular = lower.replace(/s$/, "");
  const stemMatch = knownCategories.find((c) => c.toLowerCase().replace(/s$/, "") === singular);
  return stemMatch ?? trimmed;
}

export interface ExtractAndNormalizeResult {
  signal: PartialIntentSignal;
  confidence: number | null;
  aiProviderMode: AIProvider["mode"];
  usedFallback: boolean;
}

export type IntentExtractionOutcome =
  | { ok: true; result: ExtractAndNormalizeResult }
  | { ok: false; errorCode: "AI_PROVIDER_UNAVAILABLE" | "AI_TIMEOUT" | "AI_OUTPUT_INVALID" };

/**
 * Extract + validate + normalize one buyer message. Retries the raw
 * provider call up to `MAX_AI_RETRIES` times on failure (PART 03 §41) —
 * never retries indefinitely, and never guesses a fabricated intent when
 * every attempt fails (PART 03 §162: "prefer uncertainty over fabricated
 * intent").
 */
export async function extractAndNormalizeIntent(
  provider: AIProvider,
  message: string,
  knownCategories: string[],
  knownAttributes: Record<string, string[]> = {},
  /** The currency this merchant prices in. A budget named in any other
   * currency is dropped rather than compared against it. */
  merchantCurrency: string = "INR",
): Promise<IntentExtractionOutcome> {
  let lastErrorCode: "AI_PROVIDER_UNAVAILABLE" | "AI_TIMEOUT" | "AI_OUTPUT_INVALID" = "AI_OUTPUT_INVALID";

  for (let attempt = 0; attempt <= MAX_AI_RETRIES; attempt++) {
    try {
      const raw = await provider.extractIntent({ message, knownCategories, knownAttributes });
      const parsed = rawIntentSchema.safeParse(raw);
      if (!parsed.success) {
        lastErrorCode = "AI_OUTPUT_INVALID";
        logger.warn({ event: "buyer_agent.intent_validation_failed", attempt, issues: parsed.error.issues.length }, "Raw intent extraction failed schema validation");
        continue;
      }

      const data = parsed.data;
      const currency = normalizeCurrency(data.currency);
      const foreignCurrency = statedANonMerchantCurrency(data.currency, merchantCurrency) || messageNamesForeignCurrency(message);
      if (foreignCurrency) {
        logger.warn(
          { event: "buyer_agent.foreign_currency_budget_dropped", stated: data.currency, merchantCurrency },
          "Buyer stated a currency this merchant does not transact in; budget dropped rather than reinterpreted",
        );
      }
      const signal: PartialIntentSignal = {
        category: normalizeCategory(data.category, knownCategories),
        budgetMinMinor: foreignCurrency ? null : normalizeBudgetAmount(data.budgetMinMajor),
        budgetMaxMinor: foreignCurrency ? null : normalizeBudgetAmount(data.budgetMaxMajor),
        currency,
        quantity: data.quantity && Number.isInteger(data.quantity) && data.quantity > 0 ? data.quantity : null,
        requiredAttributes: boundAttributeMap(data.requiredAttributes),
        preferredAttributes: boundAttributeMap(data.preferredAttributes),
        excludedAttributes: boundExclusionMap(data.excludedAttributes),
        availabilityRequirement: data.availabilityRequirement ?? null,
      };

      return {
        ok: true,
        result: {
          signal,
          confidence: data.confidence ?? null,
          aiProviderMode: provider.mode,
          usedFallback: attempt > 0,
        },
      };
    } catch (err) {
      lastErrorCode = err instanceof AIProviderError ? err.code : "AI_PROVIDER_UNAVAILABLE";
      logger.warn({ event: "buyer_agent.intent_extraction_failed", attempt, errorCode: lastErrorCode }, "Intent extraction attempt failed");
    }
  }

  return { ok: false, errorCode: lastErrorCode };
}
