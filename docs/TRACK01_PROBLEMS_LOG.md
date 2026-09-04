# TRACK01 — every problem hit, Parts 0 through 13 and the closing gap pass

A complete log, including the small ones and the ones I caused myself. Kept in three categories per part, because they need different responses:

- **Product bugs** — defects in the codebase, found and fixed
- **My own mistakes** — things I got wrong while doing the work
- **Environment friction** — tooling and machine problems that cost time but weren't defects

## How this file is maintained

**A part is not finished until its section exists here.** Problems are recorded as they happen during the part, not reconstructed afterwards — reconstruction loses the small ones and the self-inflicted ones, which are the entries most worth having.

When a part adds a section: update the title line above, and add to *Patterns worth naming* at the end if a new pattern has emerged across parts.

---

# PART 0 — audit and fixes

## Product bugs

### P0-1 · `POST /buyer-agent/messages` was 403 for every role — critical
Two independent prefix checks in `auth/middleware.ts` had to agree about which paths belong to a shopper. A CUSTOMER allowlist named `/buyer-agent/conversations/`; a later merchant-side denylist named `/buyer-agent/`. The messages endpoint matched neither the allowlist nor any role surviving the denylist. **The Buyer Agent's only chat endpoint was reachable by nobody.** Nothing failed loudly because the console happened to call a sibling route.

### P0-2 · Duplicate message endpoints
`/buyer/marketplace/messages` and `/buyer-agent/messages` were the same handler differing by one boolean. The frontend picked between them by role.

### P0-3 · Five API test suites red (~35 tests)
`test-app.ts` offered only a **merchant** login helper, and four suites used it to drive customer routes. The moment role separation was enforced they all turned red — not because behaviour broke, but because those tests had never actually been exercising a shopper.

### P0-4 · `GET /buyer/standing` defaulted the seller to the buyer
`merchantId` fell back to the buyer's own context id — a merchant row that sells nothing. The query matched no orders, so **every shopper read as tier NEW** no matter how much they had bought.

### P0-5 · Three lookups filtered a shopper's records by the seller's id
`getRecommendationRecord`, `getConversationIntentSnapshot` and `getRecommendationIntentSnapshot` all scoped by `merchantId`. A `RecommendationRecord` belongs to the shopper; the merchant making a recovery offer is the seller. These returned null for every genuine cross-merchant conversation, so the recovery path silently fell through and the merchant saw *"no relevant growth candidate"* for a shopper who had stated a budget in plain words.

### P0-6 · Agent's candidate window was a browse page size
`discoverMarketplace`'s per-merchant page (20) was reused as the Buyer Agent's candidate set. This catalogue has **46 active Running Shoes**, so the agent could only ever see the first 20 and could refuse a product the merchant genuinely sells.

### P0-7 · `/merchant/commerce-overview` reported wrong money
Four defects in one 55-line inline handler: AOV averaged **all order statuses** over only the **100 most recent** rows; `orderCount` returned `orders.length` and saturated at 100; per-customer LTV summed all statuses; currency was hardcoded `"INR"` in the UI. None of it threw — it produced plausible numbers that disagreed with the Revenue Opportunity Engine.

### P0-8 · Platform admin: 9 endpoints, a provisioned role, zero frontend
`PLATFORM_ADMIN` could be created and could sign in, then landed on a merchant console that refused every request.

### P0-9 · The step-up decision loop had no UI
`GET /agent-gateway/step-ups` and `POST /agent-gateway/decisions/:id/decide` were implemented, RBAC-gated, optimistically locked and tested — and called from nowhere. The most important moment in a governed agentic purchase required curl.

### P0-10 · CI could never have passed the customer suites
`.github/workflows/ci.yml` ran migrate + seed, but the shopper and platform-admin identities come from `provision-demo-identities.ts`, which CI never called.

### P0-11 · Customer identity modelled as a merchant
A shopper is a `MerchantUser` with `role: CUSTOMER` inside a synthetic merchant, so their "merchant id" is a buyer partition key stored in the merchant column. Every customer-side authorization question had to be answered twice — **which is how P0-1 happened.** Fixed at the accessor level; the schema migration is deliberately deferred.

### P0-12 · Two stale tests that were failing on their own merits
- `buyer-agent.test.ts` asserted nothing fits "under ₹5,000", from when the cheapest black UK9 shoe was ₹5,802. The generated families now start at **₹3,490**, so the premise had quietly become false and the assertion was testing the opposite of what it read as.
- `agent-trust.test.ts` used a basket at ₹15,000, which lands just *below* the ~₹18,000 ceiling a caught agent collapses to. Whether it passed came down to how far `Math.ceil` overshot on whatever price the seeded "first Running Shoes variant" happened to have.

### P0-13 · 1,360 LOC of orphaned pages
`DemoTourPage` (651), `ProductDetailPage` (334), `ProtocolsPage` (243), `BreakTheAgentPage` (132) — all unroutable, two of them fronting real tested backends. `ProductDetailPage` turned out **not** to be superseded as first assumed: it's the merchant-side detail view that lost its route when `/catalog/:id` was repointed at the shopper's page.

### P0-14 · Small ones
- Empty directory `apps/web/src/auth/`
- Five untracked `_probe*.ts` scratch scripts in `apps/api/scripts/`
- `apps/api/dist/` stale — still contained a `buyer-agent/providers/` directory deleted from `src`

## My own mistakes

- **Assumed `ProductDetailPage` was superseded** by `CustomerProductPage` on filename similarity. It wasn't — different audience, different endpoint. Caught by reading it before deleting, which is why the "trace before delete" rule exists.

## Environment friction

- `grep -rn "_probe" .` **timed out at 120s** — searching the whole repo including `node_modules`.
- API tests initially failed with *"The table `public.Merchant` does not exist"*: `.env` points `DATABASE_URL` at hosted Supabase while `TEST_DATABASE_URL` points local, and the local PGlite had **0 of 38 migrations** applied.
- `EADDRINUSE` on 127.0.0.1:5432 — a PGlite instance was already running.
- `provision-demo-identities.ts` failed with `prepared statement "s0" already exists`; needed `pgbouncer=true&connection_limit=1` on the URL, the same workaround the vitest setup already applies.
- **`.dbdata` corrupted itself mid-session** — PGlite WASM abort (`Aborted(). Build with -sASSERTIONS`) on every subsequent start. Left the user's directory alone and moved all verification to a fresh `.dbdata-verify`.
- Reading the DB log meant grepping through **581 KB of minified PGlite JavaScript** to find one real error line.
- A probe script in the scratchpad couldn't resolve `@prisma/client` (`ERR_MODULE_NOT_FOUND`); had to live inside `apps/api`.

---

# PART 1 — restructure

## Product bugs

### P1-1 · Four broken links, two predating the restructure
- `ActivityFeed` and `LatestWorkflowStrip` both linked to `/trust-trace` — a top-level route that stopped existing **before** Part 0
- `TrustTracePage` linked to `/break-the-agent` — likewise
- `CatalogPage` linked to `/merchant/catalog/:id` through a template literal the earlier string-replace sweep didn't match

All four typechecked perfectly, because a route path is just a string.

## My own mistakes

### P1-2 · The navigation test took 16 minutes
First version used `import.meta.glob` with `eager: true, query: "?raw"` to scan every source file — pulling ~150 modules through Vite's transform pipeline. **Duration: 957.78s**, almost all in setup. Rewrote it as a filesystem walk: **3.8s**. A test nobody will wait for is a test that gets deleted.

### P1-3 · Wrote literal backspace bytes into a source file
Python heredoc escaping turned `\b` (regex word boundary) into byte `0x08` in `navigation.test.tsx`. ESLint caught it as `no-control-regex`. Took **three attempts** to fix — `sed`, then Node string replace, both of which re-introduced it — before writing a Node script that did a byte-level substitution.

### P1-4 · The link scanner initially missed the thing I'd just built
The first version matched only JSX `to="..."` attributes, not object literals `{ to: "...", label }` — which is exactly how `SectionTabs` declares tab targets. So the one navigation surface the restructure *introduced* was the one surface the test didn't check.

### P1-5 · Left dead code behind twice
Unused imports and bindings after extractions: `BarChart3` and a whole `Metric` helper in `MerchantCommercePage`; `Link`, `RevenueOpportunityDTO` and a `recovery` binding in `GrowthOpportunitiesPage`. Caught by lint, not by me.

## Environment friction

- `python3` isn't on PATH on this machine — only `python`. One script failed with a Microsoft Store redirect message.
- A `pnpm test` run reported `ELIFECYCLE` alongside "36 passed"; transient, caused by the DB restarting mid-run while `pnpm --recursive` ran packages in parallel. A direct re-run was clean.

