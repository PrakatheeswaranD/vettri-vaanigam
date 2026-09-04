# TRACK01 PART 11 — intelligent product discovery

Continues [Part 0](TRACK01_PART0_FIXES.md) → [Part 10](TRACK01_PART10_AGENTIC_CHECKOUT.md).

> Followed by [Part 12](TRACK01_PART12_BUYER_AUTONOMY.md), which gave the buyer boundaries the backend enforces and an activity page read from the ledger.

> Problems hit along the way: [TRACK01_PROBLEMS_LOG.md](TRACK01_PROBLEMS_LOG.md).

Discover supports the Buyer Agent rather than competing with it. The comparison now knows which products the buyer named, and what they asked for.

---

## What was already right

Before changing anything, I ran the spec's own worked example against real data. Two of its three steps already passed:

```
"Show running shoes."   → 5 grounded recommendations, real prices
"Only under 3600."      → constraints became
                          ["category = Running Shoes", "budget ≤ ₹3600", ...]
                          0 of the returned products over budget, from 46 candidates
```

**Multi-turn refinement works.** The budget merged with the prior intent rather than replacing it — the category survived, and the filter is genuinely enforced rather than merely recorded. `mergeIntentSignal` was doing its job.

### And there was no duplicate search to fix

The spec asks to fix duplicate search/recommendation implementations and ensure Discover and the Buyer Agent share a source of truth. **They already did:**

```
discoverMarketplace ─┐
                     ├→ listAgentCatalog → listProducts → toAgentReadableProduct
searchCandidateProducts ─┘
```

One query, one filter, one mapper. Verified by reading every caller, not inferred from module names. Reported because claiming a consolidation that did not happen would be worse than reporting nothing.

## The step that was broken

```
"Compare 1 and 3."  → compared FOUR products
```

`classifyBuyerTurn` hardcoded `ordinal: null` on the COMPARE branch. Neither bare digits nor ordinal words were parsed, so every comparison covered whatever the first four candidates happened to be.

**The buyer asked about two products and was answered about four**, in a table that looked entirely plausible. It is the spec's own example, and it was wrong.

### Digits are read for comparing, never for buying

```ts
ordinals: number[]   // "compare 1 and 3" → [1, 3]
```

"Compare 1 and 3" plainly means positions. **"Buy 2" plainly does not** — it means two of something, and reading it as "buy the second" would purchase the wrong product while looking entirely reasonable.

So the bare-digit form is available to COMPARE, which only ever reads, and withheld from every path that spends money. Ordinal *words* ("the first and third") are unambiguous either way and are always read.

Order is preserved too: "compare 3 and 1" puts 3 in the first column, because a buyer reading "Product 1 is cheaper" needs the columns in the order they asked for.

## The comparison now knows what the buyer asked for

`buildComparison` took a list of product ids and nothing else. It laid catalogue fields side by side and left the buyer to remember their own constraints — so it could not answer *"fit to buyer requirements"* at all, and a near-match sat in the table looking identical to an exact one.

It now takes the conversation's own normalized intent:

| | |
|---|---|
| **meets** | requirements this product satisfies, in the buyer's own words — `Running Shoes`, `under ₹5,000` |
| **misses** | requirements it does not |

A requirement the catalogue cannot answer counts as a **miss**. "Not recorded" and "satisfied" are opposite claims, and only one of them is safe to round in the buyer's favour.

Live, from the seeded catalogue:

```json
"fit": [
  { "meets": ["Running Shoes", "under ₹5,000"], "misses": [] },
  { "meets": ["Running Shoes", "under ₹5,000"], "misses": [] }
]
```

## Trade-offs, narrowly

The table marked which rows *differed* and never which option was ahead on any of them. "These two values are different" is not a trade-off.

`lowestIndex` names the cheaper product — and **only on price**, the one row where "lower" is a fact with an order to it:

```json
{ "label": "Price from", "values": ["348900", "469900"], "differs": true, "lowestIndex": 0 }
```

Nothing else is ranked. A tie ranks nothing, because claiming a winner between equal prices would be inventing a difference. And there is deliberately no "which is better" row: the agent already made its recommendation, and a second opinion dressed as a table would hide that it is an opinion.

## No chain-of-thought

The trace carries structured stage facts — `TURN_CLASSIFIED`, `COMPARISON_BUILT`, `CATALOG_FILTERED` — and a test asserts every stage name is a machine token and no detail contains reasoning prose. What the agent *did* is auditable; how a model got there is never persisted.

## Verification

| Check | Result |
|---|---|
| `pnpm typecheck` | clean, 4 packages |
| `pnpm lint` | clean |
| `pnpm build` | green |
| API tests | **49 files, 484 tests** (10 new, running the spec's own example) |
| Domain tests | **36 files, 528 tests** (7 new for ordinal parsing) |
| Web tests | **10 files, 69 tests** |
| Contracts tests | 1 file, 6 tests |

The discovery suite runs the spec's conversation literally — search, refine, compare 1 and 3 — and asserts the compared ids are the first and third the previous turn returned, not merely that two products came back.

## One environment note worth keeping

A full run came back **28 files failed, 268 skipped** — the shape of a total outage. `netstat` showed port 5432 LISTENING, so by the usual check the database was fine.

It was not. The PGlite process had stalled: accepting connections, answering nothing. A restart turned 28 failures into 484 passing tests with no code change.

Part 7 recorded that "listening" and "working" are different facts and I still nearly mis-read it. The check that settles it is a real query, which now runs before every full suite.

## Not verified in a browser

Same as every part since 1. The comparison table's fit cards, miss warnings and "lowest" marker are asserted at the DOM level with `@testing-library/react` — including that the marker appears exactly once across a two-column table — but nothing here is a screenshot.
