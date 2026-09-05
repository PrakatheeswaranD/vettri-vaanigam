import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = process.env.ISOLATED_TEST_PORT ?? "55440";
const testUrl = `postgresql://postgres:postgres@127.0.0.1:${port}/postgres?connection_limit=1&pgbouncer=true`;
const dataDir = path.join(root, `.dbdata-tests-${randomUUID()}`);
await mkdir(dataDir);
const env = { ...process.env, NODE_ENV: "test", AI_PROVIDER: "demo", PGLITE_PORT: port,
  PGLITE_DATA_DIR: dataDir, TEST_DATABASE_URL: testUrl, TEST_DIRECT_URL: testUrl };
const db = spawn(process.execPath, ["scripts/db-server.mjs"], { cwd: root, env, stdio: ["ignore", "pipe", "inherit"] });
function run(args, cwd, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd, env: { ...env, ...extraEnv }, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", code => code === 0 ? resolve() : reject(new Error(`Command failed (${code}): ${args.join(" ")}`)));
  });
}
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Test database startup timed out")), 30000);
    db.once("error", reject);
    db.once("exit", code => reject(new Error(`Test database exited (${code})`)));
    db.stdout.on("data", chunk => { process.stdout.write(chunk); if (String(chunk).includes("listening on")) { clearTimeout(timer); resolve(); } });
  });
  const api = path.join(root, "apps/api");
  const setupEnv = { DATABASE_URL: testUrl, DIRECT_URL: testUrl };
  await run(["node_modules/prisma/build/index.js", "migrate", "deploy"], api, setupEnv);
  await run(["--import", "./scripts/node-runtime-compat.mjs", "--import", "tsx", "prisma/seed.ts"], api, setupEnv);
  await run(["--import", "./scripts/node-runtime-compat.mjs", "--import", "tsx", "scripts/provision-demo-identities.ts"], api, setupEnv);
  // A distinct sentinel avoids inheriting the app's database for destructive tests.
  await run(["node_modules/vitest/vitest.mjs", "run", ...process.argv.slice(2)], api,
    { DATABASE_URL: "postgresql://localhost:1/application", DIRECT_URL: testUrl });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  db.kill();
  console.log(`Isolated test data retained for debugging: ${dataDir}`);
}