---

# PART 2 — Overview command center

## Product bugs

### P2-1 · `useMerchantStats` orphaned
Zero consumers after the rebuild. Its counts had moved to Commerce's summary strip.

### P2-2 · No `VERIFIED` value class existed
The vocabulary had OBSERVED / ESTIMATED / OPPORTUNITY, and the Prisma enum has exactly those three. Provider-confirmed money on an agent-proposed order needed its own class — added at the **presentation layer only**, because no `GrowthOpportunity` row can ever be verified.

## My own mistakes

### P2-3 · Misread my own broken fixture as an app bug
The Overview render test emitted `Warning: Each child in a list should have a unique "key" prop` from `CompositeScorePanel`. I initially wrote it up as a real defect. It wasn't — my fixture used `{id, score, weightBps, detail}` when the real `ScoreComponent` is `{key, label, earned, max, evidence, toImprove}`. The component was fine; my test data was wrong.

### P2-4 · Three over-strict assertions
Used `getByText` for amounts that legitimately appear twice — the totals tile *and* the opportunity card that produced it. Correct behaviour, wrong assertion.

### P2-5 · Forgot to rebuild contracts
`apps/api` typecheck failed with `'recoveredValue' does not exist in type ...` because the contracts package hadn't been rebuilt after the schema change. Wasted a cycle.

## Environment friction

- The Analytics page appeared to render **no metric tiles at all** in the browser. It was just slow — the dev server points at hosted Supabase and the query took ~8 seconds. Nearly logged as a bug.
- **The browser profile reset and the session token was gone.** I can't sign in — entering a password is prohibited — so the authenticated walkthrough couldn't be completed. This recurred in Parts 2 and 3.

---

# PART 3 — autonomous agent

## Product bugs

### P3-1 · `REQUIRE_APPROVAL` vs `REQUIRES_APPROVAL` — the worst of the four
The `PolicyDecision` enum is **singular**. My comparison used the plural, so every needs-a-human proposal fell into the BLOCKED branch and the agent told merchants *"Your policy refused this action outright"* when it was in fact **waiting for them to approve it**. Found by running a cycle against real data and reading the output — not by any test.

### P3-2 · Acted on 1 of 80 payments and reported the cycle complete
The engine aggregates: one `FAILED_PAYMENT_RECOVERY` card covers 80 payments on this merchant's data, which is the right way to *show* the problem and the wrong unit to *act* on. Taking `subjectIds[0]` left 79 recoverable payments untouched while the run reported success.

### P3-3 · Guardrail refusals counted as crashes
`executeRecovery` refusing because the order moved on, or the authorization was already consumed, is the system protecting the merchant's money. Reporting it as `FAILED` makes a working safeguard look like an outage — and buries a real outage among them.

Same data, before → after all three fixes:

```
{executed:0, awaitingApproval:0, blocked:1, refused:1, failed:1}   ← bugs
{executed:2, awaitingApproval:1, blocked:0, refused:2, failed:0}   ← fixed
```

### P3-4 · `EXECUTED` is not a proposal status
Typecheck error. A `GrowthActionProposal`'s lifecycle ends at `AUTHORIZED`; whether the authorization was consumed lives on the order, payment and ledger. Reporting `AUTHORIZED` as "executed" would have overclaimed.

## My own mistakes

### P3-5 · Wrote a latent wrong assertion into my own test
An earlier test asserted `policyOutcome === "REQUIRES_APPROVAL"` (the plural). It **passed** — only because that branch wasn't hit in that run, since recovery attempts had been exhausted. Spotted it while reading the file back and fixed it before it could flake.

### P3-6 · The first test run passed vacuously
14/14 green, and the cycle had executed **nothing** — every step refused because prior runs had exhausted the per-order recovery-attempt cap. Green tests proved the loop didn't crash, not that it worked. Only a manual probe against real data revealed P3-1 and P3-2. **This is the one I'd flag hardest**: I nearly shipped a broken autonomous agent behind a passing suite.

### P3-7 · Forgot an import, again
`moneySchema` not imported in `merchant-agent.ts` contracts. Same class of slip as P2-5.

## Environment friction

- Repeated cycles exhaust the per-order recovery cap (max 2), so later runs return all-REFUSED. Correct behaviour, but it makes repeated verification progressively less informative — the reason P3-6 was easy to miss.
- The full `pnpm test` exceeded the 600s tool timeout twice and had to be backgrounded.
- The background DB server was killed several times when tool calls were interrupted, each time needing a restart before tests could run.

---

# PART 4 — opportunity engine

## Product bugs

### P4-1 · `UPSELL` was a declared category with no detector
It sat in `REVENUE_OPPORTUNITY_TYPES`, `upsellEnabled` sat in the evidence, `OFFER_TARGETED_UPSELL` sat in the action vocabulary — and nothing ever produced one. A dead enum value that read as a shipped feature from every angle except the one that mattered.

### P4-2 · Products no AI buyer can see were detected by nothing
Every product-facing detector filtered on `agentVisible: true`, **including the readiness detector**. An unpublished product was therefore invisible to the engine as well as to buyers — a whole class of catalogue producing nothing and being reported by nothing.

### P4-3 · The approval threshold was compared against the aggregate
One recovery card covers 80 payments. The code compared their **sum** against the merchant's *per-order* auto-approval ceiling. Any sane ceiling loses that comparison, so the card said "needs your approval" for work the agent was — at that very moment, in Part 3's cycle — executing entirely on its own. Two screens contradicting each other about the same decision.

Same shape as P3-2: **aggregation for display is the wrong unit for a decision.**

### P4-4 · `effort` was hardcoded on the recovery detector
Fixed at `ONE_APPROVAL`, so the one opportunity type the agent can genuinely complete end to end was the one advertised as needing a human. Untested — no existing test asserted it, which is why it survived.

### P4-5 · Opportunities had no status or result
Recomputed from live rows on every read, so the same card reappeared identically after the agent had already acted. A merchant could not tell "nothing has happened here" from "this is done".

### P4-6 · The agent consumed one detection in nine
Part 3 wired `FAILED_PAYMENT_RECOVERY` end to end. The other eight were computed, ranked, rendered — and left for a merchant to discover by hand, which is precisely what the engine exists to prevent.

### P4-7 · One card starved every other
Extending the agent to all consumable types made the work list 135 items, and a flat slice of a priority-ordered list spent the whole cycle inside the top card. Cross-sell, upsell and offer opportunities would have been detected forever and acted on never. Fixed with round-robin selection.

**This bug was created and found inside the same hour** — it only existed because of P4-6's fix, and only showed up because I ran a real cycle and read the output rather than trusting the tests.

### P4-8 · `GatewayDecisionFeed` had been dead since Part 1
Orphaned when Part 1 deleted `ActivityPage`. My Part 1 orphan sweep only covered `routes/`, not `components/` — so it sat unreferenced through two whole parts.

## My own mistakes

### P4-9 · A regex retyped the function it was not meant to touch
`function (detect[A-Za-z]+)\(evidence: ...\): RevenueOpportunity\[\]` also matched the exported orchestrator `detectRevenueOpportunities`, changing its public return type to `OpportunityDraft[]` and breaking every caller. Caught by typecheck immediately, but a sharper pattern would not have needed catching.

### P4-10 · Heredoc quoting broke a script mid-write
A `cat > file <<'EOF'` block containing backticks and quotes died with `unexpected EOF while looking for matching quote`. Third time this session that shell quoting has eaten an edit (see P1-3). Switched to writing the script with the Write tool and running it with Node, which is what I should have done after the first one.

### P4-11 · Assumed CRLF was LF
Two edit scripts failed with "anchor not found" against a file whose line endings are CRLF. Now normalise to LF, edit, and restore the file's own ending.

### P4-12 · Wrote a test that only checked three of four subject kinds
`opportunity-engine.test.ts` asserted every `subjectId` resolves to a payment, order or product — and `REPEAT_PURCHASE` subjects are **customer** ids. My test, not the engine. It did surface something worth knowing though: customer-subject cards can never reach `ACTIONED`, because no proposal is keyed by customer. That is correct — they are `SURFACE` types — and is now commented.

## Environment friction

### P4-13 · `.dbdata-verify` corrupted itself, exactly like `.dbdata` did in Part 0
Same PGlite WASM abort (`Aborted(). Build with -sASSERTIONS`). **Two clusters lost in one session.** Rebuilt on `.dbdata-p4`: migrate, seed, provision — about six minutes of the run.

### P4-14 · A full-suite run reported 24 failures that were entirely the database being down
The PGlite server had died again mid-run. Nothing was wrong with the code. Checking DB liveness is now the first thing worth doing when a large number of suites fail at once.

