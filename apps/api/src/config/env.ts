/**
 * Typed, validated environment configuration (PART 00 §30; PART 01 §30).
 *
 * This is the ONLY place `process.env` is read. Every other module
 * imports `env` from here. Validation happens once at startup — an
 * invalid/missing required variable fails fast instead of surfacing as a
 * confusing runtime error deep in a request handler.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";

// Load the repo-root .env explicitly (resolved relative to this file, not
// cwd) so this app behaves the same whether started from the repo root
// (`pnpm dev:api`) or from apps/api directly.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: path.resolve(__dirname, "../../../../.env") });

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  /**
   * Overrides `PORT` when set.
   *
   * `pnpm dev` starts the API and the web app in one parallel run, and
   * anything wrapping that run — a dev-tool preview pane, a task runner,
   * an IDE launcher — is entitled to export `PORT` for its own purposes.
   * When it does, that value reaches the API and silently moves it off
   * the port the web app is configured to call, which surfaces as
   * "could not reach the sign-in service" with nothing wrong in either
   * app. `API_PORT` is this service's own name for its own port, so the
   * repo can pin it without fighting the ambient one. Deployments that
   * legitimately assign a port (containers, PaaS) set only `PORT` and
   * keep working unchanged.
   */
  API_PORT: z.coerce.number().int().positive().optional(),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  WEB_ORIGIN: z.string().min(1).default("http://localhost:5173"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  // --- Buyer Agent AI provider (PART 03 §9, §26, §155) ---
  // Absent by design in most environments: the Buyer Agent falls back to
  // a clearly-labeled deterministic rule-based provider (PART 03 §10) so
  // the golden-path demo never depends on live network access or a paid
  // API key. Set this only to exercise the real LLM-backed extraction.
  // Explicit provider selection rather than "whichever key happens to be
  // set": with more than one live provider available, an implicit rule
  // makes it genuinely unclear which model answered a given request —
  // exactly the wrong ambiguity when a judge asks "what produced this?".
  // `demo` forces the deterministic extractor even when keys are present.
  AI_PROVIDER: z.enum(["auto", "anthropic", "gemini", "demo"]).default("auto"),
  AI_PROVIDER_API_KEY: z.string().min(1).optional(),
  AI_PROVIDER_MODEL: z.string().min(1).default("claude-haiku-4-5-20251001"),
  AI_PROVIDER_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),
  GEMINI_API_KEY: z.string().min(1).optional(),
  GEMINI_MODEL: z.string().min(1).default("gemini-3.6-flash"),
  // --- Razorpay Test Mode (PART 07 §11-§12) ---
  // Absent by design in most environments: without these three, real
  // payment initiation returns a safe "not configured" error while every
  // other part of the application (catalog, agents, commerce up through
  // READY_FOR_PAYMENT) remains fully usable. `NODE_ENV=test` never reads
  // these regardless — the automated test suite always uses the
  // deterministic `MockPaymentGateway`, never live Razorpay Test Mode.
  RAZORPAY_KEY_ID: z.string().min(1).optional(),
  RAZORPAY_KEY_SECRET: z.string().min(1).optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().min(1).optional(),
  RAZORPAY_API_BASE_URL: z.string().min(1).default("https://api.razorpay.com/v1"),
  RAZORPAY_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
  // --- Merchant identity/auth (PART 10 §1) ---
  SESSION_VALIDITY_HOURS: z.coerce.number().int().positive().default(12),
  // HMAC key for ACP delegated-payment tokens. It is not a payment-provider
  // secret, but it must be unpredictable because possession authorizes one
  // bounded completion. The development default is rejected in production.
  ACP_DELEGATION_TOKEN_SECRET: z
    .string()
    .min(32)
    .default("development-only-acp-token-secret-change-me"),
  DATA_FINGERPRINT_SECRET: z
    .string()
    .min(32)
    .default("development-only-data-fingerprint-change-me"),
  PUBLIC_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1_000).default(60_000),
  RATE_LIMIT_MAX_BUCKETS: z.coerce.number().int().min(100).max(1_000_000).default(10_000),
  FINANCIAL_IDEMPOTENCY_RETENTION_DAYS: z.coerce.number().int().min(365).max(3650).default(2555),
  X402_FACILITATOR_URL: z.string().url().optional(),
  X402_FACILITATOR_API_KEY: z.string().min(1).optional(),
  X402_FACILITATOR_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  X402_NETWORK: z.string().min(3).default("eip155:84532"),
  X402_ASSET: z.string().min(8).optional(),
  X402_PAY_TO: z.string().min(8).optional(),
  X402_ASSET_CURRENCY: z.enum(["INR", "USD"]).default("USD"),
  X402_ATOMIC_UNITS_PER_MINOR: z.coerce.number().int().positive().optional(),
  DATA_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(30),
  /**
   * The operator's half of the unattended-cycle switch. Off by default for
   * the same reason the retention sweeper is: starting an API against a
   * connected database must never begin acting on merchant data by
   * surprise. The merchant's own `autonomousRunsEnabled` must also be
   * true before anything runs.
   */
  AGENT_SCHEDULER_ENABLED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  /** Floor of one minute — a tighter loop would race its own cycles
   * without finishing more work. */
  AGENT_SCHEDULER_INTERVAL_MS: z.coerce.number().int().min(60_000).default(15 * 60 * 1_000),
  RETENTION_SWEEPER_ENABLED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  RETENTION_SWEEP_INTERVAL_MS: z.coerce.number().int().min(60_000).default(24 * 60 * 60 * 1_000),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration:");
  console.error(parsed.error.flatten().fieldErrors);
  throw new Error("Environment validation failed. See logged field errors above.");
}

