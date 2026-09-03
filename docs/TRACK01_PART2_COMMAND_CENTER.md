# TRACK01 Part 2 — the Overview stops being a dashboard

Continues [Part 0](TRACK01_PART0_FIXES.md) and [Part 1](TRACK01_PART1_RESTRUCTURE.md). This part rebuilds 🚀 Overview around what the Merchant Agent found, did, and produced.

> Problems hit along the way: [TRACK01_PROBLEMS_LOG.md](TRACK01_PROBLEMS_LOG.md).

## The problem with what was there

Nine cards of counts — products, orders, captured payments, out-of-stock variants, active products, agent-ready products — plus a readiness ring, a capability strip, a connected-systems panel, and **two separate feeds of the same ledger** stacked on one page ("Recent Agent Actions" and "Agent Activity").

Every number was true. None of it answered the question a merchant running an autonomous revenue agent actually has.

## The page now

```
1  OBSERVED BUSINESS STATE      countable in your own rows, right now
2  AGENT-DETECTED OPPORTUNITIES ranked, with why / action / risk / policy
3  AUTOMATED ACTIONS            what it did alone, what it refused to
4  VERIFIED RESULTS             what the provider confirmed came of it
5  SCORES                       Growth Score · AI Buyer Readiness
```

| Required | Where it comes from | Class |
|---|---|---|
| observed revenue | engine `observed.capturedRevenueMinor` | OBSERVED |
| revenue at risk | engine `totals.totalAtRiskMinor` | OBSERVED |
| recovered revenue | summary `recoveredValue` **(new)** | VERIFIED |
| active opportunities | engine `totals.opportunityCount` | — |
| automated agent actions | summary `automatedActions` **(new)** | — |
| pending approvals | summary `pendingApprovals` **(new)** | — |
| verified results | summary `observedCapturedValue` + `recoveredValue` | VERIFIED |
| top revenue opportunities | engine `opportunities`, ranked | mixed |
| Merchant Growth Score | engine `growthScore` | — |
| AI Buyer Readiness | engine `aiBuyerScore` | — |

## Four value classes, never blended

`OBSERVED` is countable in the merchant's rows now. `ESTIMATED` is a projection, only where their own history supports a rate. `POTENTIAL` is a ceiling. **`VERIFIED`** — new — means the payment provider confirmed money moved on an order tracing back to an agent proposal.

`VERIFIED` is deliberately **presentation-only, not a database enum value**. No `GrowthOpportunity` row is ever verified: verification is a property of a captured payment joined to a proposal, computed at read time. Putting it in the Prisma enum would invite writing it onto a row that cannot support the claim.

There is **no single blended "total value created"** figure. It would be the most impressive number on the page and the least true one.

## Backend: upgraded, not duplicated

`GET /growth/summary` already existed and already carried the agent-provenance captured value. Rather than adding a command-center endpoint beside it, it gained the three facts the story needed:

- **`recoveredValue`** — the same provider-verified rows `recoveredOrders` already counted, summed. A count alone told a merchant recovery happened without telling them whether it was worth doing.
- **`pendingApprovals`** — `PENDING_APPROVAL` proposals, the same status the approvals queue lists, so the two screens cannot disagree about how much is waiting.
- **`automatedActions`** — ledger events grouped by type, scoped to `actorType: MERCHANT_AGENT`. A deterministic readiness recalculation is written as `SYSTEM` and is correctly *not* counted as something the agent decided to do.

The Overview reads two endpoints, both pre-existing.

## Consolidated and removed

| | Disposition |
|---|---|
| Opportunity→action wiring, duplicated across Growth and Overview | Extracted to [`OpportunityAction.tsx`](apps/web/src/components/growth/OpportunityAction.tsx). Drift here means one page offering an action the other retired. |
| Two ledger feeds on one page | Merged. The page shows what the agent *did*, grouped; Governance → Ledger keeps the raw event stream. |
| `useMerchantStats` | Removed — zero consumers after the rebuild. Its counts are Commerce's summary strip. |
| Commerce/catalogue counts, readiness ring, capability strip, connected systems | Not deleted — they already live on Commerce, Merchant Agent → Readiness, and Governance → Policies. |

## Verification: DATABASE → BACKEND → API → FRONTEND → VISIBLE RESULT

| Check | Result |
|---|---|
| `pnpm typecheck` | clean, 4 packages |
| `pnpm lint` | clean |
| `pnpm build` | all 4 build; web bundle 17.6s |
| **API** | **39 files pass** (was 38) |
| **Web** | **9 files pass** (was 8) |
| domain / contracts | 35 / 1, unchanged |

Two new suites, both of which fail against the old code:

**[`command-center.test.ts`](apps/api/src/command-center.test.ts)** (11 tests) — DATABASE → BACKEND → API. It does not assert the endpoints respond; it asserts every number is *reproducible from Prisma by an independent query*. Captured revenue equals the sum of `CAPTURED` payments and nothing else. Recovered value comes from the same rows as recovered orders. The Overview's pending-approvals count equals the length of the approvals queue — if those disagree, one screen is lying. Agentic captured value is a subset of all captured value, so revenue can never be attributed to the agent that the provider never confirmed. And no opportunity states an incremental estimate whose basis is `INSUFFICIENT_EVIDENCE`.

**[`OverviewPage.test.tsx`](apps/web/src/routes/OverviewPage.test.tsx)** (12 tests) — FRONTEND → VISIBLE RESULT, with `fetch` stubbed rather than the hooks, so the page exercises its real query layer against real payload shapes. It pins the four stages in order, checks each class carries its own label, asserts `Provider-verified` appears on exactly the two figures that earned it, and computes four possible cross-class sums and requires that **none of them appears anywhere on the page**.

## Not verified in a browser

Same limitation as Part 1: the preview browser has no session and signing in would mean entering a password. The two suites above cover the chain end to end — including the render — but the literal paint is unconfirmed. Worth one look at 🚀 Overview when signed in.

## One thing to know

Your `.dbdata` PGlite cluster was still corrupt from Part 0 (WASM abort on start), so all verification here ran against `.dbdata-verify`. **Both were deleted in the [closing pass](TRACK01_CLOSING_PASS.md#removed-permanently)** and `.dbdata` rebuilt; `pnpm db:up` now works with no override. For reference, the restore was:

```bash
rm -rf .dbdata && pnpm db:up
```

then `pnpm db:migrate && pnpm db:seed && pnpm db:identities`.