### P4-15 · One suite fails on a dirty database, passes on a clean one
`recovery.test.ts` failed in one full run and passed in isolation, and passed again on a freshly-seeded database — **40/40**. The cause is real and worth naming: my autonomous-cycle tests consume the per-order recovery budget that `recovery.test.ts` also draws on, so re-running the suite locally without re-seeding can starve it.

CI always starts from a fresh seed, so CI is unaffected. A developer re-running locally is not. The honest fix is for the cycle tests to work against their own merchant rather than the shared demo one — deliberately not done here, because manufacturing a second fully-populated merchant is a larger change than the problem justifies, and the failure is loud rather than silent.

**Fixed in the closing pass**, more cheaply than a second merchant: `cycle-cleanup.ts` records the proposal ids each cycle reports and removes exactly those rows.

---

# PART 5 — autonomous growth

## Product bugs

### P5-1 · The only real control group in the product was invisible
`cohortFor()` hash-buckets every campaign subject into CONTROL or TREATMENT before any offer is made, and `GET /campaigns/:id/metrics` already returned both cohorts. **Nothing ever compared them.** No screen rendered it, no code read it back. Every other surface carefully says *provenance, not attribution* — correctly — while the one place that could honestly claim causation sat unused.

### P5-2 · Growth boundaries were read-only
`GET /merchant-agent/growth/config` existed; no write path did, and no UI. The product's premise is "the merchant sets the boundaries and the agent works inside them", and the boundaries could not be set. Silent, because a read-only config renders perfectly.

### P5-3 · `ELIGIBLE_OFFER` would have withheld its estimate forever
Its stated reason was *"no recorded history of offer-driven conversion"* — true, and permanently true, because nothing fed measured lift back in. The refusal was honest but the loop was open at the end.

## My own mistakes

### P5-4 · Wrote a test payload against a schema I had not read
`POST /campaigns` takes `startsAt`/`endsAt`; I sent `durationDays` because that is what the *form component* uses in its local state. Then asserted `200` where the endpoint correctly returns `201`. Two round trips to learn what one `sed -n` of the schema would have told me first.

## Environment friction

None new. The `.dbdata-p4` cluster from Part 4 held up throughout.

---

# PART 6 — AI-readable catalog

## Product bugs

### P6-1 · Product relationships were recorded and never published
69 `ProductRelationship` rows with four types and a provenance column, used by the Merchant Agent since Part 4 to build its candidate set — and absent from the AI-readable catalogue entirely. An outside buyer agent reading the published document saw every product in isolation, which is precisely the information that turns a search into a basket.

The sixth instance of *capability shipped, consumption forgotten*.

### P6-2 · Duplicate relationship enums in two contract files
`productRelationshipTypeSchema` and `relationshipProvenanceSchema` were declared in `merchant-agent.ts`. Adding them to the catalogue contract would have made a second copy — the typechecker caught the collision immediately, which is the only reason it did not become one. Both moved to `common.ts`.

### P6-3 · The catalogue-gap report was a count with no prescription
The console could say "12 products lack structured attributes" and nothing more — not which twelve, not what an attribute on them should look like. A number a merchant cannot act on.

## My own mistakes

### P6-4 · Guessed a function name instead of reading the module
Wrote `collectCatalogEvidence(...)` and `evidence.products` in the gap service from memory. The real exports are `analyzeCatalog(...)` and `evidence.perProduct`. Typecheck caught it in one pass, but reading the module first would have cost less than the fix.

### P6-5 · Wrote a test with three silent early-return guards
`if (!productId) return;` on the relationship tests — correct defensive style, and it means the suite reports 12 green whether or not those assertions ran at all. Only a manual probe (69 rows, 3 cross-sell + 1 upsell, `DEMO_SEED` provenance) proved they were exercising anything.

This is the second time in the project a suite could have passed vacuously — see P3-6, where a 14/14 green run had executed nothing.

## Environment friction

None new.

---

# CLOSING PASS — the deferred gaps

Not a new part. A pass over everything Parts 0–6 named as *deliberately not done*, plus the duplicate and dead code left behind. Two of the three deferrals are now closed; the third is refused on purpose and the refusal is restated below rather than quietly dropped.

## Product bugs

### PC-1 · `BuyerConversation.merchantId` meant two different things at once
66 rows keyed by the SHOPPER (written by `/buyer/messages`) and 8 keyed by the SELLER (written by anything merchant-side), in one column, on one table. Which meaning applied depended on which route had written the row.

This is the debt Part 0 named as P0-11 and deferred. It was not a tidiness problem: see PC-2.

### PC-2 · The AI Buyer Readiness score reported zero on 35 of its 100 points, structurally
`intent_extraction` (15 pts) counted `buyerConversation.count({ where: { merchantId } })` and `grounded_recommendation` (20 pts) counted `recommendationRecord.count({ where: { merchantId } })` — both with the SELLER's id, against tables whose rows are filed under the SHOPPER.

Measured on the demo database: **45 recommendation records had actually recommended this merchant's products. The score counted 0.** A merchant was told their buyer agent had achieved nothing while it had recommended their catalogue 45 times.

Neither table has a column that means "this merchant", and inventing one would be wrong — a marketplace conversation routinely spans several merchants' catalogues. The honest link is the one the recommendation actually made: which PRODUCTS it put in front of the shopper, and who owns them. Both counts are now raw SQL joining `recommendedProductIds` to `Product.merchantId`.

A count that can only ever return zero is worse than a missing metric, because it reads as an answer.

### PC-3 · The seed created a buyer spending policy owned by a merchant
`buyerSpendingPolicy.create({ data: { merchantId: merchant.id, ... } })`. No shopper could use it and no route could read it — `/buyer/*` is closed to merchant sessions. Dead data that existed only because the column accepted a merchant id.

### PC-4 · `handleBuyerMessage` had one parameter doing two jobs
`params.merchantId` owned the conversation AND scoped the catalogue. It worked only because a shopper was filed under a merchant, so one id was legal for both. Split into `customerAccountId` and `merchantId`; the typechecker then found all four call sites that had been passing a seller where a shopper belonged.

### PC-5 · Five test fixtures picked their subject with no ordering and no stock clause
`productVariant.findFirstOrThrow` with neither `orderBy` nor an inventory constraint, across `customer-negotiation`, `acp-surface`, `agent-trust`, `vaanigam-gateway` and `x402-handshake`. Which variant the suite tested was decided by physical row order.

It stopped being theoretical: after a reseed, `customer-negotiation` landed on a zero-inventory variant and **all thirteen assertions failed with `POLICY_DENIED`** — for a reason with nothing to do with negotiation. The other four had simply been lucky. All seven fixtures now constrain stock and order by SKU.

### PC-6 · Two vestigial pass-through modules with no importers
`modules/payments/state.ts` (8 lines) and `modules/policy/types.ts` (13 lines) re-exported from `@razorgrowth/domain` and `@prisma/client`. The second documented a policy engine "implemented in a later part" that had since been built elsewhere. Removed.

### PC-7 · A dead import survived the `GrowthOpportunity` removal
`valueClassificationSchema` in `contracts/src/growth.ts`, unused once the retired schemas went. Caught by lint, not by the typechecker.

## What was closed, and what was refused

**Closed — the scheduled cycle** (Part 3 and Part 5 both deferred it). Two switches, both off by default: `AGENT_SCHEDULER_ENABLED` for the operator and `autonomousRunsEnabled` per merchant. The original reasoning — that a scheduler moving money unwatched is a decision merchants had not been asked to agree to — is not overridden; the decision is handed to the merchant instead. A scheduled cycle is the same `runAutonomousCycle`, with the same policy engine and the same approval ceilings.

**Closed — `CustomerAccount`** (Part 0 P0-11, called "the single largest modelling debt"). Ids are preserved from the synthetic merchant each account replaces, so `DecisionRecord.protocolActorRef` — a free-form reference with no foreign key — keeps resolving to the same shopper with no rewrite and no window where the two disagree.

**Refused — significance testing** (Part 5). This build does not have the traffic to run one honestly, and a p-value on a five-subject cohort would dress up noise as a finding. That is the same fabrication the rest of the engine exists to refuse, and it contradicts the standing instruction not to invent experiments or results. The stated sample floor remains the truthful version. Refusing this is a decision, not an omission.

## My own mistakes

### PC-8 · A regex rewrote a function into calling itself
Repairing the cycle-cleanup wiring, my replacement produced `const runCycle = async () => cycles.track(runCycle());` and stripped `await` from every call site. Two follow-up scripts to undo one.

