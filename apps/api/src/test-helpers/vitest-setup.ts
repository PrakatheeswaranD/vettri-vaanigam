/**
 * Vitest global setup. Runs once before any test file, so the
 * non-local-database refusal happens before a single row is touched.
 *
 * Loads the repo-root `.env` the same way `config/env.ts` does — by a
 * path resolved relative to this file rather than to cwd — because
 * `globalSetup` runs before any application module is imported, so
 * nothing has populated `process.env` yet.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { assertLocalDatabase } from "./guard-local-database.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Vitest requires `globalSetup` modules to export a `setup` function —
 * side effects at import time are not enough. */
export function setup(): void {
  loadDotenv({ path: path.resolve(__dirname, "../../../../.env") });
  const testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl) throw new Error("TEST_DATABASE_URL is required. Run pnpm test:isolated for a disposable database.");
  const destination = (raw: string) => {
    const url = new URL(raw);
    const host = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ? "loopback" : url.hostname;
    return `${host}:${url.port || "5432"}${url.pathname}`;
  };
  if (process.env.DATABASE_URL && destination(testUrl) === destination(process.env.DATABASE_URL)) {
    throw new Error("The test and application databases must be different. Run pnpm test:isolated.");
  }
  // `.env` is shared between running the app and running the tests, so
  // pointing the app at a hosted database also re-points the tests — and
  // the local-database guard below then (correctly) refuses to run the
  // whole suite. That silently reduces `pnpm test` to "no tests" for the
  // API package, which reads like a pass. `TEST_DATABASE_URL` breaks the
  // coupling: set it once and the suite always runs against the local
  // database no matter where the app is currently pointed.
  if (process.env.TEST_DATABASE_URL) {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    process.env.DIRECT_URL = process.env.TEST_DIRECT_URL ?? process.env.TEST_DATABASE_URL;
  }
  // The bundled local PGlite socket reuses one backend connection and can
  // otherwise collide on Prisma prepared-statement names between Vitest
  // worker processes. These are client transport settings only; the
  // local-database guard still validates the actual destination below.
  if (process.env.DATABASE_URL) {
    const databaseUrl = new URL(process.env.DATABASE_URL);
    databaseUrl.searchParams.set("connection_limit", "1");
    databaseUrl.searchParams.set("pgbouncer", "true");
    process.env.DATABASE_URL = databaseUrl.toString();
  }
  process.env.X402_ASSET ??= "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
  process.env.X402_PAY_TO ??= "0x209693Bc6afc0C5328bA36FaF03C514EF312287C";
  process.env.X402_ASSET_CURRENCY ??= "INR";
  process.env.X402_ATOMIC_UNITS_PER_MINOR ??= "1";
  assertLocalDatabase(process.env.DATABASE_URL);
}
