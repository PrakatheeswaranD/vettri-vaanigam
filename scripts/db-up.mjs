// Supervises scripts/db-server.mjs, restarting it automatically if it
// exits unexpectedly (crash, or the health check in db-server.mjs
// detecting an unresponsive PGlite instance and exiting on purpose so
// this can recover it) — see the comment in db-server.mjs for why that
// self-check exists. A clean shutdown (Ctrl+C / SIGINT / SIGTERM) is not
// restarted.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverScript = path.join(__dirname, "db-server.mjs");

const RESTART_DELAY_MS = 1_000;
const MAX_RESTARTS_PER_WINDOW = 5;
const RESTART_WINDOW_MS = 60_000;

let restartTimestamps = [];
let shuttingDown = false;
let child = null;

function startChild() {
  child = spawn(process.execPath, [serverScript], { stdio: "inherit" });

  child.on("exit", (code, signal) => {
    if (shuttingDown) return;

    if (code === 0) {
      console.log("[db:up] server exited cleanly, not restarting.");
      process.exit(0);
    }

    const now = Date.now();
    restartTimestamps = restartTimestamps.filter((t) => now - t < RESTART_WINDOW_MS);
    restartTimestamps.push(now);

    if (restartTimestamps.length > MAX_RESTARTS_PER_WINDOW) {
      console.error(
        `[db:up] server has crashed ${restartTimestamps.length} times in the last ${RESTART_WINDOW_MS / 1000}s ` +
          `(exit code ${code}, signal ${signal}). Not restarting again automatically — investigate before retrying.`,
      );
      process.exit(1);
    }

    console.error(
      `[db:up] server exited unexpectedly (code ${code}, signal ${signal}). Restarting in ${RESTART_DELAY_MS}ms...`,
    );
    setTimeout(startChild, RESTART_DELAY_MS);
  });
}

function shutdown() {
  shuttingDown = true;
  if (child) child.kill("SIGTERM");
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

startChild();