### PC-9 · Asserted the opposite of the design I had just chosen
Wrote `expect(merchant.count({ where: { id: customerAccountId } })).toBe(0)` — while the whole point of preserving ids is that the identity-context merchant row still exists. My assertion, not the code, was wrong. Replaced with what actually matters: the id must never own products or orders.

### PC-10 · Guessed a route path instead of grepping for it
Asserted against `GET /api/v1/growth/scores`. No such route; the score rides on `/growth/revenue-opportunities` as `aiBuyerScore`. Third time in the project I have written a call against an interface I had not read — see P4-9, P6-4.

### PC-11 · Made the seed non-idempotent
Moved the spending policy from `merchantId` to `customerAccountId` but left it a `create`. The seed's reset clears the demo MERCHANT's rows; the policy now belongs to the demo SHOPPER, who survives that reset — so a second run collided on the unique account. Changed to an upsert.

### PC-12 · Asserted an exact zero that my own test runs had made non-zero
`expect(byOwnerColumn).toBe(0)` — but `buyer-agent.test.ts` writes recommendation records against the real seller, so it was 2. Brittle for no gain; what matters is that the corrected count *exceeds* the old one, which is now the assertion.

## Environment friction

### PC-13 · A third PGlite cluster corrupted itself
Same `Aborted(). Build with -sASSERTIONS` WASM abort that took `.dbdata` in Part 0 and `.dbdata-verify` in Part 4. **Three clusters lost in one project.** Rebuilt from migrations + seed + identities, which had the one silver lining of proving the `CustomerAccount` migration applies cleanly to an empty database and not only as an in-place backfill.

Also two dropped connections (`P1017`, `Can't reach database server`) that looked like code failures and were not. The rule from Part 4 held again: **check the database is alive before reading anything into a failure.**

### PC-14 · 190 MB of corrupt database directories still on disk
`.dbdata` (91 MB) and `.dbdata-verify` (99 MB), both dead since Parts 0 and 4, plus a stale 4.1 MB `apps/api/dist`. Deleted, and the working cluster consolidated back onto the default `.dbdata` path that `scripts/db-server.mjs` expects — so `pnpm db:up` works without an environment override again.

---

# PART 7 — commerce operations

## Product bugs

### P7-1 · Four payments sat in `UNKNOWN` that nothing in the system could see
The Revenue Opportunity Engine filters `state === "FAILED"` and nothing else. A payment in `UNKNOWN` had an attempt made and its outcome never established with the provider — detected by no detector, worked by no cycle, shown on no screen. **Money neither recovered nor written off.** It simply sat.

The cruel part: the recovery service *already* reconciles an UNKNOWN payment before evaluating eligibility. But only for a payment something proposed recovery for, and nothing ever did. A working safeguard, unreachable.

Fixed as `UNVERIFIED_PAYMENT` — its own opportunity type, not a flavour of `FAILED_PAYMENT_RECOVERY`, because the action differs: an unknown payment must be RECONCILED, never retried. Retrying an attempt that may already have succeeded is how a double charge happens.

### P7-2 · `OrderItem` has no `productId`, and I wrote three queries assuming it did
An order line references a VARIANT. The only join from a sale back to a product runs through `ProductVariant.productId`. Caught by the typechecker in one pass, but it invalidated the whole product-performance query design.

### P7-3 · I claimed in a contract comment that order→proposal attribution was impossible
Wrote, in prose, that `GrowthActionProposal` records the order it was raised FROM and never the order it produced, "so there is no honest join". Then the same typecheck error surfaced `OrderItem.growthProposalId` — a recorded column that answers exactly that question.

The comment was confidently wrong and would have justified a permanently null field to every future reader. **A stated impossibility is a claim, and it needs checking like any other.**

### P7-4 · The agent's capabilities existed only as branches
A `CONSUMPTION` map of `RECOVER | PROPOSE | SURFACE` with both pipelines inlined in `runOne`. Nothing outside the cycle could invoke an action, and nothing could answer "what can this agent do?" — not the console, not a merchant, not a test. A merchant was asked to switch on unattended runs with no way to see what unattended runs were permitted to do.

Replaced with a registry. `toolForOpportunityType` is derived from the tools' own `handles`, so the SURFACE class disappears as a concept: a type maps to a tool or it does not, and there is one answer rather than two lists that must agree.

## My own mistakes

### P7-5 · I overwrote an existing file with `Write`
`apps/web/src/hooks/use-commerce.ts` already existed with `useExecuteCheckout`, `useCheckoutSession` and `useOrder`. I wrote a new file at that path and destroyed all three. The typechecker caught it immediately and `git show HEAD:` recovered them, but nothing about my process would have caught it — I never checked whether the path was occupied.

**The rule: `Write` on a path I have not read is a delete.** The tool result even said "has been updated successfully" rather than "created", which was the tell I did not read.

### P7-6 · Extracting the pipeline silently dropped the policy decision
`policyOutcome` was computed inside `governedPipeline`, used to branch, and then not returned. Every step reported `null`. The run log's whole job is to show that a step which executed passed policy first — a null makes that unprovable, and it is exactly the kind of loss that looks like nothing until an auditor asks.

Caught by `autonomous-agent.test.ts`, which had asserted `policyOutcome === "ALLOW"` on authorized steps since Part 3. **The test that caught it was written two parts earlier for a different reason.**

### P7-7 · A test's assumption expired under a new safety class
`autonomous-agent.test.ts` asserted every `REFUSED` step had reached `PROPOSED`. True while every action was governed; false the moment an AUTOMATIC tool existed, because reconciliation refusing has nothing to propose.

Updating a test to match new behaviour is where a real regression gets waved through, so the change was made narrowly: the part that always mattered — a refusal never reaches `EXECUTED` — now applies to *both* classes, and the `PROPOSED` assertion is conditional on the tool's declared safety rather than removed.

### P7-8 · I nearly shipped a second product list
`GET /commerce/products` originally returned name, category, price and availability — all of which `GET /catalog/products` already returns. Two copies of every product on one screen, free to disagree the moment either endpoint changed. Caught while tracing dependencies before deleting anything, which is the only reason it was caught at all.

Rewritten as an overlay carrying ONLY what the catalogue does not: performance, readiness, attached findings, joined by `productId`.

### P7-9 · A new domain field broke 44 tests at once
Adding `unverifiedPayments` to `MerchantRevenueEvidence` made `detectUnverifiedPayments` read `undefined.filter`. One shared fixture builder, one line to fix — but the failure surfaced as 44 identical `Cannot read properties of undefined` errors, which reads like a catastrophe and is a missing default.

### P7-10 · Shell escaping, again
Two `node -e` scripts died on `\n` inside single-quoted shell strings, and one on a backtick inside a template literal. Third and fourth occurrences in this project. The fix each time was the same one that has never failed: write the script to a file, run it with Node — or use the Edit tool for a single anchored change.

## Environment friction

### P7-11 · The machine slept mid-verification
A backgrounded full API run was killed. Nothing was lost but time; the lesson from Part 4 held again — **check the database is alive AND responding before reading anything into a failure**, because "listening" and "working" are different facts. A `netstat` hit plus a real query is the check.

---

# PART 8 — governed autonomy

## Product bugs

### P8-1 · Six of the nine automation boundaries had no enforcement
The spec names nine boundaries a merchant must be able to set. Three existed and were enforced. The other six either did not exist at all — **margin floor, daily action limit, eligible customers** — or existed in `MerchantGrowthConfig`, a table the Policy Engine never read AS POLICY: `prohibitedActions` was a set of per-type booleans in growth configuration, `recoveryEnabled` was inferrable only from a retry count of zero, and there was no category allow-list anywhere.

Two tables, one concept, one of them consulted by the thing that enforces. **A column nothing reads is indistinguishable from a control that works, right up until it matters.**

All six are now in `MerchantPolicy` and evaluated by `evaluatePolicy` — the pure function the API calls before anything executes.

### P8-2 · The lifecycle had no terminal states
`GrowthProposalStatus` ended at `AUTHORIZED`. Part 5 documented this as deliberate: execution outcome lives on the rows execution writes, and duplicating it would create a second financial truth.

That reasoning holds for the AMOUNTS and does not hold for the STATE. With no terminal status, **an authorization that was issued and then failed was indistinguishable from one still waiting to run.** "What did the agent actually do" could not be answered from the governance rows at all — it had to be reassembled by joining out to whatever each action type happened to write.

`EXECUTED`, `VERIFIED` and `FAILED` now exist and record WHAT HAPPENED, never how much money moved. `VERIFIED` means the row execution claimed to write was read back and exists.

