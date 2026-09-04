# TRACK01 PART 16 — obsolete code removal

Continues [Part 0](TRACK01_PART0_FIXES.md) → [Part 15](TRACK01_PART15_PRIMARY_DEMO_VERIFICATION.md).

> Followed by [Part 17](TRACK01_PART17_FINAL_EVALUATION.md), the final scored evaluation — which found that four scored capabilities had never actually been driven.

> Problems hit along the way: [TRACK01_PROBLEMS_LOG.md](TRACK01_PROBLEMS_LOG.md).

Evidence before deletion. The interesting result is how little there was to delete — and that two of the eleven removals were not merely dead but actively hazardous.

---

## What the inventory actually found

Deletion is the dangerous direction, so nothing was removed on suspicion. Four mechanical sweeps over 480 source files:

| Sweep | Result |
|---|---|
| Modules no other file imports | **4** — `server.ts`, `main.tsx`, and the two vitest setup files. All legitimate entrypoints. **Zero orphans.** |
| Route files not wired into `App.tsx` | **0** (only a co-located test file) |
| Nav destinations without a route | **0** |
| Prisma models with no code reference | **0 of 46** |
| Tracked build output / temp / `legacy` / `_old` files | **0** |
| `package.json` scripts pointing at missing files | **0** |

The first pass at unused *exports* returned 535 — and was thrown away, because it counted the public API of `packages/contracts` and `packages/domain` as dead. An unreferenced export in a library is its interface, not an orphan. Narrowing to **runtime values in the apps only** gave 20 real candidates, and checking each against every tracked file (including tests, scripts, docs and OpenAPI) reduced that to **11 genuinely unreferenced symbols**.

Nine of the other twenty were used inside their own file — live code with an unnecessary `export`.

## What was removed, and why each one earned it

### Two that were traps, not spares

**`setPaymentProviderOrderId`** did an unconditional `update({ where: { id } })` to stamp a provider order id onto a payment. The live path deliberately uses a **conditional** claim — `updateMany({ where: { id, providerOrderId: null } })` — so two concurrent initiations cannot both record a provider order against one payment.

Nothing called it. It sat in the repository, next to the functions that are called, looking exactly like the right way to do the thing the codebase does carefully. A duplicate that reintroduces a race the code fixed on purpose is not a spare.

**`useReconcilePayment`** was a second browser path to reconciliation, unused. The UI reconciles through `useRunAgentTool("reconcile_payment")`, which goes via the agent tool registry and **records the action in the ledger with agent attribution**. Two client paths to the same money operation, one bypassing the audit trail, is not redundancy worth keeping.

`POST /payments/:id/reconcile` is untouched — it is the surface the agent tool itself calls.

### One that was a duplicate seam

**`setRateLimitStore` / `getRateLimitStore`.** There were two ways to swap the rate-limit store: this pair, and `createPublicRateLimitHook(customStore)`. Only the second was ever used. The pair also made `activeRateLimitStore` a `let` implying a reassignment that never happened. It is `const` now. **Rate limiting itself is untouched.**

### The rest

`findCartById`, `useCheckoutSession`, `useOrder`, `useBuyerConversation`, `useCreateReturn`, `useCreateFulfillment`, and `formatInr` — unreferenced read helpers, single-item fetchers, and a duplicate money formatter (`formatMoney` is the real one). The POST endpoints behind the two create hooks remain; the UI only advances existing returns and fulfillments, and now says so by not carrying clients it never calls.

### Nine exports narrowed, not deleted

`fingerprintBody`, `toBuyerMessageDTO`, `isPlausibleEd25519Key`, `hashApiKey`, `collectMerchantRevenueEvidence`, `computeMarginBps`, `countAutonomousActionsToday`, `countTargetCustomerPaidOrders`, `sectionIndex` — all used **inside their own file**. Deleting them would break their modules; the `export` keyword was the only unnecessary part, and it widened each module's apparent surface into something other files might depend on.

