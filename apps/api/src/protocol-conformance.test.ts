import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseAcpIntent, parseAp2Intent } from "@razorgrowth/domain";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");

async function json(relativePath: string) {
  return JSON.parse(await readFile(path.join(repo, relativePath), "utf8")) as Record<string, unknown>;
}

describe("Agent-commerce protocol artifacts", () => {
  it("publishes a valid OpenAPI 3.1 document covering every money-bearing public surface", async () => {
    const document = await json("docs/openapi/agent-commerce.openapi.json");
    expect(document.openapi).toBe("3.1.0");
    const paths = document.paths as Record<string, unknown>;
    for (const required of [
      "/api/v1/agent-gateway/{merchantSlug}/intents",
      "/api/v1/agent-gateway/decisions/{decisionId}/decide",
      "/api/v1/acp/{merchantSlug}/checkout_sessions",
      "/api/v1/acp/{merchantSlug}/checkout_sessions/{sessionId}/complete",
      "/api/v1/acp/{merchantSlug}/agentic_commerce/delegate_payment",
      "/api/v1/x402/{merchantSlug}/purchase",
      "/api/v1/agent-catalog/compilations/{compilationId}/publish",
      "/api/v1/campaigns/{campaignId}/conversions",
    ]) {
      expect(paths).toHaveProperty(required);
    }
    const security = document.components as { securitySchemes: Record<string, unknown> };
    expect(security.securitySchemes).toHaveProperty("acpDetachedSignature");
  });

  it("keeps the ACP fixture parseable and the delegated payment requirement explicit", async () => {
    const fixture = await json("docs/conformance/fixtures/acp-create-session.json");
    const parsed = parseAcpIntent({ items: fixture.line_items, currency: fixture.currency }, { "x-agent-id": "fixture-agent" });
    expect(parsed.ok).toBe(true);
    const document = await json("docs/openapi/agent-commerce.openapi.json");
    const complete = (document.paths as Record<string, { post: { requestBody: unknown } }>)[
      "/api/v1/acp/{merchantSlug}/checkout_sessions/{sessionId}/complete"
    ];
    expect(complete?.post.requestBody).toBeTruthy();
  });

  it("documents AP2 as a compatibility fixture, never verified conformance", async () => {
    const fixture = await json("docs/conformance/fixtures/ap2-compatibility-envelope.json");
    expect(fixture._conformance).toBe("COMPATIBILITY_SHIM_ONLY_NOT_SD_JWT_VERIFIED");
    expect(parseAp2Intent(fixture, {}).ok).toBe(true);
    const document = await json("docs/openapi/agent-commerce.openapi.json");
    const intake = (document.paths as Record<string, { post: Record<string, unknown> }>)[
      "/api/v1/agent-gateway/{merchantSlug}/intents"
    ];
    expect(intake?.post["x-implementation-fidelity"]).toMatchObject({ AP2: "COMPATIBILITY_SHIM" });
  });

  it("keeps x402 v2 challenge fixtures on explicit asset/network/payee fields", async () => {
    const fixture = await json("docs/conformance/fixtures/x402-payment-required.json");
    const accepts = fixture.accepts as Record<string, unknown>[];
    expect(fixture.x402Version).toBe(2);
    expect(accepts[0]).toMatchObject({ scheme: "exact", maxTimeoutSeconds: 60 });
    expect(accepts[0]?.asset).not.toBe("INR");
    expect(accepts[0]?.payTo).toBeTruthy();
  });
});
