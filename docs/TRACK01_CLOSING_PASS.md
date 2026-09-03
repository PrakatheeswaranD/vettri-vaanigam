# TRACK01 — closing pass: the deferred gaps

Continues [Part 0](TRACK01_PART0_FIXES.md) → [Part 6](TRACK01_PART6_AI_READABLE_CATALOG.md).

> Problems hit along the way: [TRACK01_PROBLEMS_LOG.md](TRACK01_PROBLEMS_LOG.md).
>
> Followed by [Part 7](TRACK01_PART7_COMMERCE_OPERATIONS.md), which made Commerce the operational data and action layer.

Not a new part. A pass over everything Parts 0–6 recorded as *deliberately not done*, plus the duplicate and dead code left behind. Every problem hit is in [`TRACK01_PROBLEMS_LOG.md`](TRACK01_PROBLEMS_LOG.md#closing-pass--the-deferred-gaps).

Three deferrals were on the books. Two are closed. One is refused on purpose, and the refusal is stated here rather than quietly dropped.

---

## 1. The scheduled cycle — closed

Parts 3 and 5 both left the agent merchant-triggered, on the grounds that *a scheduler which moves money while nobody is watching is a product decision this build has not asked merchants to agree to.*

That reasoning still holds. So this does not override the decision — it hands it to the merchant.

**Two switches, both off by default.**

| Switch | Whose | Default |
|---|---|---|
| `AGENT_SCHEDULER_ENABLED` | the operator's | `false` |
| `MerchantGrowthConfig.autonomousRunsEnabled` | the merchant's, per merchant | `false` |

Both must be true before one cycle runs unattended. Starting an API against a connected database must never begin acting on merchant data by surprise — the same rule `startRetentionSweeper` already applies to deleting rows — and no merchant is opted in by a deployment.

**Nothing is relaxed.** A scheduled cycle is the same `runAutonomousCycle` a merchant triggers by hand: the same policy engine, the same auto-approval ceilings, the same refusal to execute anything outside them. Unattended means the merchant is not present to press the button, not that the button does more.

Three deliberate choices in [`scheduler.ts`](../apps/api/src/modules/merchant-agent/scheduler.ts):

- **No run on boot.** A deploy is not a reason to act on a catalogue, and a crash-loop would otherwise fire a cycle per restart.
- **Overlapping ticks are skipped, not queued.** A cycle can outlast its interval on a large backlog, and two in flight would race on the per-order recovery-attempt count the policy engine reads.
- **One merchant's failure never stops the others**, and never takes the process down.

The merchant turns it on in Growth → Boundaries, in its own section, described by what changes rather than by the field name.

## 2. `CustomerAccount` — closed

Part 0 called this *the single largest modelling debt* (P0-11) and deferred the schema change as "not worth the migration yet". It was worth it. Here is what the ambiguity had already cost.

### The column that meant two things

A shopper was a `MerchantUser` with role `CUSTOMER` inside a synthetic merchant, and that merchant's id was reused as the partition key for their spending policy and their buyer-agent conversations. So `BuyerConversation.merchantId` held:

- **66 rows keyed by the SHOPPER** — written by `/buyer/messages`
- **8 rows keyed by the SELLER** — written by anything merchant-side

One column. Which meaning applied depended on which route had written the row.

### What it had already broken

The AI Buyer Readiness score's two largest components read that column as the seller:

| Component | Points | Query | Result |
|---|---|---|---|
| `intent_extraction` | 15 | `buyerConversation.count({ where: { merchantId } })` | matched only test leftovers |
| `grounded_recommendation` | 20 | `recommendationRecord.count({ where: { merchantId } })` | **always 0** |

Measured on the demo database: **45 recommendation records had actually recommended this merchant's products. The score counted 0.** A merchant was told their buyer agent had achieved nothing, while it had put their catalogue in front of a shopper 45 times. 35 of the score's 100 points were structurally unreachable.

Nothing threw. Nothing failed a test. The number was plausible and wrong.

### The model now

```
CustomerAccount ──1:1── MerchantUser (role CUSTOMER)
      │
      ├──1:1── BuyerSpendingPolicy
      └──1:N── BuyerConversation
```

**Ids are preserved** from the synthetic merchant each account replaces. `DecisionRecord.protocolActorRef` is a free-form actor reference with no foreign key and already held those values on every historical purchase — so every past purchase still resolves to the right shopper, with no rewrite and no window in which the two disagree.

The sign-in row stays in `MerchantUser`; what moved is the id that buyer-side data is *partitioned* by. `getBuyerContextId()` now returns a real customer id and **throws** for a non-CUSTOMER session rather than falling back to the merchant id — a merchant session reaching `/buyer/*` is a hole in the access model, and quietly handing it a usable partition key is how such a hole stays invisible.

### Attribution, done honestly

Neither table has a column that means "this merchant", and adding one would be a lie: a marketplace conversation routinely spans several merchants' catalogues, or none. The only honest link is the one the recommendation actually made — which **products** it put in front of the shopper, and who owns them:

```sql
EXISTS (
  SELECT 1 FROM jsonb_array_elements_text(rr."recommendedProductIds") AS pid
  JOIN "Product" p ON p."id" = pid AND p."merchantId" = $1
)
```

Both counts now run through that. The merchant sees 45 where they saw 0.

### What the migration caught on the way through

Splitting the identity made the typechecker and the foreign key find things a reader had not:

- **`handleBuyerMessage` had one parameter doing two jobs** — `params.merchantId` owned the conversation *and* scoped the catalogue. Splitting it surfaced four call sites passing a seller where a shopper belonged.
- **The seed created a buyer spending policy owned by a merchant** — dead data no shopper could use and no route could read, because `/buyer/*` is closed to merchant sessions.
- **`experience-access.test.ts` built an identity that both sold and shopped** — a CUSTOMER user inside the seller's own merchant, with nothing else. It had passed for the life of the project.

## 3. Significance testing — refused, on purpose

Part 5 recorded "no significance testing" as not done. It stays not done, and that is the correct answer rather than an omission.

This build does not have the traffic to run a significance test honestly. A p-value computed on a five-subject cohort would dress up noise as a finding — the same fabrication the rest of the engine exists to refuse, and a direct contradiction of the standing instruction not to invent experiments or results. `MIN_COHORT_FOR_LIFT = 5` with the reason stated in plain words is the truthful version of the same information.

Adding the machinery would make the product *less* honest, not more complete.

---

## Fixtures: five suites were a coin flip

Five test files picked their subject with `productVariant.findFirstOrThrow` and **neither an `orderBy` nor a stock constraint**. Which variant the suite tested was decided by physical row order.

It stopped being theoretical during this pass. After a reseed, `customer-negotiation` landed on a zero-inventory variant and **all thirteen assertions failed with `POLICY_DENIED`** — pointing at negotiation code that was entirely correct. The other four suites had simply been lucky.

All seven fixtures now require stock and order by SKU. `acp-surface`, `agent-trust`, `vaanigam-gateway` and `x402-handshake` — 63 tests — still pass, which is the point: the fix removed the coin flip without changing what they assert.

## Removed permanently

| | |
|---|---|
| `.dbdata` (91 MB), `.dbdata-verify` (99 MB) | corrupt PGlite clusters, dead since Parts 0 and 4 |
| `apps/api/dist` (4.1 MB) | stale build output |
| `modules/payments/state.ts`, `modules/policy/types.ts` | pass-through re-exports, zero importers |
| `valueClassificationSchema` import | dead after the `GrowthOpportunity` removal |
| `GrowthOpportunity` table | dropped by `20260902000000_drop_retired_growth_opportunity` |

**194 MB freed.** The working cluster is consolidated back onto the default `.dbdata` path that `scripts/db-server.mjs` expects, so `pnpm db:up` works without an environment override again.

An orphan scan across all 455 source files found nothing else unreferenced.

---

## Verification

Every suite below ran against a **cluster rebuilt from scratch** — migrations, seed, identities — which independently proves the `CustomerAccount` migration applies to an empty database and not only as an in-place backfill.

| Check | Result |
|---|---|
| `pnpm typecheck` | clean, 4 packages |
| `pnpm lint` | clean, 0 warnings |
| `pnpm build` | green, 4 packages |
| API tests | **43 files, 418 tests, all pass** |
| Domain tests | 35 files, 441 tests |
| Web tests | 9 files, 57 tests |
| Contracts tests | 1 file, 6 tests |
| `prisma migrate deploy` | 41 migrations, clean from empty |
| `prisma migrate diff` | no drift on any table this pass touched |

`recovery.test.ts` passes in the full run, which confirms the cycle-cleanup isolation fix: the cycle suites no longer starve the per-order recovery budget that test needs.

### New tests

[`customer-account.test.ts`](../apps/api/src/customer-account.test.ts) — 10 assertions about the *shape* of the model, not a feature. They fail if anyone re-merges the two identities. Two of them pin the readiness-score bug specifically: one asserts the corrected count exceeds the old one (so the test cannot pass vacuously if the fix is reverted), the other asserts both components score above zero in the response a merchant actually receives.

Six scheduler tests in [`autonomous-agent.test.ts`](../apps/api/src/autonomous-agent.test.ts) — including that every seeded merchant is opted **out**, that opting into unattended runs is not a way around the growth master switch, and that the sweep writes real proposals rather than only logging.

## Not verified in a browser

Same as Parts 1–6: signing in to the consoles would mean entering a password, which I do not do. Everything above is verified through the API and the database. The Boundaries page's new control is typechecked and built, but not clicked.

## One thing left, and it is not mine to decide

The landing page is still 2,795 LOC across 16 components — 14% of the frontend and 0% of the product. Part 0 froze rather than removed it, because deleting marketing copy is your call. It remains the largest removable thing in the repository.