After this, the apps have **zero exported runtime symbols that nothing references**.

## What was deliberately NOT removed

- **`packages/domain` and `packages/contracts` exports.** A library's unreferenced export is its interface. Judging them by app usage would delete the public API to make a metric look better.
- **The two checkout builders** (`commerce/execution-service.ts` and `gateway/execution-service.ts`). Real duplication, flagged in Part 13, still deliberate: they consume different authorization types and enforce different invariants, and merging two money paths on suspicion is exactly the risk the brief warns about.
- **Every unused exported *type*.** A type costs nothing at runtime and is often a deliberate shape. Removing them would be LOC reduction, which is not the objective.

**Net line change: 85 insertions, 85 deletions.** Most of the insertions are comments recording *why* something was removed — so nobody re-adds the non-atomic setter or the audit-bypassing reconcile client. That is the point: minimal unnecessary complexity, not minimum LOC.

---

## Then the suite broke, and it was not the cleanup

Twenty-six payment tests failed. Rather than guess, `git stash` — **they failed with the changes stashed too.**

Root cause, traced to the row: `Meridian CoolMax Running Socks — S/M` (₹399) had reached **stock 0**. It was the cheap complement that kept the cross-sell basket at ₹4,899, under the merchant's ₹5,000 auto-approval ceiling. With it gone the agent correctly picked a ₹900 bottle, the basket became **₹5,399**, and policy correctly returned `REQUIRE_APPROVAL`.

Nothing was wrong. But `readyCheckout()` read `evalRes.json().authorization.id` directly, so all 26 tests died on `Cannot read properties of null` inside the fixture, pointing at nothing.

### C16-1 · A payments fixture that silently depended on a catalogue price

Those tests are about payment machinery **given an authorized checkout**. Whether policy auto-approves depends on stock that every other test and demo consumes. The fixture now approves when asked, exactly as a merchant would, and no longer depends on a complementary product staying cheap and in stock.

### C16-2 · The suite depletes its own fixture and never restores it

The deeper cause. Every `readyCheckout()` reserves inventory and nothing gives it back, so hundreds of runs across sixteen parts wore the catalogue down until an unrelated assertion broke. **46 of 677 inventory rows were at zero.**

Repaired by re-seeding the local fixture — not by topping up stock by hand, because ~1 in 9 non-Running-Shoes variants is zero **on purpose** as honest out-of-stock evidence the readiness score depends on. After re-seeding: 44 of 647 at zero, the deliberate signal intact.

The re-seed also applied Part 15's `PROMOTABLE_HERO_PRODUCTS` fix for the first time, so Pulse Runner is now seeded `ELIGIBLE` rather than patched into it.

### C16-3 · The database was listening and not working. Again.

Mid-run, twenty-six failures became file-level failures across many suites. Port 5432 `LISTENING`; every query failing. Fourth time in this project, and the recorded lesson held: **a real query is the only proof.** Killed the zombie PID, restarted, verified with an actual `count()` before continuing.

## Verification

Every gate the brief names, after the cleanup:

| Gate | Result |
|---|---|
| Typecheck | clean, 4 packages |
| Lint | clean |
| Unit tests | domain 36 files / 528, web 10 / 69, contracts 2 / 12 |
| Integration tests | **API 51 files / 516** |
| Build | green, 4 packages |
| Real user verification | merchant and buyer journeys driven in the browser |
| Merchant Agent flow | Run a cycle → **3 executed, 0 failed**, honest per-step reporting |
| AI Buyer flow | 5 grounded recommendations → priced ₹3,489.00 → authorized |
| Payment flow | real Razorpay order `order_TXxbI5XcO7Lhkr` → CAPTURED → order PAID → 15 ledger events, activity page showing all nine stages |

One file-level failure (`autonomous-agent.test.ts`) appeared once mid-session and did not recur; run alone it passes 23/23, and the following full run was 51/51. Recorded as transient rather than explained away.
