# TRACK01 Part 4 — the engine feeds the agent

Continues [Part 0](TRACK01_PART0_FIXES.md) → [Part 3](TRACK01_PART3_AUTONOMOUS_AGENT.md).

> Problems hit along the way: [TRACK01_PROBLEMS_LOG.md](TRACK01_PROBLEMS_LOG.md).

## What was already there

`revenue-opportunity.ts` was a genuinely good deterministic engine — seven detectors, evidence-basis discipline, weighted scoring, an explicit `INSUFFICIENT_EVIDENCE` path. It was not rebuilt. It was extended, and then connected to something.

## What was actually wrong

**1. `UPSELL` was a declared category with no detector.** It sat in `REVENUE_OPPORTUNITY_TYPES`, `upsellEnabled` sat in the evidence, `OFFER_TARGETED_UPSELL` sat in the action vocabulary — and nothing ever produced one. A dead enum value that looked like a feature.

**2. Three categories the spec asks for had nothing behind them:** `UPSELL`, `PRODUCT_DISCOVERY`, `ELIGIBLE_OFFER`.

**3. Products no agent can see were detected by nothing.** Every product-facing detector filtered on `agentVisible: true`, including the readiness one. An unpublished product was invisible to the engine as well as to buyers.

**4. Opportunities had no status and no result.** Recomputed from live rows on every read, the same card reappeared identically after the agent had already acted on it. A merchant could not tell "nothing has happened here" from "this is done".

**5. The agent consumed one of nine detections.** Part 3 wired `FAILED_PAYMENT_RECOVERY` end to end. The other eight were computed, ranked, rendered — and left for a merchant to find by hand, which is the exact thing the engine exists to prevent.

## The three new detectors

Each states its evidence and withholds what it cannot support.

| Detector | Evidence | Estimate |
|---|---|---|
| **UPSELL** | The merchant's own price ladder — products that sell, with a dearer active variant than the entry one. Ceiling = units sold × real spread. | **Withheld.** Nothing records how often a buyer trades up. Picking a rate would invent the entire number. |
| **PRODUCT_DISCOVERY** | Products not agent-visible at all. | **No figure of any kind.** An unpublished product has no sales history and no observed demand. |
| **ELIGIBLE_OFFER** | Products the merchant marked `promotionEligibility: ELIGIBLE`, that sell, with bounded offers switched on. | **Withheld.** No recorded history of offer-driven conversion. |

Upsell is the easiest place in this engine to fabricate — multiply a catalogue by an imagined "20% trade up" and print a big number. It uses only the merchant's own price ladder, and says so in its `method`.

On this merchant's data: **9 opportunities, 7 with estimates explicitly withheld.**

## Every required field

`approvalRequired`, `confidence`, `urgency`, `status` and `result` were added. They are derived **once**, in a `finalise()` helper the orchestrator applies to every detector's output:

```ts
type OpportunityDraft = Omit<RevenueOpportunity,
  "approvalRequired" | "confidence" | "urgency" | "status" | "result">;
```

A detector that had to remember to set `approvalRequired` itself would eventually set it inconsistently with its own `policy.outcome` — and the console would show a row marked "no approval needed" that the policy engine then held for approval. The type makes that impossible.

`status` is derived from the same `GrowthActionProposal` rows governance reads, so an opportunity's status can never disagree with the approvals queue.

## Three real bugs this surfaced

**1. The approval threshold was compared against the aggregate.** One recovery card covers 80 payments; the code compared their **sum** against the merchant's per-order auto-approval ceiling. Any sane ceiling loses that comparison, so the card said *"needs your approval"* for work the agent would in fact do entirely alone — while Part 3's run was busy auto-executing exactly those payments. Two screens, contradicting each other. Now compared per payment, with an evidence line stating how many are inside the limit.

**2. `effort` was hardcoded `ONE_APPROVAL` on recovery.** The one opportunity type the agent can genuinely complete end to end was the one advertised as needing a human.

**3. One card starved every other.** With the agent extended to all consumable types, the work list became 135 items — and a flat slice of a priority-ordered list spent the entire cycle inside the top card. Cross-sell, upsell and offer opportunities would have been detected forever and acted on never. Selection is now **round-robin**: one subject from each opportunity in priority order, then a second from each. Breadth first, depth second.

Before → after on the same data:

