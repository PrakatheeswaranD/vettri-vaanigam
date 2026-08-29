/**
 * The gateway attacks must actually be blocked by the REAL verifier — not
 * by a scripted "blocked" string. Each of these would fail loudly if the
 * guarantee regressed.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
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
  return app.inject({ method: "POST", url: "/api/v1/sandbox/break-the-agent/run", payload: { attackId } });
}

describe("Break the Agent — gateway attacks", () => {
  it("lists the gateway attacks alongside the originals", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/sandbox/break-the-agent/presets" });
    const ids = res.json().presets.map((p: { id: string }) => p.id);
    expect(ids).toEqual(expect.arrayContaining(["MANDATE_FORGERY", "MANDATE_REPLAY", "PRICE_TAMPERING"]));
  });

  it("blocks a forged mandate at the signature, not at the amount", async () => {
    const res = await run("MANDATE_FORGERY");
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.blockedAtStage).toBe("signature");
    expect(body.moneyMovedMinor).toBe(0);
    // Leaking which business clause would have failed hands an attacker
    // the shape of the next forgery.
    const sig = body.stages.find((s: { id: string }) => s.id === "signature");
    expect(sig.detail).toContain("MANDATE_SIGNATURE_INVALID");
    expect(sig.detail).not.toContain("MANDATE_AMOUNT_EXCEEDED");
  });

  it("blocks a replayed mandate on its nonce", async () => {
    const body = (await run("MANDATE_REPLAY")).json();
    expect(body.blockedAtStage).toBe("nonce");
    expect(body.stages.find((s: { id: string }) => s.id === "nonce").detail).toContain("MANDATE_NONCE_REPLAYED");
    expect(body.moneyMovedMinor).toBe(0);
  });

  it("blocks a claimed price that disagrees with the catalogue", async () => {
    const body = (await run("PRICE_TAMPERING")).json();
    expect(body.blockedAtStage).toBe("policy");
    expect(body.stages.find((s: { id: string }) => s.id === "policy").detail).toContain("AMOUNT_MISMATCH");
    expect(body.moneyMovedMinor).toBe(0);
  });

  it("never reports money moved on any gateway attack", async () => {
    for (const id of ["MANDATE_FORGERY", "MANDATE_REPLAY", "PRICE_TAMPERING"]) {
      expect((await run(id)).json().moneyMovedMinor).toBe(0);
    }
  });
});
