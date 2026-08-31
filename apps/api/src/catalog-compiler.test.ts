/**
 * Catalog Compiler + the published discovery documents.
 *
 * The compiler's value is entirely in what it refuses to invent, so these
 * lean on the messy-input cases rather than the happy path.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";
import { prisma } from "./db/client.js";
import { parseCsv } from "./modules/catalog-compiler/service.js";
import { getTestMerchantId, TEST_MERCHANT_EMAIL, TEST_MERCHANT_PASSWORD } from "./test-helpers/test-app.js";

let app: FastifyInstance;
let merchantSlug: string;
let token: string;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  const merchantId = await getTestMerchantId(prisma);
  merchantSlug = (await prisma.merchant.findUniqueOrThrow({ where: { id: merchantId } })).slug;

  const login = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { email: TEST_MERCHANT_EMAIL, password: TEST_MERCHANT_PASSWORD },
  });
  token = login.json().token;
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("CSV parsing", () => {
  it("handles quoted fields containing commas", () => {
    const rows = parseCsv('name,description\n"Shoe, black","Fast, light"');
    expect(rows).toEqual([{ name: "Shoe, black", description: "Fast, light" }]);
  });

  it("handles escaped quotes", () => {
    const rows = parseCsv('name\n"He said ""hi"""');
    expect(rows[0]!.name).toBe('He said "hi"');
  });

  it("ignores blank lines rather than emitting empty products", () => {
    expect(parseCsv("name,price\n\nShoe,100\n\n")).toHaveLength(1);
  });

  it("returns nothing for an empty file", () => {
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("\n\n")).toEqual([]);
  });
});

describe("Catalog Compiler", () => {
  it("normalises messy free text into structured fields", async () => {
    const csv = [
      "Product Name,Category,Price,Notes",
      '"Meridian Pulse Runner — Festive offer!!",Running Shoes,"Rs. 4,499.00","Black, UK9"',
    ].join("\n");

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/agent-catalog/compile",
      headers: { authorization: `Bearer ${token}` },
      payload: { csv },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.rowsRead).toBe(1);
    expect(body.rowsCompiled).toBe(1);

    const product = body.products[0];
    // Marketing noise is not part of a product name.
    expect(product.name).not.toMatch(/festive|offer/i);
    expect(product.category).toBe("Running Shoes");
    expect(product.offers[0].priceMinor).toBe(449900);
  });

  it("reports an unreadable row as an ISSUE instead of inventing values", async () => {
    const csv = ["Product Name,Category,Price", "Mystery Thing,,"].join("\n");

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/agent-catalog/compile",
      headers: { authorization: `Bearer ${token}` },
      payload: { csv },
    });

    const body = res.json();
    const fields = body.issues.map((i: { field: string }) => i.field);
    expect(fields).toContain("priceMajor");
    // A row with no price is still published for discovery, but with NO
    // offer — an agent can see it exists and cannot buy it, which is the
    // truth.
    expect(body.products[0].offers).toHaveLength(0);
  });

  it("requires authentication — compiling spends model calls", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/agent-catalog/compile", payload: { csv: "a\nb" } });
    expect(res.statusCode).toBe(401);
  });

  it("publishes only with explicit cost/inventory controls and rolls back to the prior version", async () => {
    const compile = async (label: string) => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/agent-catalog/compile",
        headers: { authorization: `Bearer ${token}` },
        payload: { csv: `Product Name,Category,Price\n${label},Running Shoes,1299` },
      });
      expect(response.statusCode).toBe(200);
      return response.json();
    };
    const publish = (compilation: { compilationId: string; products: { offers: { sku: string }[] }[] }) =>
      app.inject({
        method: "POST",
        url: `/api/v1/agent-catalog/compilations/${compilation.compilationId}/publish`,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          offers: compilation.products.flatMap((product) =>
            product.offers.map((offer) => ({ sku: offer.sku, costMinor: 70000, availableQuantity: 25 })),
          ),
        },
      });

    const first = await compile(`Imported Alpha ${randomUUID()}`);
    const missingControls = await app.inject({
      method: "POST",
      url: `/api/v1/agent-catalog/compilations/${first.compilationId}/publish`,
      headers: { authorization: `Bearer ${token}` },
      payload: { offers: [] },
    });
    expect(missingControls.statusCode).toBe(400);

    const firstPublished = await publish(first);
    expect(firstPublished.statusCode).toBe(200);
    expect(firstPublished.json().status).toBe("PUBLISHED");
    const firstProductId = firstPublished.json().appliedProductIds[0] as string;
    const firstVariant = await prisma.productVariant.findFirstOrThrow({
      where: { productId: firstProductId },
      include: { inventory: true },
    });
    expect(firstVariant.costMinor).toBe(70000);
    expect(firstVariant.inventory?.availableQuantity).toBe(25);

    const second = await compile(`Imported Beta ${randomUUID()}`);
    const secondPublished = await publish(second);
    expect(secondPublished.statusCode).toBe(200);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: firstProductId } })).status).toBe("ARCHIVED");

    const rollback = await app.inject({
      method: "POST",
      url: `/api/v1/agent-catalog/compilations/${second.compilationId}/rollback`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(rollback.statusCode).toBe(200);
    expect(rollback.json().status).toBe("ROLLED_BACK");
    expect((await prisma.product.findUniqueOrThrow({ where: { id: firstProductId } })).status).toBe("ACTIVE");

    // Restore the catalogue that was live before this test, so a persistent
    // local test database is not left pointing at generated fixture rows.
    const restore = await app.inject({
      method: "POST",
      url: `/api/v1/agent-catalog/compilations/${first.compilationId}/rollback`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(restore.statusCode).toBe(200);
  });
});

describe("Published discovery documents", () => {
  it("serves JSON-LD any agent can read, with no session", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/agent-catalog/${merchantSlug}/.well-known/agent-catalog.json`,
    });

    expect(res.statusCode).toBe(200);
    const doc = res.json();
    expect(doc["@context"]).toBe("https://schema.org");
    expect(doc["@type"]).toBe("ItemList");
    expect(doc.itemListElement.length).toBeGreaterThan(0);

    const first = doc.itemListElement[0].item;
    expect(first["@type"]).toBe("Product");
    expect(first.offers[0]).toMatchObject({ "@type": "Offer", priceCurrency: "INR" });
  });

  /** Never tell the agent internet something is in stock when nobody recorded it. */
  it("omits availability entirely when stock was never recorded", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/agent-catalog/${merchantSlug}/.well-known/agent-catalog.json`,
    });
    const offers = res.json().itemListElement.flatMap((e: { item: { offers: Record<string, unknown>[] } }) => e.item.offers);

    for (const offer of offers) {
      if ("availability" in offer) {
        expect(["https://schema.org/InStock", "https://schema.org/OutOfStock"]).toContain(offer.availability);
      }
    }
    // The seed deliberately leaves some variants with no inventory row at
    // all, so at least one offer must carry no availability claim.
    expect(offers.some((o: Record<string, unknown>) => !("availability" in o))).toBe(true);
  });

  it("publishes an MCP manifest that states the constraints up front", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/agent-catalog/${merchantSlug}/.well-known/mcp-manifest.json`,
    });

    expect(res.statusCode).toBe(200);
    const manifest = res.json();
    expect(manifest.tools[0].name).toBe("submit_purchase_intent");
    expect(manifest.tools[0].endpoint).toContain(`/agent-gateway/${merchantSlug}/intents`);
    expect(manifest.constraints.join(" ")).toMatch(/single-use/i);
    expect(manifest.constraints.join(" ")).toMatch(/compared, never trusted/i);
  });

  it("404s for a merchant that is not published", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/agent-catalog/no-such-merchant/.well-known/agent-catalog.json",
    });
    expect(res.statusCode).toBe(404);
  });
});
