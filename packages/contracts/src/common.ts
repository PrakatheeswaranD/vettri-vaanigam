import { z } from "zod";
import { SUPPORTED_CURRENCIES } from "@razorgrowth/domain";

/** Wire representation of Money — mirrors `@razorgrowth/domain`'s `MoneyJSON`. */
export const moneySchema = z.object({
  amountMinor: z.number().int(),
  currency: z.enum(SUPPORTED_CURRENCIES),
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
