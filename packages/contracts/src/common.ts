import { z } from "zod";
import { SUPPORTED_CURRENCIES } from "@razorgrowth/domain";

/** The currency allowlist, on its own — several DTOs carry a currency
 * without carrying a full Money value. */
export const currencySchema = z.enum(SUPPORTED_CURRENCIES);
export type CurrencyDTO = z.infer<typeof currencySchema>;

/** Wire representation of Money — mirrors `@razorgrowth/domain`'s `MoneyJSON`. */
export const moneySchema = z.object({
  amountMinor: z.number().int(),
  currency: currencySchema,
});
export type MoneyDTO = z.infer<typeof moneySchema>;

/** PART 00 §78 / PART 01 §78 — every revenue figure must carry this tag. */
export const valueClassificationSchema = z.enum(["OBSERVED", "ESTIMATED", "OPPORTUNITY"]);
export type ValueClassificationDTO = z.infer<typeof valueClassificationSchema>;

export const dataProvenanceSchema = z.enum(["MERCHANT_AUTHORED", "SYSTEM_DERIVED", "AI_GENERATED", "SYNTHETIC_DEMO"]);
export type DataProvenanceDTO = z.infer<typeof dataProvenanceSchema>;

/** Safe, consistent error envelope (PART 00 §27, §39; PART 01 §27). */
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string(),
  }),
});
export type ApiErrorDTO = z.infer<typeof apiErrorSchema>;

/** Bounded pagination contract (PART 01 §57) — server enforces the max. */
export const MAX_PAGE_LIMIT = 100;
export const DEFAULT_PAGE_LIMIT = 20;

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).default(DEFAULT_PAGE_LIMIT),
});
export type PaginationQueryDTO = z.infer<typeof paginationQuerySchema>;

export const paginationMetaSchema = z.object({
  page: z.number().int(),
  limit: z.number().int(),
  total: z.number().int(),
  totalPages: z.number().int(),
});
export type PaginationMetaDTO = z.infer<typeof paginationMetaSchema>;

export function paginatedSchema<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.object({
    items: z.array(itemSchema),
    pagination: paginationMetaSchema,
  });
}

/**
 * How two products relate, and who says so.
 *
 * Shared rather than owned by either consumer. These were declared in
 * `merchant-agent.ts` for the agent's candidate set, and the AI-readable
 * catalogue needed the same vocabulary to expose relationships to outside
 * buyers. Two enums with the same members and no shared definition is the
 * arrangement that eventually disagrees.
 *
 * `provenance` is what makes "never invent product facts" checkable:
 * MERCHANT_CONFIGURED means a person asserted the pairing, SYSTEM_DERIVED
 * means something inferred it, DEMO_SEED means it is fixture data. A
 * consumer that cannot tell those apart treats a guess as a fact.
 */
export const productRelationshipTypeSchema = z.enum([
  "COMPLEMENTARY",
  "UPSELL_ALTERNATIVE",
  "SIMILAR",
  "BUNDLE_COMPATIBLE",
]);
export type ProductRelationshipTypeDTO = z.infer<typeof productRelationshipTypeSchema>;

export const relationshipProvenanceSchema = z.enum([
  "MERCHANT_CONFIGURED",
  "CATALOG_METADATA",
  "SYSTEM_DERIVED",
  "DEMO_SEED",
]);
export type RelationshipProvenanceDTO = z.infer<typeof relationshipProvenanceSchema>;
