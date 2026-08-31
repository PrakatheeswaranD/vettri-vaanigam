// Local development database server.
//
// PART 00 requires PostgreSQL as the relational source of truth. This
// sandbox has no Docker, no WSL, and outbound access to the official
// PostgreSQL Windows installer host (get.enterprisedb.com) is blocked by
// the network, so neither `docker compose up` nor a normal installer works
// here. Instead we run PGlite — a real build of Postgres compiled to
// WASM (not a SQL emulator) — and expose it over the actual Postgres wire
// protocol via @electric-sql/pglite-socket. Prisma, migrations, and every
// application code path talk to it exactly as they would talk to any
// other `postgresql://` server; nothing downstream knows the difference.
//
// This is a documented environment adaptation (see PROGRESS.md /
// README.md), not an architecture change: `apps/api/prisma/schema.prisma`
// still declares `provider = "postgresql"`, and a real Postgres server
// (Docker or a native install) can be substituted in any environment where
// one is reachable, with no code changes — only DATABASE_URL changes.
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// A separate directory allows clean integration-test databases without
// resetting or deleting the developer's existing data.
const dataDir = process.env.PGLITE_DATA_DIR
  ? path.resolve(process.env.PGLITE_DATA_DIR)
  : path.join(__dirname, "..", ".dbdata");
const port = Number(process.env.PGLITE_PORT ?? 5432);
const host = process.env.PGLITE_HOST ?? "127.0.0.1";
const HEALTH_CHECK_INTERVAL_MS = 15_000;
const HEALTH_CHECK_TIMEOUT_MS = 5_000;

const db = new PGlite(dataDir);
await db.waitReady;

// pglite-socket defaults to a single connection, which rejects Prisma's
// connection pool (its migration engine and query engine can each hold a
// connection open concurrently) with a non-Postgres-protocol error message
// that surfaces to Prisma as a generic "can't reach database server".
const server = new PGLiteSocketServer({ db, port, host, maxConnections: 20 });
await server.start();

console.log(`[db] PGlite Postgres-compatible server listening on postgres://${host}:${port}`);
console.log(`[db] data directory: ${dataDir}`);

// Observed during PART 02 development: over an extended session this
// process can end up in a state where it still accepts TCP connections
// but no longer actually services queries (cause unconfirmed — possibly
// an internal WASM-side issue under sustained connection churn). A
// full-process restart reliably recovered it every time it was observed.
// Rather than silently hanging indefinitely once that happens, this
// periodically proves liveness directly against the PGlite instance
// in-process (bypassing the socket layer entirely) and exits loudly if a
// check hangs or fails, so `pnpm db:up` (which supervises and restarts
// this process — see scripts/db-up.mjs) can recover automatically instead
// of requiring a human to notice and restart it manually.
const healthCheckTimer = setInterval(() => {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("health check timed out")), HEALTH_CHECK_TIMEOUT_MS),
  );
  Promise.race([db.query("SELECT 1"), timeout]).catch((err) => {
    console.error(`[db] health check failed: ${err.message}. Exiting so the supervisor can restart this process.`);
    process.exit(1);
  });
}, HEALTH_CHECK_INTERVAL_MS);
healthCheckTimer.unref();

const shutdown = async () => {
  console.log("\n[db] shutting down...");
  clearInterval(healthCheckTimer);
  await server.stop();
  await db.close();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