// PART 07 §12 — a partially-configured Razorpay integration (e.g. a key ID
// with no secret) is worse than none: it would look "on" while silently
// failing every call. Fail fast at startup instead of deep inside a
// request handler.
const razorpayFields = [parsed.data.RAZORPAY_KEY_ID, parsed.data.RAZORPAY_KEY_SECRET, parsed.data.RAZORPAY_WEBHOOK_SECRET];
const razorpayConfiguredCount = razorpayFields.filter((v) => v !== undefined).length;
if (razorpayConfiguredCount > 0 && razorpayConfiguredCount < razorpayFields.length) {
  throw new Error(
    "Partial Razorpay configuration: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, and RAZORPAY_WEBHOOK_SECRET must be set together, or not at all.",
  );
}

if (
  parsed.data.NODE_ENV === "production" &&
  parsed.data.ACP_DELEGATION_TOKEN_SECRET === "development-only-acp-token-secret-change-me"
) {
  throw new Error("ACP_DELEGATION_TOKEN_SECRET must be set to a unique secret in production.");
}
if (
  parsed.data.NODE_ENV === "production" &&
  parsed.data.DATA_FINGERPRINT_SECRET === "development-only-data-fingerprint-change-me"
) {
  throw new Error("DATA_FINGERPRINT_SECRET must be set to a unique secret in production.");
}

const x402SettlementFields = [
  parsed.data.X402_ASSET,
  parsed.data.X402_PAY_TO,
  parsed.data.X402_ATOMIC_UNITS_PER_MINOR,
];
const x402SettlementCount = x402SettlementFields.filter((value) => value !== undefined).length;
if (x402SettlementCount > 0 && x402SettlementCount < x402SettlementFields.length) {
  throw new Error("Partial x402 configuration: X402_ASSET, X402_PAY_TO and X402_ATOMIC_UNITS_PER_MINOR must be set together.");
}
if (parsed.data.X402_FACILITATOR_URL && x402SettlementCount !== x402SettlementFields.length) {
  throw new Error("X402_FACILITATOR_URL requires a complete asset/payee/unit configuration.");
}

export const env = {
  ...parsed.data,
  // Resolved once, here, so `server.ts` and everything downstream keep
  // reading a single `PORT` and never have to know about the override.
  PORT: parsed.data.API_PORT ?? parsed.data.PORT,
};
export type Env = typeof env;

/** PART 07 §12 — `true` only when all three Razorpay Test Mode credentials
 * are present. `NODE_ENV=test` never has real Razorpay integration
 * regardless of this flag — the payment gateway factory checks `NODE_ENV`
 * first and always returns the deterministic mock in tests. */
export const razorpayConfigured = razorpayConfiguredCount === razorpayFields.length;
