/**
 * JSON-LD and MCP publication for the Catalog Compiler.
 *
 * WHY JSON-LD AND NOT OUR OWN SHAPE
 *
 * An AI buyer agent that has never met this merchant cannot be expected to
 * learn a bespoke format. schema.org `Product`/`Offer` is the vocabulary
 * crawlers and model toolchains already understand, so publishing it is
 * what makes a merchant *discoverable* rather than merely *queryable*.
 *
 * WHY AN MCP MANIFEST TOO
 *
 * JSON-LD describes what exists; it does not tell an agent how to buy. The
 * tool manifest names the one endpoint that accepts a purchase intent and
 * states its constraints, so an agent can go from discovery to a governed
 * purchase without a human integrating anything.
 *
 * HONESTY: `availability` is emitted ONLY from a known stock state. An
 * unknown one is left absent rather than defaulted to InStock — telling
 * the entire agent internet that something is in stock when nobody
 * recorded it is exactly the failure this project refuses elsewhere.
 */

export interface CompiledOffer {
  sku: string;
  priceMinor: number;
  currency: string;
  /** Null means genuinely unrecorded — never assume availability. */
  inStock: boolean | null;
  attributes: Record<string, string>;
}

export interface CompiledProduct {
  productId: string;
  name: string;
  description: string | null;
  category: string | null;
  brand: string | null;
  offers: CompiledOffer[];
}

export interface AgentCatalogDocument {
  "@context": string;
  "@type": string;
  name: string;
  identifier: string;
  itemListElement: unknown[];
}

function toMajorUnits(minor: number): string {
  return (minor / 100).toFixed(2);
}

function availabilityUrl(inStock: boolean | null): string | undefined {
  if (inStock === null) return undefined;
  return inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock";
}

export function buildProductJsonLd(product: CompiledProduct, merchantName: string): Record<string, unknown> {
  return {
    "@type": "Product",
    "@id": product.productId,
    name: product.name,
    ...(product.description ? { description: product.description } : {}),
    ...(product.category ? { category: product.category } : {}),
    ...(product.brand ? { brand: { "@type": "Brand", name: product.brand } } : {}),
    offers: product.offers.map((offer) => {
      const availability = availabilityUrl(offer.inStock);
      return {
        "@type": "Offer",
        sku: offer.sku,
        price: toMajorUnits(offer.priceMinor),
        priceCurrency: offer.currency,
        ...(availability ? { availability } : {}),
        seller: { "@type": "Organization", name: merchantName },
        ...(Object.keys(offer.attributes).length > 0
          ? {
              additionalProperty: Object.entries(offer.attributes).map(([name, value]) => ({
                "@type": "PropertyValue",
                name,
                value,
              })),
            }
          : {}),
      };
    }),
  };
}

export function buildAgentCatalogDocument(
  merchantName: string,
  merchantSlug: string,
  products: CompiledProduct[],
): AgentCatalogDocument {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `${merchantName} — agent-readable catalogue`,
    identifier: merchantSlug,
    itemListElement: products.map((product, index) => ({
      "@type": "ListItem",
      position: index + 1,
      item: buildProductJsonLd(product, merchantName),
    })),
  };
}

export interface McpToolManifest {
  schemaVersion: string;
  name: string;
  description: string;
  tools: {
    name: string;
    description: string;
    endpoint: string;
    method: string;
    inputSchema: Record<string, unknown>;
  }[];
  constraints: string[];
}

/**
 * The manifest deliberately advertises the CONSTRAINTS alongside the
 * endpoint. An agent that knows up front it needs a signed mandate, and
 * that its own stated price will be ignored, can succeed on the first
 * attempt instead of discovering both by being declined.
 */
export function buildMcpToolManifest(merchantName: string, baseUrl: string, merchantSlug: string): McpToolManifest {
  return {
    schemaVersion: "1.0",
    name: `${merchantName} agent commerce`,
    description: `Purchase from ${merchantName} as an AI buyer agent. Accepts ACP, AP2 and x402 purchase intents on one endpoint.`,
    tools: [
      {
        name: "submit_purchase_intent",
        description:
          "Submit a purchase intent. Returns 200 when auto-approved, 202 when a human must approve, 403 when refused — always with a written reason.",
        endpoint: `${baseUrl}/api/v1/agent-gateway/${merchantSlug}/intents`,
        method: "POST",
        inputSchema: {
          type: "object",
          required: ["items", "anumati_mandate"],
          properties: {
            items: {
              type: "array",
              items: {
                type: "object",
                required: ["id", "quantity"],
                properties: { id: { type: "string", description: "SKU from this catalogue" }, quantity: { type: "integer", minimum: 1 } },
              },
            },
            anumati_mandate: {
              type: "object",
              description: "Ed25519-signed spend mandate authorising this purchase.",
              required: ["mandateId", "buyerAgentId", "merchantScope", "maxAmountMinor", "currency", "notBefore", "expiresAt", "nonce", "publicKey", "signature"],
            },
          },
        },
      },
    ],
    constraints: [
      "Every intent requires an Ed25519-signed spend mandate scoped to this merchant.",
      "Mandates are single-use: a replayed nonce is refused.",
      "The merchant prices the basket from its own catalogue. Any price you state is compared, never trusted.",
      "Orders above the merchant's ceiling are not refused — they step up to human approval and return 202.",
      "Every decision, including refusals, carries a plain-English reason.",
    ],
  };
}
