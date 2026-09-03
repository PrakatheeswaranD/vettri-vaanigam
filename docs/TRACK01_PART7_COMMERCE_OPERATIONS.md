# TRACK01 PART 7 — autonomous merchant commerce operations

Continues [Part 0](TRACK01_PART0_FIXES.md) → [Part 6](TRACK01_PART6_AI_READABLE_CATALOG.md) → [closing pass](TRACK01_CLOSING_PASS.md).

> Problems hit along the way: [TRACK01_PROBLEMS_LOG.md](TRACK01_PROBLEMS_LOG.md).
>
> Followed by [Part 8](TRACK01_PART8_GOVERNED_AUTONOMY.md), which made Governance the control system that bounds all of it.

Commerce becomes the merchant's operational data layer **and** the agent's action layer. Four subsections, one source per fact, and the agent's capabilities declared instead of buried in branches.

---

## The rule that shaped everything else

**Growth answers "what should I do?". Commerce answers "what is true right now?".**

Every Commerce row carries an `opportunities` array, and none of it is computed in Commerce. It is `getRevenueOpportunityReport`'s own output, indexed by `subjectIds` and attached to the rows the engine named — `whyDetected`, `priority`, `policyOutcome` and `status` copied verbatim.

That is the whole anti-duplication mechanism, and it is enforced by a test that compares every attached finding field-by-field against the engine's own. If Commerce ever starts *deriving* instead of copying, the test fails.

The same rule settled the Products tab. `GET /catalog/products` already browses, filters and paginates the catalogue; a second product list would have put two copies of every name and price on one screen, free to disagree. So `GET /commerce/products` returns **only what the catalogue does not** — performance, AI-readiness, attached findings — joined by `productId` on the client.

## The four subsections

| | Shows | Source |
|---|---|---|
| **Products** | catalog + performance + AI-readiness | `/catalog/products` (browse) + `/commerce/products` (overlay) |
| **Customers** | observed behaviour + eligible opportunities | `/commerce/customers` |
| **Orders** | order state + revenue + payment state + agent attribution | `/commerce/orders` |
| **Payments** | payment state + recovery opportunities | `/commerce/payments` |

Three things each view refuses to do:

- **No predicted numbers.** Customers have no churn risk, no propensity score, no projected lifetime value. There is no basis for one, and a confident figure without a basis is what the rest of this product refuses to print.
- **Null, never zero-as-unknown.** A product that never sold reports `averageSellingPriceMinor: null`, not `0`. A customer with one paid order reports `medianGapDays: null` — a gap needs two points. "0" and "no data" read identically and mean opposite things.
- **Total is not revenue.** Every order shows `totalAmountMinor` *and* `capturedMinor`. One is what was asked for, the other is what the provider confirmed arriving.

### Attribution is a column, not an inference

`OrderItem.growthProposalId` is written when a line enters a basket because an agent proposal put it there. So "which agent action caused this order" is answered by the row itself, and a test asserts every returned proposal id resolves to a real proposal belonging to this merchant.

Orders arriving via `AGENT_GATEWAY` are labelled **External buyer agent** and are deliberately *not* counted as this merchant's own agent's work. That is somebody else's buyer agent transacting against this catalogue — real agentic commerce, and not something to take credit for.

## The agent tool registry

The agent's capabilities used to exist only as branches inside `runAutonomousCycle`: a `CONSUMPTION` map of `RECOVER | PROPOSE | SURFACE`, with both pipelines inlined. That had three problems.

1. Adding an action meant editing the pipeline.
2. Nothing outside the cycle could invoke one, so reaching a capability the agent already had meant navigating to a screen and doing the work by hand.
3. Nothing could answer *"what can this agent do?"* — not the console, not a merchant, not a test.

[`tools.ts`](../apps/api/src/modules/merchant-agent/tools.ts) is a registry. `GET /merchant-agent/tools` lists it, `POST /merchant-agent/tools/:name` runs one, and the autonomous cycle dispatches through **the same handlers**. A tool that behaved differently depending on who started it would be two tools wearing one name, and the one nobody tests is the one that moves money wrong.

### Two safety classes, and there is no third

| Class | Rule | Tools |
|---|---|---|
| `AUTOMATIC` | Moves no money **and** authors no merchant fact. May only make the record *more* true. No proposal, because there is nothing for a policy to weigh. | `reconcile_payment` |
| `GOVERNED` | Everything else. proposal → policy → approval → authorization → execute, no shortcut, whichever caller started it. | `recover_failed_payment`, `propose_growth_action` |

"Usually doesn't need approval" would be a governed tool with an exception, and the exception is where the money goes missing.

The `CONSUMPTION` map is gone. `toolForOpportunityType` is derived from the tools' own `handles`, so a type cannot be actionable in one list and inert in another — two lists that must agree eventually disagree, and this codebase has shipped that bug twice.

## The bug this part found

**Four payments were in `UNKNOWN` and nothing in the system could see them.**

The Revenue Opportunity Engine filters `state === "FAILED"` and nothing else. A payment in `UNKNOWN` had an attempt made and its outcome never established with the provider — so it was detected by no detector, worked by no cycle, and shown on no screen. Money neither recovered nor written off. It simply sat.

The recovery service *does* reconcile an UNKNOWN payment before evaluating eligibility — but only for a payment something proposed recovery for, and nothing ever did.

