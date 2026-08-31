import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { env } from "./config/env.js";
import { AppError } from "./http/errors.js";
import { createPublicRateLimitHook } from "./http/rate-limit.js";

describe("public request rate limiting", () => {
  const apps: ReturnType<typeof Fastify>[] = [];
  afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

  it("bounds an ACP caller and emits retry metadata", async () => {
    const app = Fastify();
    apps.push(app);
    app.addHook("onRequest", createPublicRateLimitHook());
    app.setErrorHandler((error, _request, reply) => {
      if (error instanceof AppError) return reply.status(error.statusCode).send({ code: error.code });
      return reply.status(500).send();
    });
    app.post("/api/v1/acp/:slug/test", async () => ({ ok: true }));

    for (let index = 0; index < env.PUBLIC_RATE_LIMIT_MAX; index += 1) {
      const response = await app.inject({ method: "POST", url: "/api/v1/acp/shop/test" });
      expect(response.statusCode).toBe(200);
    }
    const limited = await app.inject({ method: "POST", url: "/api/v1/acp/shop/test" });
    expect(limited.statusCode).toBe(429);
    expect(limited.json().code).toBe("RATE_LIMITED");
    expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
    expect(limited.headers["x-ratelimit-remaining"]).toBe("0");
  });
});
