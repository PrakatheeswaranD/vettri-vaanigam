import { env } from "./config/env.js";
import { buildApp } from "./app.js";
import { prisma } from "./db/client.js";

const app = buildApp();

async function main() {
  try {
    await app.listen({ port: env.PORT, host: "0.0.0.0" });
    app.log.info(`razorgrowth-api listening on :${env.PORT} (${env.NODE_ENV})`);
  } catch (err) {
    app.log.error(err, "failed to start server");
    process.exit(1);
  }
}

async function shutdown(signal: string) {
  app.log.info(`received ${signal}, shutting down...`);
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

void main();
