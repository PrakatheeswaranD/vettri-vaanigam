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
  assertLocalDatabase(process.env.DATABASE_URL);
}