### P8-3 · Governance presented six equally-weighted tabs
Decisions, Approvals, Policies, Trace, Ledger, Sandbox. A merchant asking "is this agent safe" needs three things in order — what may it do, what is it asking me, what has it done — and four of the six were different depths of the third question wearing their own tab.

Cut to three. Nothing was deleted: every route still resolves and every page is still reachable, because a tab bar is a claim about what matters most, not an inventory.

## My own mistakes

### P8-4 · My bypass suite tested the wrong guardrail and would have passed
The fixture picked "a product with a purchasable variant", got one with **no product relationship**, and so `proposeGrowthAction` returned `REJECTED_VALIDATION` with a null action type. Three tests then exercised *"a proposal that was never valid"* while their names claimed they exercised *"a proposal policy denied"*.

Those are different guardrails and only one was under test. The suite reported failures loudly enough that I found it — but had my accepted-status list been one entry wider, all three would have gone green while proving nothing about policy.

**Fourth vacuous-test near-miss in this project** (see P3-6, P6-5, and pattern 2). The fix requires a product with a relationship, and every skip is now an explicit `expect(outcome).toBe("ran")` rather than a silent `return`.

### P8-5 · I read a response shape I never checked
Asserted `evaluated.json().outcome` at five call sites. `POST /policy/evaluate` returns `{ decision: { outcome, ... } }`. Every one read `undefined`.

Same class as P7-10 (guessed a route path) and P6-4 (guessed a function name). **Third time: I keep writing against interfaces I have not opened.** The cost is small each time and the pattern is not.

### P8-6 · I asserted a weaker refusal than the code actually gives
Expected `[200, 409, 422]` from issuing an authorization on an unevaluated proposal. The server returns **403 `AUTHORIZATION_NOT_ALLOWED`, "can never be authorized"** — a stronger and more specific refusal than I had allowed for. My test failed because the guardrail was better than my assumption about it.

Worth recording because the instinct on seeing it was to widen the accepted list, which would have made the test accept any 4xx and therefore assert almost nothing. It now asserts the specific status and code.

### P8-7 · A new domain field broke 44 tests, again
Adding six fields to `MerchantPolicyConfig` made `policy.prohibitedActions.includes` read `undefined`. One shared fixture builder, one edit — but it surfaced as 44 identical `Cannot read properties of undefined` failures.

**Second time in two parts** (P7-9). The fixture defaults are deliberately PERMISSIVE so every pre-existing assertion still tests what it was written to test, with each new boundary overriding exactly one of them in its own block.

### P8-8 · I broke a live API contract by making new fields required
Adding the six boundaries to `merchantPolicyUpdateSchema` as REQUIRED turned every existing `PATCH /merchant/policy` request into a 400. A client sending the eight fields it knew about was suddenly invalid.

Caught by `policy.test.ts`, which had been asserting a 200 on exactly that request since Part 5. **A breaking change to a live contract in exchange for nothing** — and it contradicted the reasoning `merchantGrowthConfigUpdateSchema` already used, where a merchant flipping one switch must not resend their whole envelope.

The six are optional now, and omitted means "leave as it is" rather than "reset to default": a merchant opening the form to change a discount ceiling must not silently clear their own prohibitions.

### P8-9 · I guessed a Prisma relation name
Wrote `outgoingRelationships: { none: {} }`. The relation is `relationshipsAsSource`. Caught by the typechecker in one pass.

## Environment friction

### P8-10 · The PGlite process died mid-migration
`P1001 Can't reach database server` on `prisma migrate deploy`. **The cluster itself was fine** — restarting the server and re-running applied cleanly.

This is the distinction the Part 7 lesson names, and it paid off immediately: a dead process and a corrupt cluster look identical from the client, and only the server log tells them apart. A WASM `Aborted()` means the cluster is gone (~6 minutes to rebuild); anything else is a restart.

### P8-11 · The machine slept mid-verification, again
Second time in two parts. A backgrounded full API run was killed. Nothing lost but time.

---

# PART 9 — autonomous AI buyer core

## Product bugs

### P9-1 · The buyer pipeline was two working halves with nothing joining them
Stages 1-7 (intent, requirements, discovery, filtering, comparison, reasoning, recommendation) ran in the conversation. Stages 9-15 (purchase proposal, spending policy, authorization, checkout, payment, verification, order) ran over HTTP. Both worked. Nothing connected them.

So a buyer who had just been shown five products had to **leave the chat, find a product page, and drive an ordinary e-commerce checkout by hand** — the exact behaviour "express intent rather than operate a website" rules out. The seam sat precisely where the product's premise is.

### P9-2 · Stage 8, offer evaluation, did not exist
**125 authorized offers** sat on the demo merchant — real `GrowthActionProposal` rows that had passed validation, the policy engine, and where required a human approval. The Buyer Agent could see none of them, and recommended those same products at list price.

The merchant had already agreed to accept less than the buyer was being quoted.

### P9-3 · "Buy the second one" would have bought the first
My ordinal matcher listed `one`, `two`, `three` as aliases for positions 1, 2, 3. In "buy the second **one**", "one" is a noun standing in for the product — but it matched the position-1 pattern first, so the agent resolved the buyer's explicit "second" to the **first** product.

Caught by a test written in the same pass. A wrong-product purchase is the single worst failure this agent could have, and it would have been silent: the buyer finds out from their bank.

### P9-4 · Spending policy was inline in a route handler
`POST /buyer/purchase-proposals` built the whole decision — category check, inventory, daily limit, autonomous ceiling, decision record, ledger write — inside the route. Fine while HTTP was the only caller. A conversation that built its own would have been a **second implementation of spending policy**, and the one nobody tests is the one that quietly diverges.

Extracted to `createPurchaseProposal`. Both callers land there, and a test asserts the two paths produce the same outcome and the same amount for the same variant.

### P9-9 · "Buy it" resolved the right PRODUCT and then a wrong VARIANT
Separate from P9-3, and found after that fix — this one is about a product that has several purchasable variants (size, colour). `resolveBuyTarget` correctly picked the buyer's product by position, then discarded the SPECIFIC variant the agent had actually recommended and substituted "the product's cheapest active variant" instead, because nothing had persisted which variant that recommendation was for.

`RecommendationRecord` stored `recommendedProductIds` but never `recommendedVariantIds`. A buyer shown a UK9 Black shoe who said "buy it" a turn later would have been sold whatever variant of that shoe happened to be cheapest — not necessarily UK9, not necessarily Black.

Fixed by persisting a parallel `recommendedVariantIds` array (migration `20260903010000`), and rewriting `resolveBuyTarget` to resolve the exact pair and re-verify it is still purchasable before falling back to "cheapest" — which now only happens for historical rows written before the column existed, or a variant that has since gone unavailable.

### P9-10 · The primary UI silently broke on every turn Part 9 exists to add
The backend was complete and fully tested — `COMPARISON_READY`, `PURCHASE_PROPOSED`, `PURCHASE_DECLINED` and `ACTION_UNRESOLVED` all round-tripped correctly through 11 pipeline tests. The **default buyer-facing chat view** had no code path for any of them.

`narrate()` had no `case` for the four new statuses, so all four fell through to `default`, which narrates `` `Found ${response.recommendations.length} that fit.` `` — and `recommendations` is always empty on a comparison or purchase turn. A buyer who said "buy the second one" was told **"Found 0 that fit."**, with no comparison table, no offer, no purchase card, and no way to see what actually happened short of switching to "Agent trace" mode. The trace view's own status banner had the identical gap — same fallthrough, same wrong sentence, sitting directly above an otherwise-correct comparison/purchase card.

The backend was also missing a piece the fix needed: the specific reason an ACTION_UNRESOLVED turn failed ("I only have 2 options… there is no number 3") was computed, persisted to the conversation, and then never returned in the API response — `status` alone cannot distinguish "wrong ordinal" from "nothing on the table" from "too few to compare", and the client has no way to reconstruct a reason it was never given. Added `unresolvedReason` to the response contract, mirroring the existing `clarification.question` field exactly.

This is Pattern 5 (capability shipped, consumption forgotten) in a new shape: not an unbuilt backend, but a **built and tested backend whose own primary consumer was never updated**. Eleven passing integration tests gave no signal, because none of them render the page.

## My own mistakes

### P9-5 · Shell escaping, fifth and sixth time
An apostrophe in "merchant's" inside a single-quoted `node -e` string, and a backtick inside a template literal. **Fifth and sixth occurrences in this project.** The fix has been the same every time and I have written it down twice: put the script in a file, run it with Node.

I did it again anyway. The pattern is not the cost of any one instance — it is that I keep choosing the faster-looking path after it has failed five times.

### P9-6 · I wrote an anchor with the wrong indentation
Patched three early returns at 4-space indentation; the file uses 6. The script failed closed, which is what it is designed to do, but it cost a round trip that reading four lines of the file would have saved.

