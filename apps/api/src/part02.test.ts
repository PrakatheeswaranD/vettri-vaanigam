/**
 * PART 02 API tests: agent-readable catalog, structured filters,
 * deterministic readiness (latest/history/recalculate), catalog quality
 * summary, and the adversarial/security cases PART 02 §112-§114 call for.
 *
 * Assumes the local dev database is up and seeded, same as app.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildAuthedTestApp } from "./test-helpers/test-app.js";
import { prisma } from "./db/client.js";

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildAuthedTestApp();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("GET /api/v1/agent-commerce/catalog", () => {
  it("returns the canonical AgentReadableProduct shape, not the human DTO", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/agent-commerce/catalog?limit=3" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items.length).toBeGreaterThan(0);
    for (const product of body.items) {
      expect(product).toHaveProperty("identity");
      expect(product).toHaveProperty("commerce");
      expect(product).toHaveProperty("policies");
      expect(product).toHaveProperty("freshness");
      expect(product).toHaveProperty("readiness");
      expect(product).toHaveProperty("provenance");
      expect(product.provenance.dataset).toBe("SYNTHETIC_DEMO");
      // Money must be integer minor units everywhere (PART 00 §16).
      for (const variant of product.variants) {
        expect(Number.isInteger(variant.price.amountMinor)).toBe(true);
        expect(["IN_STOCK", "LOW_STOCK", "OUT_OF_STOCK", "UNAVAILABLE", "UNKNOWN"]).toContain(
          variant.availability.state,
        );
      }
    }
  });

  it("filters by price range at the database layer", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/agent-commerce/catalog?minPriceMinor=200000&maxPriceMinor=500000&limit=50",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items.length).toBeGreaterThan(0);
  });

  it("rejects minPriceMinor greater than maxPriceMinor", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/agent-commerce/catalog?minPriceMinor=500000&maxPriceMinor=100000",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("filters by availability state", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/agent-commerce/catalog?availability=UNAVAILABLE" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    for (const product of body.items) {
      expect(product.variants.some((v: { active: boolean }) => !v.active)).toBe(true);
    }
  });
});

describe("GET /api/v1/agent-commerce/catalog/:id — security/adversarial cases (PART 02 §113)", () => {
  it("rejects a malformed product id safely", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/agent-commerce/catalog/invalid" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 404 for a well-formed but non-existent id", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/agent-commerce/catalog/00000000-0000-0000-0000-000000000000",
    });
    expect(res.statusCode).toBe(404);
  });

  it("rejects an invalid availability enum value", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/agent-commerce/catalog?availability=HACKED" });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a non-numeric price filter", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/agent-commerce/catalog?maxPriceMinor=abc" });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a negative price filter", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/agent-commerce/catalog?minPriceMinor=-100" });
    expect(res.statusCode).toBe(400);
  });

  it("rejects an oversized limit", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/agent-commerce/catalog?limit=1000000" });
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /api/v1/catalog/products — PART 02 filters", () => {
  it("filters by price range", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/catalog/products?minPriceMinor=0&maxPriceMinor=100000",
    });
    expect(res.statusCode).toBe(200);
  });

  it("filters by availability", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/catalog/products?availability=IN_STOCK" });
    expect(res.statusCode).toBe(200);
    expect(res.json().items.length).toBeGreaterThan(0);
  });

  it("every returned product carries a readiness classification", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/catalog/products?limit=25" });
    const body = res.json();
    for (const item of body.items) {
      expect(["AGENT_READY", "PARTIALLY_READY", "NOT_READY"]).toContain(item.readiness);
    }
  });
});

describe("GET /api/v1/catalog/quality-summary", () => {
  it("returns real evidence-derived counts that add up sensibly", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/catalog/quality-summary" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.activeProducts).toBeGreaterThan(0);
    expect(body.agentReadyProducts + body.partiallyReadyProducts + body.notReadyProducts).toBe(body.activeProducts);
  });
});

describe("GET /api/v1/readiness/latest", () => {
  it("returns a full deterministic assessment, never NaN/Infinity/null score", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/readiness/latest" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.snapshot.overallScore).toBeGreaterThanOrEqual(0);
    expect(body.snapshot.overallScore).toBeLessThanOrEqual(100);
    expect(Number.isFinite(body.snapshot.overallScore)).toBe(true);
    expect(["AGENT_READY", "NEARLY_READY", "PARTIALLY_READY", "NOT_READY"]).toContain(body.snapshot.level);
    expect(body.snapshot.calculationVersion).toBeTruthy();
    expect(Array.isArray(body.snapshot.blockers)).toBe(true);
    expect(Array.isArray(body.snapshot.recommendations)).toBe(true);
    expect(typeof body.snapshot.evidence).toBe("object");
    // Two snapshots exist after seeding, so a delta must be present.
    expect(body.delta).not.toBeNull();
  });

  it("weighted overall score dimensions are all in [0, 100]", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/readiness/latest" });
    const dims = res.json().snapshot.dimensions;
    for (const value of Object.values(dims)) {
      expect(value as number).toBeGreaterThanOrEqual(0);
      expect(value as number).toBeLessThanOrEqual(100);
    }
  });
});

describe("GET /api/v1/readiness/history", () => {
  it("returns bounded, real recorded snapshots only", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/readiness/history?limit=10" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items.length).toBeGreaterThanOrEqual(2); // seed creates two real snapshots
    expect(body.items.length).toBeLessThanOrEqual(10);
  });

  it("rejects an oversized history limit", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/readiness/history?limit=9999" });
    expect(res.statusCode).toBe(400);
  });
});

describe("POST /api/v1/readiness/recalculate", () => {
  it("creates a new snapshot and records a SYSTEM audit event (PART 02 §95)", async () => {
    const before = await app.inject({ method: "GET", url: "/api/v1/readiness/history?limit=50" });
    const beforeCount = before.json().items.length;

    const res = await app.inject({ method: "POST", url: "/api/v1/readiness/recalculate" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.snapshot.calculationVersion).toBeTruthy();

    const after = await app.inject({ method: "GET", url: "/api/v1/readiness/history?limit=50" });
    expect(after.json().items.length).toBe(beforeCount + 1);

    const ledgerAction = await prisma.agentAction.findFirst({
      where: { actionType: "READINESS_CALCULATED" },
      orderBy: { createdAt: "desc" },
    });
    expect(ledgerAction).not.toBeNull();
    expect(ledgerAction!.actorType).toBe("SYSTEM");
  });

  it("produces the same score twice in a row when nothing changed (determinism, PART 02 §35)", async () => {
    const first = await app.inject({ method: "POST", url: "/api/v1/readiness/recalculate" });
    const second = await app.inject({ method: "POST", url: "/api/v1/readiness/recalculate" });
    expect(first.json().snapshot.overallScore).toBe(second.json().snapshot.overallScore);
    expect(first.json().snapshot.dimensions).toEqual(second.json().snapshot.dimensions);
  });
});
