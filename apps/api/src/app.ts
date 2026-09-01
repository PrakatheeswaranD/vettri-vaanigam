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
import { registerAgentGatewayRoutes } from "./modules/gateway/routes.js";
import { registerCatalogCompilerRoutes } from "./modules/catalog-compiler/routes.js";
import { registerAcpRoutes } from "./modules/acp/routes.js";
import { registerX402Routes } from "./modules/x402/routes.js";
import { registerBuyerAgentRoutes } from "./modules/buyer-agent/routes.js";
import { registerMerchantAgentRoutes } from "./modules/merchant-agent/routes.js";
import { registerPolicyRoutes } from "./modules/policy/routes.js";
import { registerPaymentRoutes } from "./modules/payments/routes.js";
import { registerPaymentWebhookRoutes } from "./modules/payments/webhook-routes.js";
import { registerAuthRoutes } from "./modules/auth/routes.js";
import { authenticateRequest } from "./modules/auth/middleware.js";
import { registerCampaignRoutes } from "./modules/campaigns/routes.js";
import { registerPostPurchaseRoutes } from "./modules/post-purchase/routes.js";
import { registerMarketplaceRoutes } from "./modules/marketplace/routes.js";
import { registerBuyerPolicyRoutes } from "./modules/buyer-policy/routes.js";
import { registerBuyerPurchaseRoutes } from "./modules/buyer-policy/purchase-routes.js";
import { registerPlatformAdminRoutes } from "./modules/marketplace/admin-routes.js";
import { createPublicRateLimitHook } from "./http/rate-limit.js";

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
  app.addHook("onRequest", createPublicRateLimitHook());
  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("referrer-policy", "no-referrer");
    reply.header("content-security-policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    reply.header("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=()");
    if (env.NODE_ENV === "production") {
      reply.header("strict-transport-security", "max-age=31536000; includeSubDomains");
    }
    return payload;
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

    // Fastify raises its own protocol-level errors before any handler runs —
    // an empty body under `content-type: application/json`, a body over the
    // size limit, an unsupported media type. Each already carries the right
    // 4xx `statusCode`; falling through to the branch below reported them as
    // INTERNAL_ERROR 500, which tells an integrating agent "the gateway is
    // broken" when the truth is "your request was malformed" — and 500 is
    // the one class of response a well-behaved client will retry. Their
    // messages are protocol facts, not internal state, so they are safe to
    // return and are what makes the response actionable.
    const fastifyStatus = (error as { statusCode?: unknown }).statusCode;
    if (typeof fastifyStatus === "number" && fastifyStatus >= 400 && fastifyStatus < 500) {
      const detail = error instanceof Error ? error.message : "Request could not be processed.";
      request.log.warn({ err: error, requestId: request.id }, "client request error");
      // Reuses the documented VALIDATION_ERROR code rather than inventing a
      // new one: an integrating agent switching on `code` must not meet a
      // value absent from the published error vocabulary. The specific
      // protocol detail travels in the message.
      reply.status(fastifyStatus).send(toErrorResponseBody("VALIDATION_ERROR", detail, request.id));
      return;
    }

    request.log.error({ err: error, requestId: request.id }, "unhandled error");
    reply.status(500).send(toErrorResponseBody("INTERNAL_ERROR", "An unexpected error occurred.", request.id));
  });

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send(toErrorResponseBody("NOT_FOUND", `Route not found: ${request.method} ${request.url}`, request.id));
  });

  // PART 10 §1 — global authentication gate. Registered before every
  // route module below so no handler can ever run without either being
  // on the explicit unauthenticated allowlist or having a resolved
  // `merchantId` already attached to the request.
  app.addHook("preHandler", authenticateRequest);

  const v1 = "/api/v1";
  registerAuthRoutes(app, v1);
  registerSystemRoutes(app, v1);
  registerMerchantRoutes(app, v1);
  registerCatalogRoutes(app, v1);
  registerReadinessRoutes(app, v1);
  registerLedgerRoutes(app, v1);
  registerGrowthRoutes(app, v1);
  registerTransactionRoutes(app, v1);
  registerAgentCommerceRoutes(app, v1);
  registerAgentGatewayRoutes(app, v1);
  registerCatalogCompilerRoutes(app, v1);
  registerAcpRoutes(app, v1);
  registerX402Routes(app, v1);
  registerBuyerAgentRoutes(app, v1);
  registerMerchantAgentRoutes(app, v1);
  registerPolicyRoutes(app, v1);
  registerCommerceRoutes(app, v1);
  registerPaymentRoutes(app, v1);
  registerPaymentWebhookRoutes(app, v1);
  registerCampaignRoutes(app, v1);
  registerPostPurchaseRoutes(app, v1);
  registerMarketplaceRoutes(app, v1);
  registerBuyerPolicyRoutes(app, v1);
  registerBuyerPurchaseRoutes(app, v1);
  registerPlatformAdminRoutes(app, v1);
  registerSandboxRoutes(app, v1);

  return app;
}
