/**
 * Refuses to run the test suite against anything but a local database.
 *
 * WHY THIS EXISTS
 *
 * The integration tests seed, mutate and delete merchant data — the seed
 * helper alone calls `resetDemoMerchant`. That is correct against a
 * disposable local database and catastrophic against a shared or hosted
 * one: pointing `DATABASE_URL` at a managed instance (Supabase, RDS,
 * Neon) and running `pnpm test` would destroy real data.
 *
 * This is easy to do by accident, because `.env` is shared between
 * running the app and running the tests. Switching the app over to a
 * hosted database silently re-points the tests too. This guard turns
 * that silent, destructive mistake into a loud refusal before a single
 * test executes.
 *
 * The check is host-based rather than a flag, because a flag can be set
 * on the hosted config just as easily as it can be forgotten.
 */

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0", "host.docker.internal", "postgres", "db"]);

export function assertLocalDatabase(rawUrl: string | undefined): void {
  if (!rawUrl) {
    throw new Error("DATABASE_URL is not set. Tests need a local database — start one with `pnpm db:up`.");
  }

  let host: string;
  try {
    host = new URL(rawUrl).hostname;
  } catch {
    throw new Error("DATABASE_URL is not a valid URL, so it cannot be verified as local. Refusing to run tests.");
  }

  if (LOCAL_HOSTS.has(host)) return;

  throw new Error(
    [
      "",
      "  REFUSING TO RUN TESTS AGAINST A NON-LOCAL DATABASE.",
      "",
      `  DATABASE_URL points at: ${host}`,
      "",
      "  These tests reset and rewrite merchant data. Running them against a",
      "  hosted database would destroy it.",
      "",
      "  Point DATABASE_URL and DIRECT_URL back at the local dev database",
      "  (see the commented block in .env), start it with `pnpm db:up`, and",
      "  re-run. Switch back to the hosted URL only for running the app.",
      "",
    ].join("\n"),
  );
}
