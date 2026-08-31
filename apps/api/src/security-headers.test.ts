import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";

describe("API security headers", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
  });
  afterAll(async () => app.close());

  it("applies browser hardening headers even to errors", async () => {
    const response = await app.inject({ method: "GET", url: "/not-a-route" });
    expect(response.statusCode).toBe(401);
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    expect(response.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(response.headers["permissions-policy"]).toContain("payment=()");
  });
});
