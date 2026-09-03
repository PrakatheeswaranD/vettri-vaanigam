# TRACK01 Part 0 — what was fixed

Companion to [TRACK01_BASELINE.md](TRACK01_BASELINE.md), which records the "before". Every problem ranked P1–P6 there, and every duplication in its §9, is addressed below.

> **Note:** the routes named here were reorganised afterwards — see [TRACK01_PART1_RESTRUCTURE.md](TRACK01_PART1_RESTRUCTURE.md). The fixes stand; their addresses moved.

> Problems hit along the way, including the small ones: [TRACK01_PROBLEMS_LOG.md](TRACK01_PROBLEMS_LOG.md).

## Verification

| Check | Before | After |
|---|---|---|
| `pnpm typecheck` | clean | clean |
| `pnpm lint` | clean | clean |
| `pnpm build` | — | all 4 packages build |
| `packages/domain` tests | 35 files / 418 tests | 35 files, all pass |
| `packages/contracts` tests | 1 file / 6 tests | 1 file, all pass |
| `apps/web` tests | 7 files / 37 tests | 7 files, all pass |
| **`apps/api` tests** | **31 pass, 5 FAIL** (~35 failures) | **38 pass, 0 fail** |

Two new API suites were added — `access-model.test.ts` (7 tests) and `commerce-overview.test.ts` (5 tests) — both of which fail against the old code.

The corrected analytics were also confirmed against real data in the running console: **₹89,599 captured revenue across 9 paid orders → ₹9,955.44 average paid order**, exactly consistent. The old code averaged all 14 orders regardless of status.

---

## P1 — the Buyer Agent was unreachable by every role

**Cause.** Two independent prefix checks in `auth/middleware.ts` had to agree about which paths belong to the shopper, and one was edited without the other. A CUSTOMER allowlist named `/buyer-agent/conversations/`; a later merchant-side denylist named `/buyer-agent/`. `POST /buyer-agent/messages` matched neither the allowlist nor any role that survived the denylist, so it answered 403 to everyone.

**Fix.**

- Replaced both checks with **one access table** in [middleware.ts](apps/api/src/modules/auth/middleware.ts) — prefix → allowed audience (`SHOPPER` / `MERCHANT` / `PLATFORM_ADMIN`), first match wins, everything unlisted defaults to merchant management. Two lists that must agree cannot drift when there is one list.
- The refusal message now names the surface it refused, so a 403 is actionable.
- Collapsed the **duplicate message endpoints**. `/buyer/marketplace/messages` and `/buyer-agent/messages` were the same handler differing by one boolean; there is now one endpoint, `POST /buyer/messages`, and the conversation routes moved to `/buyer/conversations/:id` so the whole shopper surface sits under one prefix.
- The frontend's role-branch in `use-buyer-agent.ts` is gone — its only real effect was handing a 403 to anyone who was not a customer.

**Regression guard.** [`access-model.test.ts`](apps/api/src/access-model.test.ts) walks Fastify's *own* route table and asserts no registered route is refused to every role. A hand-written path list would have been updated by the same edit that broke this; the route table cannot be.

### A related bug this exposed

Making the shopper's search marketplace-wide showed that `discoverMarketplace`'s browse page size (20 per merchant) was being reused as the agent's candidate window. This catalogue has 46 active Running Shoes, so the agent could only ever see the first 20 and could refuse a product the merchant genuinely sells. The number of *sellers* compared is a deliberate product bound and stays; the per-seller cap was an accidental blind spot and now uses `CATALOG_SEARCH_LIMIT`. Verified: both scopes now return an identical 46 candidates.

---

## P2 — two competing growth surfaces, two competing revenue numbers

### The money

`GET /merchant/commerce-overview` was a 55-line inline route handler that derived headline figures from a page of the 100 most recent orders, in any status:

