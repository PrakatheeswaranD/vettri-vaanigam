import { z } from "zod";

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.literal("razorgrowth-api"),
});
export type HealthResponseDTO = z.infer<typeof healthResponseSchema>;

export const systemReadinessResponseSchema = z.object({
  status: z.enum(["ready", "degraded"]),
  checks: z.object({
    api: z.literal("ok"),
    database: z.enum(["ok", "unreachable"]),
  }),
});
export type SystemReadinessResponseDTO = z.infer<typeof systemReadinessResponseSchema>;

/**
 * Real, computed capability status for the authenticated merchant — never
 * a static marketing claim. Each field is derived from the same
 * merchant-scoped data and services every other route already uses (see
 * `modules/system/service.ts`): a merchant with zero active products
 * really does have `catalogGrounding: "NOT_READY"`, and `paymentProvider`
 * reports the REAL configured gateway (`getPaymentGateway()`), never an
 * aspirational "TEST MODE" label independent of whether Razorpay
 * credentials are actually configured.
 */
export const systemCapabilitiesSchema = z.object({
  buyerDiscovery: z.enum(["READY", "NOT_READY"]),
  catalogGrounding: z.enum(["READY", "NOT_READY"]),
  growthIntelligence: z.enum(["READY", "NOT_READY"]),
  policy: z.enum(["ENFORCING", "NOT_CONFIGURED"]),
  checkout: z.enum(["READY", "NOT_READY"]),
  paymentProvider: z.enum(["RAZORPAY_TEST_MODE", "MOCK_GATEWAY", "NOT_CONFIGURED"]),
  recovery: z.enum(["READY", "NOT_READY"]),
  ledger: z.literal("ENABLED"),
});
export type SystemCapabilitiesDTO = z.infer<typeof systemCapabilitiesSchema>;

/**
 * Connected commerce systems (Part 11 §7) — an honest read-only view of
 * what actually feeds this build.
 *
 * Deliberately NOT a fake third-party integration panel: this project
 * has no Shopify/WooCommerce connector, so none is listed. Each entry
 * reports a REAL internal data source, and `CONNECTED` means rows for it
 * genuinely exist for this merchant — an empty catalog reports
 * `NO_DATA`, never a green tick.
 */
export const connectedSystemStatusSchema = z.enum(["CONNECTED", "NO_DATA", "NOT_CONFIGURED"]);

export const connectedSystemsSchema = z.object({
  /** Every entry names its real provenance, e.g. "Merchant Commerce Data". */
  source: z.string(),
  catalog: connectedSystemStatusSchema,
  inventory: connectedSystemStatusSchema,
  orders: connectedSystemStatusSchema,
  checkout: connectedSystemStatusSchema,
  paymentProvider: z.enum(["RAZORPAY_TEST_MODE", "MOCK_GATEWAY", "NOT_CONFIGURED"]),
  /** Which live model provider is actually configured, or whether the
   * deterministic demo extractor is standing in. Never overstated as
   * "AI configured" when no key exists. */
  aiProvider: z.enum(["LIVE_ANTHROPIC", "LIVE_GEMINI", "DEMO_RULE_BASED", "DISABLED"]),
  counts: z.object({
    products: z.number().int().min(0),
    variants: z.number().int().min(0),
    orders: z.number().int().min(0),
    checkouts: z.number().int().min(0),
  }),
});
export type ConnectedSystemsDTO = z.infer<typeof connectedSystemsSchema>;
