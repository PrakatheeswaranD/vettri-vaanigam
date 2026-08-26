import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    testTimeout: 15000,
    // The local PGlite-socket dev database (scripts/db-server.mjs) handles
    // a burst of concurrent connections unreliably (see PROGRESS.md) — it
    // is a single-process dev shim, not real Postgres. Running test files
    // in parallel each opens its own Fastify app + Prisma connection pool
    // against the same dev DB, which produced intermittent 500s once
    // enough API integration test files existed. Sequential file
    // execution trades a little speed for reliability against this dev
    // shim; a real Postgres server would not need this.
    fileParallelism: false,
  },
});