| Figure | Was | Now |
|---|---|---|
| `averageOrderValueMinor` | mean of ≤100 recent orders, **any status** | database `_avg` over **all PAID orders** |
| `orderCount` | `orders.length` — saturated at 100 | `prisma.order.count()` |
| `lifetimeValueMinor` | sum of a customer's orders, any status | sum of **PAID** orders only |
| `lastOrderAt` | last order of any kind | `lastPaidOrderAt` |
| currency | hardcoded `"INR"` in the UI | merchant's `defaultCurrency` |

Extracted to [`commerce-overview-service.ts`](apps/api/src/modules/merchant/commerce-overview-service.ts) with a real contract DTO (`merchantCommerceOverviewSchema`). The response now also carries `paidOrderCount` and `recentOrderLimit`, so the console can say what a figure was computed over instead of implying a page is the whole history.

[`commerce-overview.test.ts`](apps/api/src/commerce-overview.test.ts) pins each property a page-derived or status-blind implementation cannot satisfy — including a direct assertion that this endpoint and the Revenue Opportunity Engine now report **the same** captured revenue and the same average.

### The pages

`/merchant/growth` and `/merchant/offers` both answered "what should I do next" from different data. Now:

- **Growth Opportunities** is the single answer — ranked revenue opportunities, with the catalogue-scan findings moved underneath them as explicitly secondary ([`CatalogueScanFindings.tsx`](apps/web/src/components/growth/CatalogueScanFindings.tsx)). Same question, two altitudes, one page.
- **Offers & Actions** keeps only offers actually made, what they earned, campaigns, and the dry run.
- Nav hints rewritten so the two read as different jobs.

---

## P3 — the governance loop had no console

**Step-ups.** `GET /agent-gateway/step-ups` and `POST /agent-gateway/decisions/:id/decide` were implemented, RBAC-gated, optimistically locked, consent-revalidating and tested — and called from nowhere. The single most important moment in a governed agentic purchase could only be performed with curl.

[`StepUpQueue.tsx`](apps/web/src/components/gateway/StepUpQueue.tsx) now sits at the top of the Agent Requests page, above the metrics: a decision someone is waiting on outranks a number. Each row shows the amount, how far past the applied ceiling it went, and the gateway's own sentence about why it stopped. Rejection is the plain button and approval the deliberate one — approving releases money on an agent's say-so.

**Platform admin.** Nine `/admin/*` endpoints were gated to a `PLATFORM_ADMIN` role that could be provisioned and could sign in, with nothing rendering them; the operator landed on a merchant console that refused every request. Added [`PlatformAdminPage`](apps/web/src/routes/PlatformAdminPage.tsx) at `/admin/platform`, plus the `admin` experience role and route guard.

It is deliberately **one page, not a third console** — a full platform-admin experience was removed once for good reason, and this is the smallest thing that makes an existing role honest. It leads with payments in exception rather than merchant count, because that is the only figure where somebody is currently out of pocket. Read-only: suspend and onboard are consequential enough to deserve a considered flow rather than a table button.

---

## P4 — CI could never have passed the customer suites

`.github/workflows/ci.yml` ran migrate + seed, but the shopper and platform-admin identities come from `scripts/provision-demo-identities.ts`, which CI never called. Added a `db:identities` script to both `package.json` files and a CI step that runs it.

---

## P5 — customer identity modelled as a merchant

A shopper is a `MerchantUser` with `role: CUSTOMER` inside a synthetic merchant, so their "merchant id" is a buyer partition key stored in the merchant column. Customer routes calling `getAuthenticatedMerchantId()` read as merchant-scoped, so every authorization question about them had to be answered twice — which is *how P1 happened*.

Introduced `getBuyerContextId()` alongside it. Both currently return the same field, and that is the point: the two intentions are now named apart, so a reader can tell which one a route means and a future migration has one call-site vocabulary to change. All `/buyer/*` routes use it.

This also surfaced three real bugs, where merchant-side code filtered a **shopper's** records by the **seller's** id — so `getRecommendationRecord`, `getConversationIntentSnapshot` and `getRecommendationIntentSnapshot` silently found nothing for any genuine cross-merchant conversation. The merchant then saw "no relevant growth candidate" for a shopper who had stated a budget in plain words. Authorization is now enforced where it actually belongs: the primary product is resolved through the merchant-scoped catalog boundary, and the record must have recommended *that* product.