### P9-7 · A test suite that could have passed vacuously — caught by probing
Six assertions carry `if (search.recommendations.length === 0) return;`. That is the exact shape of P6-5 and P8-4. This time I probed before trusting it: **5 recommendations, 4 products compared across 10 rows with 7 differing, a real ₹3,489 purchase proposal.**

The probe also found that offers came back **0** — not a bug, but proof that the offer path was untested by anything. Added a test pinned to a product known to carry an authorized offer, so the feature cannot silently break while every other assertion tolerates an empty list.

**Fifth vacuous-test near-miss.** The difference this time is that probing was the first thing I did rather than the thing I did after being burned.

### P9-11 · A stray NUL byte survived in two files, invisibly, because it never broke anything
`file` reported both `buyer-agent-pipeline.test.ts` and `turn-actions.ts` as "data" instead of text. A literal `0x00` byte sat in place of a single space character inside the `?? " null"` distinctness-sentinel string, in both files, in what reads like the same substitution happening twice independently.

**Nothing about this made a test fail.** A NUL byte is a legal byte inside a UTF-8 file and a legal character inside a JS string; `?? "\0null"` is exactly as distinct from a real value as `?? " null"` is, so `differs` computed correctly, 11/11 tests passed, and the corruption would have been committed to git undetected. Found only by a deliberate byte-level sweep (`file`, then `od`) run because the previous NUL-byte incident (P1-3, `navigation.test.tsx`) is in this same log.

**Seventh occurrence of the shell-escaping pattern**, and the first one that didn't announce itself by breaking something. The lesson from P9-5 — "put the script in a file, run it with Node" — prevents the syntax errors this pattern usually causes. It does not prevent this one, because the file it wrote was syntactically valid the whole time. Added a byte-level sweep of every modified file to the verification routine for this reason.

## Environment friction

### P9-8 · The PGlite process died again mid-part
Third process death across Parts 7-9, and the cluster survived every time. The Part 7 distinction keeps paying: a dead process and a corrupt cluster look identical from the client, and only a WASM `Aborted()` in the server log means the cluster is actually gone.

## What was NOT found

The spec asks to "remove fake chatbot functionality". **There was none.** The Buyer Agent was already a real pipeline — grounded recommendations from catalogue rows, an explicitly labelled deterministic fallback when the model is unreachable, and no hardcoded responses anywhere. A search for mock/fake/placeholder data in the buyer surface returned one `placeholder` attribute on an `<input>`.

Recorded because reporting a removal that did not happen would be worse than reporting nothing.

---

# PART 10 — agentic cart and checkout

## Product bugs

### P10-1 · The offer was displayed and never applied
Part 9 surfaced merchant-authorized offers to the buyer — a real 5%, traced to an AUTHORIZED governance row. `createPurchaseProposal` computed `variant.priceMinor * quantity` and stopped there.

**The buyer read a discount and was quoted list price.** On the demo catalogue that is ₹4,500 shown as "5% off" and charged at ₹4,500 — worse than showing no offer at all, because the buyer has been told something untrue about their own money.

Fixed by applying the offer in the same function that computes the total, in integer minor units. The discount is **recomputed against this basket** rather than copying the merchant's stored `discountMinor`: that figure was calculated against THEIR assumed basket, so at any other quantity it is right only by coincidence. A fixed-amount offer is capped at the basket, because a discount larger than the purchase is a refund nobody authorized.

The seam it flows through was already built and already debugged: `OrderItem.lineDiscountMinor` exists because a *negotiated* discount once got silently stripped by a Zod schema and every negotiated purchase failed as `FINANCIAL_INTEGRITY_ERROR`. Execution recomputes `(unitPrice × qty) − lineDiscount` and refuses if it disagrees with the stored total — so the discount reaching the real Razorpay charge is enforced, not hoped for.

### P10-2 · "Yes" authorized a purchase from a different conversation
`findPendingProposal` looked up the buyer's most recent PROPOSED decision record. Decision records are scoped to the BUYER, not the conversation.

So a shopper with an unanswered quote in one thread could open a fresh conversation, say "yes" to something else entirely, and **authorize the old purchase** — creating a real payment order against a basket they were not looking at.

Caught immediately by a test asserting "yes" on a fresh conversation authorizes nothing; it returned `CHECKOUT_READY`. Fixed with `BuyerConversation.pendingProposalId` (migration `20260903020000`): the BUY turn records what it quoted, AUTHORIZE resolves only that, and it is cleared on authorization so one yes buys one thing. Ownership is still re-checked against the buyer — a conversation id is not proof of whose basket it is.

Third instance of Pattern 14 in two parts, and the worst of them: P9-3 picked the wrong position, P9-9 picked the wrong variant, this picked the wrong **conversation**.

## My own mistakes

### P10-3 · I wrote a no-op line-ending restore
`crlf ? s.replace(/\n/g, "\n") : s` in my own edit script — a replace of `\n` with `\n`. It would have silently converted a CRLF file to LF. Caught by reading the script before running it, which is the only reason it did not land.

### P10-4 · Shell escaping, seventh and eighth time
An apostrophe in "merchant's" inside a nested-quoted `node -e`, and before that a `&&` chain where the failing command short-circuited the `mkdir` but an unchained `echo "migration written"` still printed — so **the output told me a file had been created that did not exist.** I then spent a round trip confused about why Prisma saw no pending migration.

The `&&` one is new and worth naming separately: the lesson has always been "write the script to a file", and that would not have helped here. What would have helped is not trusting a success message that was not conditional on the success.

### P10-5 · Three component assertions were too strict for a correct render
`getByText(/4,500/)` threw "found multiple elements" because the breakdown legitimately shows the unit price and the list subtotal, which are the same figure at quantity 1. The rendering was right; the assertions demanded uniqueness where the design does not have it. Switched to `getAllByText(...).length`, which asserts what actually matters.

## What was NOT found

The spec asks to remove duplicate cart/checkout systems. **There were none.** `Cart` and `CartItem` exist purely as internal execution artifacts written inside the commerce execution service — there is no cart API, no cart UI, no "add to cart" flow, and `/customer/cart` has redirected to the Buyer Agent since Part 1. Verified by tracing every importer of `cart-repository.ts` (two, both execution services) and grepping the web app for cart hooks and pages (none).

Recorded because reporting a removal that did not happen would be worse than reporting nothing.

## Environment friction

None new. The PGlite cluster survived the whole part.

---

# PART 11 — intelligent product discovery

## Product bugs

### P11-1 · "Compare 1 and 3" compared four products
`classifyBuyerTurn` read no positions at all for a comparison — `ordinal` was hardcoded `null` on the COMPARE branch. Neither bare digits ("1 and 3") nor ordinal words ("the first and third") were parsed, so every comparison covered whatever the first four candidates happened to be.

**The buyer asked about two products and was answered about four**, in a table that looked entirely plausible. This is the spec's own worked example, and it was wrong.

Fixed with `ordinals: number[]` on the classification. Bare digits are read **only for COMPARE**: "compare 1 and 3" plainly means positions, but "buy 2" means two of something, and reading that as "buy the second" would purchase the wrong product while looking reasonable. The digit form is available to the path that only reads, and withheld from the paths that spend money.

### P11-2 · The comparison did not know what the buyer had asked for
`buildComparison` took a list of product ids and nothing else. It laid catalogue fields side by side and left the buyer to remember their own constraints — so it could not answer the spec's "FIT TO BUYER REQUIREMENTS" at all, and a near-match sat in the table looking identical to an exact one.

It now takes the conversation's own normalized intent and reports, per product, which stated requirements it **meets** and which it **misses**. A requirement the catalogue cannot answer counts as a miss: "not recorded" and "satisfied" are opposite claims, and only one of them is safe to round in the buyer's favour.

### P11-3 · Trade-offs had no surface at all
The table marked which rows *differed* but never which option was ahead on any of them. The spec asks for trade-offs; "these two values are different" is not one.

Added `lowestIndex`, and deliberately only on price — the one row where "lower" is a fact with an order to it. Nothing else is ranked. A "which colour is better" column would be an opinion wearing a table's clothes, and the agent has already made its recommendation elsewhere.

## My own mistakes

### P11-4 · Two component assertions demanded uniqueness the design does not have
`getByText("Meridian Summit Trail")` threw "found multiple elements" once the product name legitimately appeared twice — in the table row and as its fit-card heading. Same shape as P10-5, one part later: the render was right and the assertion was wrong about it.

## Environment friction

### P11-5 · The port was listening and the database was not answering
A full run came back with **28 files failed and 268 skipped** — the shape of a total outage, not a regression. `netstat` showed 5432 LISTENING, so by the usual check the database was fine.

