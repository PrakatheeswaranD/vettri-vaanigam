/**
 * P0-required API tests (PART 01 §64): health, system readiness, one
 * catalog endpoint, and a safe validation failure. Uses Fastify's
 * built-in `.inject()` rather than a real HTTP server or Supertest.
 *
 * These tests assume the local dev database is up and seeded (`pnpm
 * db:up`, `pnpm db:migrate`, `pnpm db:seed`) — the same state required to
 * run the app itself, per the documented setup sequence in the README.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";
import { prisma } from "./db/client.js";

let app: FastifyInstance;

beforeAll(async () => {
  app = buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("GET /api/v1/health", () => {
  it("returns 200 with a stable liveness shape", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok", service: "razorgrowth-api" });
  });
});

describe("GET /api/v1/system/readiness", () => {
  it("reports the database as reachable", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/system/readiness" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("ready");
    expect(body.checks.database).toBe("ok");
  });
});

describe("GET /api/v1/catalog/products", () => {
  it("returns paginated, seeded product summaries", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/catalog/products?limit=5" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.length).toBeLessThanOrEqual(5);
    expect(body.pagination).toMatchObject({ page: 1, limit: 5 });
    // Money must be integer minor units, never a float (PART 00 §16).
    for (const item of body.items) {
      if (item.minPrice) {
        expect(Number.isInteger(item.minPrice.amountMinor)).toBe(true);
      }
    }
  });

  it("enforces the maximum page limit server-side (PART 01 §57)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/catalog/products?limit=9999" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });
});

describe("GET /api/v1/catalog/products/:id — safe validation failure", () => {
  it("rejects a non-UUID id with a safe error envelope, not a stack trace", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/catalog/products/not-a-uuid" });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.requestId).toBeTruthy();
    expect(JSON.stringify(body)).not.toMatch(/at Object\.|node_modules|\.ts:\d+/);
  });

  it("returns 404 for a well-formed but non-existent id", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/catalog/products/00000000-0000-0000-0000-000000000000",
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });
});

describe("GET /api/v1/ledger", () => {
  it("returns seeded agent action entries with an auditable shape", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/ledger?limit=5" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items.length).toBeGreaterThan(0);
    for (const action of body.items) {
      expect(action).toHaveProperty("conciseReason");
      expect(action).toHaveProperty("status");
      expect(action).toHaveProperty("workflowId");
    }
  });
});

describe("unknown route", () => {
  it("returns a safe 404 envelope", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/does-not-exist" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });
});
