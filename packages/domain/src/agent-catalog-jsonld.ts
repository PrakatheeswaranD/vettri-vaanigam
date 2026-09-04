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

/**
 * A relationship as it will be published.
 *
 * `provenance` travels with it for the same reason it does on the API:
 * a crawler must be able to tell a pairing a person asserted from one a
 * system inferred. schema.org has no field for that, so it is emitted as
 * an `additionalProperty` rather than dropped — losing it at the
 * publishing boundary would make the published catalogue a weaker claim
 * than the API it was compiled from.
 */
export interface CompiledRelationship {
  targetProductId: string;
  targetName: string;
  /** COMPLEMENTARY | UPSELL_ALTERNATIVE | SIMILAR | BUNDLE_COMPATIBLE */
  relationshipType: string;
  provenance: string;
}

export interface CompiledProduct {
  productId: string;
  name: string;
  description: string | null;
  category: string | null;
  brand: string | null;
  offers: CompiledOffer[];
  /** Optional so an older caller compiles unchanged and publishes none. */
  relationships?: CompiledRelationship[];
}

/**
 * schema.org distinguishes only two kinds of product link:
 * `isSimilarTo` for substitutes and `isRelatedTo` for everything else.
 * An upsell alternative IS a substitute; a complementary or bundle
 * product is not. Mapping four internal types onto the two the vocabulary
 * actually has keeps the document valid schema.org rather than inventing
 * a predicate no crawler understands — and the precise internal type is
 * still emitted alongside, so nothing is lost.
 */
function relationshipPredicate(relationshipType: string): "isSimilarTo" | "isRelatedTo" {
  return relationshipType === "UPSELL_ALTERNATIVE" || relationshipType === "SIMILAR" ? "isSimilarTo" : "isRelatedTo";
}

function buildRelationshipNodes(relationships: readonly CompiledRelationship[]): Record<string, unknown> {
  const grouped: Record<string, unknown[]> = {};
  for (const relationship of relationships) {
    const predicate = relationshipPredicate(relationship.relationshipType);
    (grouped[predicate] ??= []).push({
      "@type": "Product",
      "@id": relationship.targetProductId,
      name: relationship.targetName,
      additionalProperty: [
        { "@type": "PropertyValue", name: "relationshipType", value: relationship.relationshipType },
        { "@type": "PropertyValue", name: "relationshipProvenance", value: relationship.provenance },
      ],
    });
  }
  return grouped;
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
    ...(product.relationships && product.relationships.length > 0
      ? buildRelationshipNodes(product.relationships)
      : {}),
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
          required: ["items", "vettri_vaanigam_mandate"],
          properties: {
            items: {
              type: "array",
              items: {
                type: "object",
                required: ["id", "quantity"],
                properties: { id: { type: "string", description: "SKU from this catalogue" }, quantity: { type: "integer", minimum: 1 } },
              },
            },
            vettri_vaanigam_mandate: {
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