It was not. The PGlite process had stalled: accepting connections, answering nothing. Killing and restarting it turned 28 failures into 49 files and 484 tests passing with no code change.

**This is the exact distinction Part 7 recorded and I still nearly mis-read it.** "Listening" and "working" are different facts, and only a real query separates them. The check that settles it is a query, not a port scan — which is why the verification routine now runs one before every full suite.

## What was NOT found

The spec asks to fix duplicate search/recommendation implementations and ensure Discover and the Buyer Agent share a source of truth. **They already did.**

Both funnel through the same chain: `discoverMarketplace` and `searchCandidateProducts` each call `listAgentCatalog` → `listProducts` → `toAgentReadableProduct`. One query, one filter, one mapper. Verified by reading every caller rather than assuming from the module names.

Recorded because reporting a consolidation that did not happen would be worse than reporting nothing.

---

# PART 12 — buyer autonomy, spending policy and activity

## Product bugs

### P12-1 · Five of the seven buyer boundaries could not be expressed at all
`BuyerSpendingPolicy` had an approval threshold, a daily limit and an allow-list. It had no way to say **"never above this at all"**, **"never this category"**, **"never this merchant"**, **"ask me every time"**, or **"I lean toward these"**.

The gap that matters most is the first: `autonomousPurchaseLimitMinor` is the point above which the buyer is ASKED, and there was nothing that meant *refused*. A buyer could only raise their convenience threshold by also raising their exposure, because one number was doing both jobs.

All five added and enforced in `createPurchaseProposal` — the single function both the HTTP route and the conversation call, so there is no second place a purchase can be priced and therefore no second place a boundary can be skipped.

### P12-2 · A restriction could have been undone by widening an allow list
Not a shipped bug — a design trap avoided while building. The obvious implementation checks `allowedCategories` and `restrictedCategories` as alternatives. Then a category on both lists resolves by whichever check runs first, and "never buy this" becomes negotiable by editing a different field.

Restrictions are checked **independently of and after** the allow-list, so restricted always wins. The update contract additionally refuses to save a category on both lists — the buyer resolves the contradiction rather than discovering later which one the engine picked.

### P12-3 · Boundaries were re-checked at authorization, but only the old ones
`authorizePurchaseProposal` already re-read the policy before executing, precisely so a buyer who changes their mind between pricing and authorizing is obeyed. It re-checked category, currency and the autonomous ceiling — and would have sailed past every Part 12 boundary added above it.

The window between pricing and authorizing is exactly when someone changes their mind, so all five are now re-checked there too. A test restricts a category after a proposal is priced and asserts the in-flight authorization is refused.

### P12-4 · Two real pipeline stages left no durable record
COMPARISON and OFFER CHECK pushed a trace stage and wrote no ledger event. A trace lives only in the response that produced it, and Agent Activity reads the ledger — so both were **real backend actions the buyer could never see afterwards**.

The offer check now records even when no offer applies: "we checked and there were none" and "we never checked" are different facts, and only one of them means the buyer saw list price for a good reason.

### P12-5 · Agent Activity showed a verdict, not activity
Three fields per purchase proposal — policy outcome, reason code, negotiation status. Real data, and not activity: it showed the RESULT of a pipeline while the pipeline was invisible, and a conversation that searched without buying produced no row at all.

Replaced with the ledger-backed timeline. Eight of the ten stages the spec names were **already writing real events** and nothing was reading them — the sixth instance of *capability shipped, consumption forgotten*.

## My own mistakes

### P12-6 · I removed a page export and left three orphans behind it
Deleting `CustomerActivityPage` from `CustomerHistoryPage` left the `"activity"` lens type, its copy block, and its render branch. The typechecker caught the copy block; the other two would have compiled fine as dead code.

Same shape as the Part 10 extraction, where lint found six dead imports. **Removing a thing is not one edit — it is one edit plus everything that only existed for it**, and I still reach for the first without the second.

## Environment friction

None new. The cluster survived the whole part.

## What was NOT found

The spec says "do not generate fake agent activity". **There was none to remove.** The old activity view was thin but honest — every field came from a real `DecisionRecord`. The work was making the *real* events visible, not deleting invented ones.

---

# PART 13 — real Razorpay test-mode agentic commerce

## What was NOT found

Worth stating first, because it was most of the part. **The payment infrastructure was already right.** Integer minor units, one deterministic state machine, HMAC over raw bytes in an isolated Fastify scope, event-fingerprint idempotency, authorization re-checked at execution, a hash-chained ledger on every transition, and no AI import anywhere near money.

**And there were no duplicate payment implementations to remove.** One webhook route, one Razorpay HMAC module, one `resolvePaymentEvent`, one `createPaymentOrder` call site, and two `PaymentGateway` implementations that are the real adapter and its deterministic mock. Counted deliberately rather than assumed.

The one real duplication — two checkout builders, one per authorization type — was left alone on purpose. Merging two money paths on suspicion is the risk the spec warns about. P13-1 is a symptom of that split and was worth fixing on its own.

## Product bugs

### P13-1 · Agent Activity showed 3 of 9 real events
A probe drove one conversational purchase through a signed webhook to capture. The ledger recorded nine events. The buyer's page showed three.

The stage map listed `CHECKOUT_CREATED` — what the MERCHANT growth path writes. The buyer's path writes `AGENT_CHECKOUT_CREATED`. **One name apart, and the CHECKOUT stage never appeared for any buyer, ever.**

`PROVIDER_ORDER_CREATED` — the actual Razorpay Test Mode order, the most concrete step in the chain — was invisible too, as were both webhook events, so a buyer could never see their payment had been *verified* rather than assumed.

### P13-2 · An order becoming PAID left no ledger event
`resolvePaymentEvent` set the order to PAID and appended nothing, so the ORDER stage had no event to map. The buyer path never wrote `ORDER_CREATED` either, though the merchant path did. Both now write, and `ORDER_CONFIRMED` is written only against a verified capture.

### P13-3 · The ORDER stage would have lit up before payment
Caught in a browser, after fixing P13-2. An Order row exists from the moment stock is reserved, so mapping `ORDER_CREATED` to ORDER lit the last step of the pipeline for a purchase that might never be paid — **the same overstatement as a checkout screen saying "order placed" because a row was inserted.**

`ORDER_CREATED` moved under CHECKOUT. ORDER now means the buyer has an order.

### P13-4 · One journey was several unrelated hash chains
The ledger workflow id was the per-turn `traceId`. A buyer who searched in one turn and bought in another wrote three separate chains, so their activity showed one journey as three disconnected cards with nothing joining "I recommend this" to "you were charged for it".

A per-request correlation id had been doing a workflow's job by accident. They are two different things and are now two different fields.

### P13-5 · The activity feed silently became "spending only"
Found by looking at the running app, not the code. The feed concatenated purchase workflows and conversation workflows and took the first twenty. Purchases came first, so a buyer with twenty or more proposals — the demo shopper has ninety-six — never saw a search-only workflow.

The docblock on that exact function says omitting them "would make the feed look like it only records spending". **It did, for precisely the buyers who use the agent most.** Both sources are now merged on their own timestamps.

### P13-6 · A failed step looked identical to a successful one
Introduced by my own P13-1 fix: once failure events could reach the page, a refused capture rendered with the same blue dot as a completed one. Failure statuses now render in the danger colour.

## Latent, not live

### P13-7 · A load-bearing `!` on a nullable column
`webhook-service.ts` did `payment.checkoutId!`, and 55 of 512 payments have a null `checkoutId`.

**Checked rather than assumed in either direction:** all 55 are seeded DEMO history with no provider references, and the webhook resolves payments by provider + providerOrderId, so not one is reachable. A latent hazard, not a shipped bug — and worth reporting as exactly that rather than inflating it. Had one arrived, Prisma would have thrown inside the route, the request would have 500'd, and Razorpay would have retried something no retry could fix. Now recorded as UNRESOLVED.

## My own mistakes

### P13-8 · I wrote a test that grepped for the word "anthropic" and it matched a comment saying there is no Anthropic
The AI-on-the-payment-path test searched each file's whole text for `/anthropic/i`. It failed on `payment-service.ts`, whose own docblock reads `grep -i anthropic on this file returns nothing`. **It matched the sentence asserting the absence.**

A dependency is something a module IMPORTS. The check now parses import statements, because one that cannot tell code from prose about code proves nothing in either direction.

### P13-9 · My suite promoted the shared demo shopper from NEW to VIP
The Part 13 suite is the first to carry a buyer purchase all the way to CAPTURED, which counts toward customer standing. Six assertions in `customer-negotiation.test.ts` — a file about negotiation, not payments — started failing with `expected 'VIP' to be 'NEW'`.

