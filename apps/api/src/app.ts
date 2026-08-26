/**
 * Fastify application factory (PART 01 §24, §28, §32).
 *
 * Wires: request correlation, structured logging, CORS, a single safe
 * error envelope, and the versioned `/api/v1` route tree. Kept import-only
 * — `server.ts` is the only file that actually calls `.listen()` — so
 * tests can build and `.inject()` against the app without binding a port.
 */
import { randomUUID } from "node:crypto";
import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { env } from "./config/env.js";
import { logger } from "./observability/logger.js";
import { AppError, toErrorResponseBody } from "./http/errors.js";
import { registerSystemRoutes } from "./modules/system/routes.js";
import { registerMerchantRoutes } from "./modules/merchant/routes.js";
import { registerCatalogRoutes } from "./modules/catalog/routes.js";
import { registerReadinessRoutes } from "./modules/readiness/routes.js";
import { registerLedgerRoutes } from "./modules/audit/routes.js";
import { registerSandboxRoutes } from "./modules/sandbox/routes.js";
import { registerGrowthRoutes } from "./modules/growth/routes.js";
import { registerTransactionRoutes, registerCommerceRoutes } from "./modules/commerce/routes.js";
import { registerAgentCommerceRoutes } from "./modules/agent-commerce/routes.js";
import { registerBuyerAgentRoutes } from "./modules/buyer-agent/routes.js";
import { registerMerchantAgentRoutes } from "./modules/merchant-agent/routes.js";
import { registerPolicyRoutes } from "./modules/policy/routes.js";
import { registerPaymentRoutes } from "./modules/payments/routes.js";
import { registerPaymentWebhookRoutes } from "./modules/payments/webhook-routes.js";

export function buildApp(): FastifyInstance {
  // Cast to the default FastifyInstance shape: passing a concrete Pino
  // instance via `loggerInstance` makes Fastify infer an overly specific
  // Logger<...> generic that isn't assignable to the FastifyBaseLogger
  // type our route modules are written against, even though the real
  // Pino instance satisfies that interface at runtime.
  const app = Fastify({
    loggerInstance: logger,
    genReqId: (req) => (req.headers["x-request-id"] as string | undefined) ?? randomUUID(),
  }) as unknown as FastifyInstance;

  app.addHook("onRequest", async (request, reply) => {
    reply.header("x-request-id", request.id);
  });

  void app.register(cors, {
    origin: [env.WEB_ORIGIN],
    credentials: false,
  });

  // Single safe error envelope (PART 00 §27, §39). Internal details are
  // logged (with requestId for correlation) but never sent to the client.
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      if (error.statusCode >= 500) {
        request.log.error({ err: error, requestId: request.id }, error.message);
      } else {
        request.log.warn({ err: error, requestId: request.id }, error.message);
      }
      reply.status(error.statusCode).send(toErrorResponseBody(error.code, error.message, request.id));
      return;
    }

    if (error instanceof ZodError) {
      request.log.warn({ err: error, requestId: request.id }, "request validation failed");
      reply
        .status(400)
        .send(toErrorResponseBody("VALIDATION_ERROR", "Request validation failed.", request.id));
      return;
    }

    if ((error as { validation?: unknown }).validation) {
      request.log.warn({ err: error, requestId: request.id }, "request validation failed");
      reply
        .status(400)
        .send(toErrorResponseBody("VALIDATION_ERROR", "Request validation failed.", request.id));
      return;
    }

    request.log.error({ err: error, requestId: request.id }, "unhandled error");
    reply.status(500).send(toErrorResponseBody("INTERNAL_ERROR", "An unexpected error occurred.", request.id));
  });

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send(toErrorResponseBody("NOT_FOUND", `Route not found: ${request.method} ${request.url}`, request.id));
  });

  const v1 = "/api/v1";
  registerSystemRoutes(app, v1);
  registerMerchantRoutes(app, v1);
  registerCatalogRoutes(app, v1);
  registerReadinessRoutes(app, v1);
  registerLedgerRoutes(app, v1);
  registerGrowthRoutes(app, v1);
  registerTransactionRoutes(app, v1);
  registerAgentCommerceRoutes(app, v1);
  registerBuyerAgentRoutes(app, v1);
  registerMerchantAgentRoutes(app, v1);
  registerPolicyRoutes(app, v1);
  registerCommerceRoutes(app, v1);
  registerPaymentRoutes(app, v1);
  registerPaymentWebhookRoutes(app, v1);
  registerSandboxRoutes(app, v1);

  return app;
}
