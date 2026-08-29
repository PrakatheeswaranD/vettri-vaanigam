/**
 * Paces live-model evaluation runs beneath the provider's per-minute
 * request limit.
 *
 * WHY THIS EXISTS
 *
 * An eval that fires 28 cases as fast as the loop allows will trip a
 * free-tier RPM limit partway through, and every remaining case then
 * records `AI_PROVIDER_UNAVAILABLE`. That reads as a catastrophic model
 * failure when the model was never asked — it silently turns an
 * infrastructure limit into a fabricated quality score, which is exactly
 * the kind of dishonest number these suites exist to avoid.
 *
 * The deterministic provider makes no network calls, so it is never
 * throttled — a contract run stays as fast as it has always been.
 */

/**
 * ~8.5 requests/minute. Deliberately well under the free tier's nominal
 * RPM rather than just beneath it: a failing case RETRIES (MAX_AI_RETRIES),
 * so it spends two requests instead of one, which briefly doubles the real
 * rate. At 4500ms that was enough to trip the limit mid-run, and because a
 * rate-limited case is itself recorded as a failure, the overage fed the
 * next retry — a cascade that took out the back half of the suite.
 *
 * Override with EVAL_REQUEST_INTERVAL_MS on a paid tier.
 */
export const EVAL_REQUEST_INTERVAL_MS = Number(process.env.EVAL_REQUEST_INTERVAL_MS ?? 7000);

let lastRequestAt = 0;

export async function throttle(providerMode: string): Promise<void> {
  if (providerMode === "DEMO_RULE_BASED") return;
  const waitMs = lastRequestAt + EVAL_REQUEST_INTERVAL_MS - Date.now();
  if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
  lastRequestAt = Date.now();
}