**Deliberately not done at the time:** the schema change (a real `CustomerAccount` table). It is a data migration across `DecisionRecord`, `BuyerConversation`, `BuyerSpendingPolicy` and `Session`, and doing it half-way is worse than doing it later on purpose.

**Done in the [closing pass](TRACK01_CLOSING_PASS.md#2-customeraccount--closed).** The deferral was defensible but the cost was higher than this entry assumed: the ambiguous column had already made the AI Buyer Readiness score report **0 grounded recommendations for a merchant with 45 of them**, silently, on two components worth 35 of its 100 points.

---

## P6 — 1,360 LOC of orphaned pages fronting real, tested backends

| Page | Was | Now |
|---|---|---|
| `BreakTheAgentPage` (132) | unroutable; 601 LOC of tested sandbox backend invisible | `/merchant/break-the-agent` + nav |
| `ProtocolsPage` (243) | unroutable | `/merchant/protocols` + nav |
| `DemoTourPage` (651) | unroutable | `/merchant/demo-tour` + nav |
| `ProductDetailPage` (334) | unroutable — assumed superseded, actually the **merchant-side** detail view with a human/agent toggle, orphaned when `/catalog/:id` was repointed at the shopper's page | `/merchant/catalog/:productId`; catalogue list and back-link repointed |
| `ActivityPage`, `TrustTracePage` | routed but in no nav | added to nav |

**There are now no orphaned pages and no orphaned components.**

---

## Also fixed along the way

Two test failures that were **not** caused by any of the above, and were failing on their own merits:

- **`buyer-agent.test.ts`** asserted that nothing fits "under ₹5,000", from a time when the cheapest black UK9 running shoe was ₹5,802. The generated product families now start at ₹3,490, so the premise had quietly become false and the assertion was testing the opposite of what it read as. Budget lowered to ₹3,000, with a comment explaining what the number depends on.
- **`agent-trust.test.ts`** asked for a basket at `UNKNOWN_CEILING * 1.5` (₹15,000), which lands just *below* the ceiling a caught agent collapses to (~₹18,000). Whether it passed came down to how far `Math.ceil` overshot on whatever price the seeded "first Running Shoes variant" happened to have. Now ₹30,000 — comfortably inside the gap at both ends — with the arithmetic spelled out.

## Files removed

`apps/api/scripts/_probe{,2,3,4,5}.ts` (untracked ad-hoc query scripts, zero references) and the empty `apps/web/src/auth/` directory.

---

## Not done, and why

- **Post-purchase is still one 539-line route file with no service layer.** It works and is tested. It wants a service layer before it grows, but refactoring working, covered code was not one of the ranked problems.
- **The landing page is still 2,795 LOC across 16 components.** Frozen, not removed — it is 14% of the frontend and 0% of the product, but deleting marketing copy is the user's call.
- ~~**The `CustomerAccount` schema migration** — see P5.~~ **Done** in the [closing pass](TRACK01_CLOSING_PASS.md#2-customeraccount--closed). It was not merely a naming problem: by the time it was opened, the ambiguous column had already made the AI Buyer Readiness score report zero on 35 of its 100 points.

## One environment note

The local PGlite cluster in `.dbdata/` corrupted itself during this work (a WASM abort on startup) and will not start. It contained no data that predates this session. All verification above ran against a fresh sibling cluster at `.dbdata-verify/`, which the existing `.gitignore` glob already covers.

**Resolved in the [closing pass](TRACK01_CLOSING_PASS.md#removed-permanently):** both corrupt directories were deleted (190 MB) and the working cluster consolidated back onto the default `.dbdata` path, so the command below is no longer needed. For reference, it was:

```bash
rm -rf .dbdata && pnpm db:up
```

then `pnpm db:migrate && pnpm db:seed && pnpm db:identities` in another terminal.