The other buyer suites clean up only rows still PROPOSED, which is right for them because they never complete a purchase. **Mine does, so mine has to clean up more.** A suite that permanently alters a shared fixture's identity is not a passing suite.

### P13-10 · Two wrong field names and a wrong response shape, all in my own test
`totalMinor` for `amountMinor`; `.items` for `.orders` and `.payments`. Three of the first run's four failures were mine, one was the product's. Worth recording because the ratio is the normal one and reading a failure as "the code is broken" before checking the test is how a real bug gets buried under three fake ones.

### P13-11 · I reached for a Tailwind colour that does not exist
Wrote `bg-danger-600` for the failure dot. This palette defines `danger` with `subtle`/`border`/`text` — there is no numeric scale. A nonexistent Tailwind class renders **no background at all**, so the failure dot would have been invisible rather than obviously wrong. Caught before running by checking the config; confirmed afterwards by reading the computed style off the live page (`rgb(220, 38, 38)`) rather than trusting the class name.

## Environment friction

### P13-12 · A heredoc died on a 400-line TypeScript file
`cat > file <<'TEST'` failed with "unexpected EOF while looking for matching `'`" on a quoted heredoc, which should be literal. Not worth diagnosing: shell escaping on a file full of backticks, apostrophes and template literals is precisely where Bash stops being the cheaper tool. Same lesson as Parts 9 and 11, reached a third time.

### P13-13 · Applying a migration needed a third method
`$executeRawUnsafe` hit the PGlite wire-protocol quirk ("unexpected message from server"), and unlike the FK case this one really had not applied — verified by reading the column back rather than assuming, since this dev shim has previously reported failure for writes that succeeded. `prisma db execute --url` worked.

Also worth recording: `.env` points `DATABASE_URL` at a hosted Supabase instance, and `TEST_DATABASE_URL` at the local shim. The new migration is applied to the local one only. Migrating the user's real database is theirs to run.

## What this part did that no previous part did

**It was verified in a browser.** Every part since 1 closed with "not verified in a browser". P13-3 and P13-5 were both found that way and would not have been found any other way: one was a stage lighting up too early, the other a card that never rendered. Both look entirely correct in the source.

---

# Patterns worth naming

**1. Two things that must agree will eventually disagree.** P0-1 (two prefix lists), P3-1 (a string compared against an enum), P2-3 (a fixture shaped like a DTO). Every one was invisible to the typechecker. The fixes that stuck replaced agreement with a single source: one access table, one enum comparison, one contract import.

**2. Green tests are not evidence the thing works.** P3-6 is the clearest case — 14 passing tests over a cycle that executed nothing. P0-3 is the mirror image: 35 tests that had never exercised the role they claimed to. P6-5 nearly repeated it: three tests whose early-return guards would have reported green on an empty catalogue. Every time, only probing real data settled it. The inverse bit in P11-5: **red tests are not evidence the thing is broken.** 28 files failed because a database process was accepting connections and answering nothing. A port scan said healthy; one real query said otherwise.

**3. The most damaging bugs printed plausible numbers.** P0-7 (AOV over the wrong rows), P0-4 (every shopper NEW), P3-1 (approval reported as refusal). None threw. All three would have been believed.

**4. Aggregation for display is the wrong unit for action.** P3-2 acted on one of eighty payments; P4-3 compared eighty payments' total against a per-payment ceiling; P4-7 spent a whole cycle inside one card. Three separate bugs, one mistake: the row a merchant should READ is not the item the system should ACT on.

**5. Capability shipped, consumption forgotten.** P0-8 (admin endpoints, no UI), P0-9 (step-ups, no UI), P4-6 (eight detectors nothing acted on), P5-1 (a control group nobody compared), P5-2 (config nobody could write), P6-1 (relationships recorded, never published), P9-10 (a fully-tested backend whose own default UI had no rendering for any of it). Seven times the hard half was built and the last mile was not. It is the single most common defect in this codebase, by a distance — and P9-10 is the sharpest version yet: eleven passing integration tests, zero of them looking at the page a real buyer sees. P12-5 makes seven: eight of the ten activity stages were already writing real ledger events and the buyer's own activity page read none of them. P13-1 makes eight, and the worst of them: the ledger recorded nine steps of a real payment and the buyer's own page read three, because the buyer path and the merchant path named the same event differently.

**7. A deferred modelling debt does not sit still.** P0-11 was recorded as a naming problem and deferred as "not worth the migration". By the time it was opened it had produced PC-2 — a readiness score reporting zero on 35 of its 100 points — plus dead seed data (PC-3), a two-job function parameter (PC-4), and a test constructing an identity that both sold and shopped. None of those were visible when the debt was filed. **The cost of an ambiguous column is not the ambiguity; it is every reader who resolves it the wrong way afterwards, silently.**

**8. Fixtures chosen without an ORDER BY are a coin flip you cannot see.** PC-5: five suites picked their subject by physical row order, and the arrangement that had been passing for the whole project stopped passing after one reseed. The suite that broke gave a completely misleading signal — thirteen negotiation assertions failing on `POLICY_DENIED` — pointing at code that was entirely correct.

**9. A filter is a decision about what does not exist.** P7-1: the opportunity engine filtered `state === "FAILED"`, and four payments in `UNKNOWN` became invisible to every screen and every cycle in the product. Nothing errored, because a filter that excludes a case looks exactly like a case that never occurs. The same shape as pattern 2 — green means nothing was checked, not that everything passed.

**10. A stated impossibility is a claim.** P7-3: I wrote in a contract comment that order-to-proposal attribution had no honest join, and the column that provides it was two lines away in the schema. That comment would have justified a permanently null field to every future reader. Prose asserting something *cannot* be done needs the same checking as code asserting it can.

**11. Configuration in the wrong table is not configuration.** P8-1: six automation boundaries existed as concepts, three of them as real columns on `MerchantGrowthConfig` — a table the Policy Engine did not consult when deciding whether an action was permitted. A merchant could set them, the console could display them, and nothing enforced them. The test for whether a control exists is not "can it be saved" but **"does the code that decides read it"**.

**12. I keep writing against interfaces I have not opened.** P6-4 (function name), P7-10 (route path), P8-5 (response shape), P8-8 (relation name). Four times, always caught cheaply by a typechecker or a failing assertion, and always avoidable by one grep first. The pattern is not the cost of any single instance — it is that reading the interface has never once been slower than fixing the guess.

**13. Two working halves are not a working whole, and the seam is invisible from either side.** P9-1: the buyer conversation was correct, the purchase API was correct, every test on both passed, and the product still made a buyer leave the chat to spend money. Nothing was broken — the gap was *between* the things, where no test looks. Same shape as pattern 5, one level up: not "capability shipped, consumption forgotten" but "both ends shipped, join forgotten".

**14. The dangerous bug is the one that silently picks something.** P9-3: "buy the second one" resolving to the first. P9-9: the right product, then a wrong variant of it — the same shape one layer deeper, found only because the fix for P9-3 made the next question ("which variant?") askable at all. Neither throws, neither logs, both look exactly like success. The defence that worked both times was refusing to resolve ambiguity at all — "buy this" with several options asks which one rather than guessing, because an agent that guesses well 90% of the time is an agent that buys the wrong thing every tenth purchase. P10-2 completes the set: the wrong position (P9-3), the wrong variant (P9-9), and now the wrong *conversation* — an affirmation resolving against a basket the buyer was not looking at. Each was found only after the previous one was fixed, because fixing one made the next question askable. **Every layer that resolves a reference is a layer that can resolve it wrongly, and none of them throw.** P11-1 is the read-only member of the family: comparing the wrong products spends nothing, but it answers a question the buyer did not ask and looks exactly like an answer to the one they did.

**6. Shell quoting is where my edits go to die.** P1-3 (backspace bytes), P4-10 (heredoc), P4-11 (CRLF), P9-11 (a NUL byte standing in for a space, in two files, found by nothing but a deliberate byte sweep). The first three broke something — a syntax error, a failed anchor — so they were caught the moment the script ran. P9-11 broke nothing: the corrupted string was still a valid, still-distinct sentinel, so 11/11 tests passed with the corruption sitting inside them. Writing a script file and running it with Node prevents the syntax errors. It does not prevent a byte substitution the language itself is indifferent to — that needs its own check. P10-4 adds a variant that is not about quoting at all: a \`&&\` chain whose failing command short-circuited the real work while an unchained \`echo\` still reported success. **A success message that is not conditional on the success is worse than no message** — it sent me looking for a database problem that did not exist.