`UNVERIFIED_PAYMENT` is now its own opportunity type. Its own, and not a flavour of `FAILED_PAYMENT_RECOVERY`, because **the action differs**: an unknown payment must be *reconciled*, never retried. Retrying an attempt that may already have succeeded is how a double charge happens, and folding the two together would put both under one card whose action is right for only half of it.

It ranks ahead of recovery on ties: money whose outcome nobody has established must be resolved before the same money is retried.

### Why it reports no estimate at all

Every other detector estimates what an action might be worth. This one cannot, and that is the point. The amount is real and recorded — but whether it is *already* the merchant's money is exactly what is unknown. Reconciling might reveal a capture that was always theirs, or a failure that never was. Calling either "expected incremental revenue" would be inventing a payment result.

So `expectedIncrementalValue` is `null`, the basis is `INSUFFICIENT_EVIDENCE`, and the method says why in full.

### Why reconciliation is safe to run unattended

`reconcilePayment` reads from the provider and writes only what the provider reports. Where the provider is ambiguous about which of several settled attempts is authoritative, it **refuses rather than guessing**. It has a cooldown. It moves no money. The worst outcome is that the merchant's record becomes more accurate.

Putting that behind an approval would leave money in limbo waiting for a human to permit asking a question.

## What was removed

| Removed | Why | Traced first |
|---|---|---|
| `MerchantCommercePage.tsx` | Both exports superseded by the new Orders/Customers pages | No importers remained |
| `TransactionsPage.tsx` | Superseded by the Payments page, which adds verification state and the tool affordance | Only a dead lazy import in `App.tsx` |
| `CONSUMPTION` map, `REFUSAL_CODES`, inline `runOne` branches | Moved to the tool registry | The cycle is their only caller |

**Kept after tracing, deliberately:** `/transactions` (still used by `PostPurchasePage`), `RecoveryPanel` (still used by `PaymentPanel`), `GET /catalog/products` (browse/filter/paginate, and `app.test.ts` depends on it), and Post-Purchase as a fifth tab — refunds, returns and disputes are the only way to refund a captured payment from the console, and removing a working page to make a list of four look tidy would be the wrong trade.

## Verification — UI → API → backend → database → agent → result → UI

Measured against the live demo merchant:

```
TOOLS
  reconcile_payment       [AUTOMATIC] reads=PAYMENTS movesMoney=false → UNVERIFIED_PAYMENT
  recover_failed_payment  [GOVERNED]  reads=PAYMENTS movesMoney=true  → FAILED_PAYMENT_RECOVERY
  propose_growth_action   [GOVERNED]  reads=PRODUCTS movesMoney=false → CROSS_SELL, UPSELL, ELIGIBLE_OFFER

OPPORTUNITY → TOOL
  FAILED_PAYMENT_RECOVERY   prio=86  28 subjects → recover_failed_payment
  UNVERIFIED_PAYMENT        prio=81   4 subjects → reconcile_payment      ← previously invisible
  REPEAT_PURCHASE           prio=77   2 subjects → (no tool: for a human)
  ...
PAYMENTS   captured ₹195,537 · 33 failed · 4 unverified, all 4 now carrying a tool
ORDERS     27 paid · 94 agent-attributed · ₹88,182 captured on those
PRODUCTS   performance + readiness + findings, joined by product id
```

| Check | Result |
|---|---|
| `pnpm typecheck` | clean, 4 packages |
| `pnpm lint` | clean, 0 warnings |
| `pnpm build` | green, 4 packages |
| Domain tests | **35 files, 448 tests** (7 new for `UNVERIFIED_PAYMENT`) |
| API tests | **44 files, 432 tests** (13 new in `commerce-operations.test.ts`) |
| Web tests | 9 files, 57 tests |
| Contracts tests | 1 file, 6 tests |

Two runs taken while the machine was under extreme load (2075s and 1371s against a normal 204s) each showed one failure — `merchant-agent.test.ts` once, `policy.test.ts` once. Both pass in isolation, together, and in a clean full run. Recorded here rather than omitted, because a flake that is not written down gets rediscovered as a bug.

### What the new tests actually pin

`commerce-operations.test.ts` — product performance checked against a `groupBy` over the same rows, not merely against itself; captured-vs-total asserted per order against the payment table; every attached finding compared field-by-field with the engine's own output; every attached finding required to be on a row the engine actually named; the whole Commerce surface refused to shopper sessions; a tool nobody registered → 404; a non-OWNER → 403.

The reconcile test states its skip condition as an assertion rather than returning silently, because a green run that exercised nothing is a failure mode this codebase keeps finding.

## Two regressions this refactor caused, and how they surfaced

**`policyOutcome` was computed, used, and dropped.** Extracting the governed pipeline lost the policy decision on the way out, so every step reported `null`. The run log's whole job is to show that a step which executed passed policy first — a null makes that unprovable. Caught by `autonomous-agent.test.ts`, now carried through `ToolRunResult` and pinned by a new test.

**A refusal test assumed every refusal was governed.** It asserted that a `REFUSED` step must have reached `PROPOSED`. True when every action was governed; false once an `AUTOMATIC` tool exists, because reconciliation refusing has nothing to propose. The assertion is now conditional on the tool's declared safety class — and the part that always mattered (a refusal never reaches `EXECUTED`) applies to both.

## Not verified in a browser

Same as Parts 1–6: signing in would mean entering a password, which I do not do. Every path above is verified through the API and the database, and the pages are typechecked and built.
