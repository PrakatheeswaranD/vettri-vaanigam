# TRACK01 Part 6 — the catalogue an AI buyer can actually use

Continues [Part 0](TRACK01_PART0_FIXES.md) → [Part 5](TRACK01_PART5_AUTONOMOUS_GROWTH.md).

> Problems hit along the way: [TRACK01_PROBLEMS_LOG.md](TRACK01_PROBLEMS_LOG.md).
>
> Followed by the [closing pass](TRACK01_CLOSING_PASS.md), which closed the deferrals Parts 0–6 left open, then [Part 7](TRACK01_PART7_COMMERCE_OPERATIONS.md).

## What was already right

`AgentReadableProductDTO` is a deliberately separate mapper from the human product DTO — it omits cost price and margin, and adds freshness, provenance and per-product readiness that a human UI does not need. That is not duplication and it stays. `UNKNOWN` is a first-class value throughout: a missing inventory row is published as unknown, never quietly as zero or as available.

## The gap

Of the fields the spec asks a product to expose, three were entirely absent from the AI-readable catalogue:

- **related products**
- **upsell relationships**
- **cross-sell relationships**

The data existed. `ProductRelationship` has 69 rows on this merchant, with four types and a `provenance` column, and the Merchant Agent had been using them since Part 4 to build its candidate set. **An outside buyer agent reading the published catalogue saw every product in isolation** — exactly the information that turns a search into a basket, recorded and not exposed.

Fulfilment information turned out to be the shipping summary, which was already exposed as `policies.shipping`. There is no dispatch-time or carrier data in the schema, so nothing more is claimed.

## Relationships, exposed with provenance

```
relationships: { crossSell[], upsell[], similar[], bundle[] }
```

Grouped on the wire rather than left as a flat list, because an agent that conflates an **upsell** (a substitute) with a **cross-sell** (an addition) offers a replacement where an addition was meant — a smaller basket, not a bigger one.

Each entry carries name, category, price range and availability, so an agent can decide without a second fetch — and **`provenance`**, which is the field that makes *"never invent product facts"* checkable rather than merely promised:

| | Means |
|---|---|
| `MERCHANT_CONFIGURED` | a person asserted this pairing |
| `CATALOG_METADATA` | it came from catalogue structure |
| `SYSTEM_DERIVED` | something inferred it |
| `DEMO_SEED` | fixture data |

Without it every relationship arrives looking equally authoritative. On this merchant's data the seeded pairings correctly report `DEMO_SEED`.

**Targets that are not agent-visible are dropped, not exposed.** A link to a draft product would both leak that it exists and offer an agent something that fails at checkout.

The published JSON-LD emits them too, mapped onto the only two predicates schema.org actually has — `isSimilarTo` for substitutes, `isRelatedTo` for the rest — with the precise internal type and provenance alongside as `additionalProperty`, so nothing is lost at the publishing boundary.

## Catalogue gaps: a count is a diagnosis with no prescription

The console could already say *"12 products lack structured attributes"*. A merchant reading that has learned a number and nothing they can act on: not which twelve, and not what an attribute on those products is supposed to look like.

`GET /catalog/gaps` names them. Seven gap types, ordered by **what blocks an AI buyer hardest** — a product with no purchasable variant cannot be bought at all; a thin description merely ranks badly, and presenting those at equal weight is how a merchant spends an afternoon on copy while their catalogue stays untransactable.

On this merchant: **200 active products, 72 with no gap at all.**

```
NO_PURCHASABLE_VARIANT     17
MISSING_ATTRIBUTES          8   suggests: size, feature, capacity, color, surface…
INCONSISTENT_ATTRIBUTES    65   suggests: size, color, surface, cushioning…
UNKNOWN_INVENTORY          81
MISSING_RETURN_POLICY      19
MISSING_SHIPPING_POLICY    19
```

### Why the suggestion is safe

`suggestedAttributeKeys` is **not generated**. It is the attribute vocabulary the merchant's own products *in the same category* already use, counted and filtered to keys used by at least 30% of that category — below that a key is the category's exception, not its convention, and suggesting it sends a merchant to fill in a field their catalogue does not use.

*"Products in Running Shoes use size, color, surface and cushioning; these eight have none"* is a statement about the merchant's catalogue, checkable against it, true whether or not a model was involved.

So the agent can say precisely what is missing and what shape the answer takes. **It still cannot supply the answer**, because only the merchant knows whether that shoe is a UK9. That is the honest limit of "safe automated catalog improvement": every remaining field is a product fact, and there is no such thing as safely inventing one.

## Duplicate schemas removed

`productRelationshipTypeSchema` and `relationshipProvenanceSchema` were declared in `merchant-agent.ts` for the agent's candidate set. The AI-readable catalogue needed the same vocabulary. Two enums with identical members and no shared definition is the arrangement that eventually disagrees — both now live in `common.ts` and both consumers import them.

The two product mappers were checked and **kept**: human and agent DTOs differ deliberately, and the agent one omitting cost price is a security boundary, not an oversight.

## Verification

| Check | Result |
|---|---|
| `pnpm typecheck` | clean, 4 packages |
| `pnpm lint` | clean |
| `pnpm build` | all 4 build |
| **API** | **42 files pass** on a clean seed — +1: `ai-readable-catalog.test.ts` (12 tests) |
| domain / web / contracts | 35 / 9 / 1 |

[`ai-readable-catalog.test.ts`](apps/api/src/ai-readable-catalog.test.ts) walks the chain the spec names, comparing each layer against the one beneath it:

- every published price and stock quantity **equals the database row**; a missing inventory row publishes as `UNKNOWN`, never as zero
- **cost price never appears** in any agent-facing payload
- every exposed relationship matches a real `ProductRelationship` row, **including its provenance**
- no relationship points at a non-`ACTIVE` product
- upsell and cross-sell stay in their own buckets
- the `.well-known` document is readable **unauthenticated** — discovery has to work before an agent can have a session
- every product handed to the Buyer Agent is `ACTIVE`, belongs to this merchant, and carries the name and category the database holds
- every gap names real products, and **every suggested attribute key exists somewhere in the merchant's own catalogue**

The relationship assertions were checked against real data rather than trusted: 69 relationship rows, a sample product exposing 3 cross-sell + 1 upsell with price, availability and `DEMO_SEED` provenance.

## Not verified in a browser

Same as Parts 1–5: the preview browser has no session and signing in would mean entering a password. The gap panel on Commerce → Products is typechecked and built but not clicked.