```
considered 5,  counts {executed:0, awaiting:0, refused:5}   ← one card, all refused
considered 12, counts {executed:3, awaiting:1, refused:8}   ← four types worked
```

## How the agent consumes each type

```
RECOVER   propose on a PAYMENT → policy → execute inside the merchant's limits
PROPOSE   propose on a PRODUCT → policy → authorize, then wait for a basket
SURFACE   a catalogue or positioning task — reported, never fabricated into
          a governance row governance has no opinion about
```

`PROPOSE` stops at authorization and says so. A cross-sell cannot execute without a live basket to attach to; reporting it as executed would be the more impressive outcome and a false one.

## The duplicate engine is gone

`opportunity-scan.ts` was a second engine over the same catalogue facts, writing `GrowthOpportunity` rows on publish and rendering as "Catalogue scan findings" beside the revenue cards. All four of its categories are now covered:

| Scanner category | Covered by |
|---|---|
| CROSS_SELL | `detectCrossSellGaps` |
| UPSELL | `detectUpsell` **(new)** |
| CATALOG_GAP | `detectProductDiscovery` **(new)** + `detectAiBuyerReadinessGaps` |
| READINESS_GAP | `detectAiBuyerReadinessGaps` |

Removed after tracing: the domain engine, its service, its `/growth/opportunities` route, the growth read path (`service.ts`, `mapper.ts`, `repository.ts`), the `useGrowthOpportunities` hook, the `CatalogueScanFindings` component, and both test files — **~700 LOC**. Also removed `GatewayDecisionFeed`, which had been orphaned since Part 1 deleted `ActivityPage`; my Part 1 orphan sweep only covered route files, not components.

The `GrowthOpportunity` Prisma model is deliberately **left in place**: dropping a table with RLS policies attached is a migration, and out of proportion to this part. It is now written only by the seed and read by nothing.

## Verification

| Check | Result |
|---|---|
| `pnpm typecheck` | clean, 4 packages |
| `pnpm lint` | clean |
| `pnpm build` | all 4 build |
| **domain** | 34 files — `revenue-opportunity.test.ts` **24 → 42 tests** |
| **API** | **40 files pass** on a clean seed — +1: `opportunity-engine.test.ts` (13 tests) |
| web / contracts | 9 / 1 |

[`opportunity-engine.test.ts`](apps/api/src/opportunity-engine.test.ts) pins the chain end to end against real rows:

- every opportunity's `subjectIds` resolve to rows that **actually exist** — payment, order, product or customer, never an invented id
- `INSUFFICIENT_EVIDENCE` ⇒ `expectedIncrementalValue` is null, always
- `approvalRequired` can never contradict `policy.outcome` or `effort`
- ranking is monotonic and policy-blocked work sorts below everything eligible
- the agent acts **only** on ids the engine detected, and carries the detection's own `whyDetected` into the run log
- a cycle works **more than one kind** of opportunity — the starvation regression
- acting moves a card off `DETECTED`, and its status is backed by real proposal rows
- `/growth/opportunities` now 404s; `/growth/revenue-opportunities` still serves

The domain suite adds 18 tests covering the three new detectors, the per-payment threshold, and status derivation.

## One test-isolation weakness, stated

`recovery.test.ts` draws on the same per-order recovery budget the autonomous-cycle tests consume. On a **freshly seeded** database the full suite is 40/40; re-running it locally *without* re-seeding can starve that suite and it fails loudly.

CI always starts from a fresh seed, so CI is unaffected. The clean fix is for the cycle tests to work against their own merchant instead of the shared demo one — deliberately not done here, because manufacturing a second fully-populated merchant is a larger change than the problem justifies.

**Fixed in the [closing pass](TRACK01_CLOSING_PASS.md#verification)**, and more cheaply than a second merchant: [`cycle-cleanup.ts`](../apps/api/src/test-helpers/cycle-cleanup.ts) records the proposal ids each cycle reports and removes exactly those rows, so the cycle suites no longer consume the recovery budget `recovery.test.ts` needs. It deliberately does not reset tables — a cleanup broad enough to guarantee isolation by wiping data would also hide genuine cross-contamination, which is the thing worth knowing about.

## Not verified in a browser

Same as Parts 1–3: the preview browser has no session and signing in would mean entering a password. The engine → agent chain is verified end to end against real rows.
