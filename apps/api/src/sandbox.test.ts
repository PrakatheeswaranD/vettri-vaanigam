/**
 * Break the Agent — adversarial sandbox tests (PART 09 §140, §198).
 * Drives the real `POST /sandbox/break-the-agent/run` route for every
 * curated preset and asserts each is blocked at the expected real
 * deterministic gate, with zero money ever moved.
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

async function run(attackId: string) {
  const res = await app.inject({ method: "POST", url: "/api/v1/sandbox/break-the-agent/run", payload: { attackId } });
  return res;
}

describe("GET /api/v1/sandbox/break-the-agent/presets", () => {
  it("returns the closed preset library", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/sandbox/break-the-agent/presets" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // The bound exists to stop this becoming a free-text attacker surface,
    // not to fix a number. It was raised from 8 to 12 when the three
    // gateway attacks (mandate forgery, replay, price tampering) were
    // added — each still targets one real deterministic boundary.
    expect(body.presets.length).toBeGreaterThanOrEqual(5);
    expect(body.presets.length).toBeLessThanOrEqual(12);
    const ids = body.presets.map((p: { id: string }) => p.id);
    expect(new Set(ids).size).toBe(ids.length); // no duplicates
  });
});

describe("Break the Agent — adversarial attacks are blocked by real deterministic gates (PART 09 §198)", () => {
  it("a 50% discount is rejected by real proposal validation, never reaching policy", async () => {
    const res = await run("FINANCIAL_LIMIT_50_PERCENT_DISCOUNT");
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.blockedAtStage).toBe("validation");
    expect(body.moneyMovedMinor).toBe(0);
    const validationStage = body.stages.find((s: { id: string }) => s.id === "validation");
    expect(validationStage.status).toBe("REJECTED");
    expect(validationStage.detail).toMatch(/exceeds the configured ceiling/i);
    const policyStage = body.stages.find((s: { id: string }) => s.id === "policy");
    expect(policyStage.status).toBe("NOT_REACHED");
  });

  it("cannot bypass merchant approval to obtain an execution authorization directly", async () => {
    const res = await run("APPROVAL_BYPASS");
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.blockedAtStage).toBe("authorization");
    expect(body.moneyMovedMinor).toBe(0);
    const authStage = body.stages.find((s: { id: string }) => s.id === "authorization");
    expect(authStage.status).toBe("DENIED");
  });

  it("a hallucinated product id is rejected by grounding, never reaching policy", async () => {
    const res = await run("PRODUCT_HALLUCINATION");
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.blockedAtStage).toBe("grounding");
    expect(body.moneyMovedMinor).toBe(0);
    const groundingStage = body.stages.find((s: { id: string }) => s.id === "grounding");
    expect(groundingStage.status).toBe("REJECTED");
    expect(groundingStage.detail).toMatch(/not in the supplied candidate set/i);
  });

  it("a forged payment-success field has no schema channel to travel through", async () => {
    const res = await run("PAYMENT_SUCCESS_FORGERY");
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.blockedAtStage).toBe("schema");
    expect(body.moneyMovedMinor).toBe(0);
    const schemaStage = body.stages.find((s: { id: string }) => s.id === "schema");
    expect(schemaStage.detail).toMatch(/paymentState/);
    expect(schemaStage.detail).not.toMatch(/paymentState: "CAPTURED"/); // never echoes it back as accepted
  });

  it("recovery abuse at the attempt limit is blocked by eligibility, never reaching the Merchant Agent", async () => {
    const res = await run("RECOVERY_RETRY_ABUSE");
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.blockedAtStage).toBe("eligibility");
    expect(body.moneyMovedMinor).toBe(0);
    const eligibilityStage = body.stages.find((s: { id: string }) => s.id === "eligibility");
    expect(eligibilityStage.status).toBe("REJECTED");
    expect(eligibilityStage.detail).toMatch(/maximum of \d+ recovery attempt/i);
    const proposalStage = body.stages.find((s: { id: string }) => s.id === "proposal");
    expect(proposalStage.status).toBe("NOT_REACHED");
  });

  it("a non-agent-visible product cannot be loaded through the catalog boundary", async () => {
    const res = await run("VISIBILITY_BYPASS_HIDDEN_PRODUCT");
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.blockedAtStage).toBe("catalog-visibility");
    expect(body.moneyMovedMinor).toBe(0);
    const visibilityStage = body.stages.find((s: { id: string }) => s.id === "catalog-visibility");
    expect(visibilityStage.status).toBe("REJECTED");
  });

  it("rejects an unknown attack id rather than running arbitrary behavior", async () => {
    const res = await run("NOT_A_REAL_ATTACK");
    expect(res.statusCode).toBe(400);
  });
});
