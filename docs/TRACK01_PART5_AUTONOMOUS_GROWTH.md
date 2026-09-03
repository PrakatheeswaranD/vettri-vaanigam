# TRACK01 Part 5 — the growth loop closes

Continues [Part 0](TRACK01_PART0_FIXES.md) → [Part 4](TRACK01_PART4_OPPORTUNITY_ENGINE.md).

> Problems hit along the way: [TRACK01_PROBLEMS_LOG.md](TRACK01_PROBLEMS_LOG.md).

## What I found

Parts 3 and 4 built DETECT → RANK → PROPOSE → POLICY → EXECUTE. The two stages the spec asks for beyond that — **VERIFY / MEASURE / LEARN** — turned out to be half-built already, in a way nobody had noticed.

**Campaigns already had a real control group.** `cohortFor()` hash-buckets every subject into `CONTROL` or `TREATMENT` before any offer is made, deterministically, before the outcome is known. That is a genuine holdout — the only basis anywhere in this product for a causal claim. `GET /campaigns/:id/metrics` already returned both cohorts.

**Nothing compared them.** No screen rendered it, no code path read it back. The one place the product could honestly say *the offer caused this* was invisible, while every other screen carefully said *provenance, not attribution*.

**And the merchant could not configure anything.** `GET /merchant-agent/growth/config` existed; no write path did. Under a product whose premise is "the merchant sets the boundaries and the agent works inside them", the boundaries were immutable — the more serious half of that sentence missing, and silently, because a read-only config renders perfectly.

There is **no Experiments feature**, and I did not invent one. The spec says don't create fake experiments; the honest answer is that campaigns-with-a-holdout already are the experiment.

## MEASURE — [`campaign-lift.ts`](packages/domain/src/campaign-lift.ts)

Deterministic, pure, and mostly concerned with refusing:

| Basis | When | Reports |
|---|---|---|
| `MEASURED_AGAINST_HOLDOUT` | both cohorts ≥ 5 subjects, both have impressions | lift in bps, **signed**, plus attributable revenue |
| `INSUFFICIENT_SAMPLE` | below the floor | both rates, **no lift**, and why |
| `NO_HOLDOUT` | merchant ran at 0% control | treatment rate only, and that attribution is impossible |

Three deliberate choices:

- **Lift is signed.** A campaign that lost to its own holdout reports a negative lift in the same weight of type as one that won. That is the most useful thing this can tell a merchant and the easiest to bury.
- **Attributable revenue is not total revenue.** It is treatment revenue minus what the control rate predicts treatment would have earned anyway. On the test fixture: ₹10,000 earned, ₹5,000 attributable.
- **No p-values.** This build does not have the traffic to run a significance test honestly, and a p-value would dress that up. A stated sample floor is the truthful version.

## LEARN — the estimate has to be earned

`ELIGIBLE_OFFER` withheld its estimate with the reason *"no recorded history of offer-driven conversion"*. That is now literally true rather than permanently true: once a campaign with a holdout produces a measured lift, the engine applies **that merchant's own measured rate** to their own ceiling and the basis flips to `OBSERVED_HISTORY`. Confidence rises too — a controlled comparison outranks a structural signal.

A lift of zero or negative keeps the estimate withheld. A campaign that lost money is evidence to stop, not a rate to forecast with.

## VERIFY — the merchant's actual job

`PATCH /merchant-agent/growth/config`, OWNER-only, ledger-audited, partial-update safe. Nine fields: five switches for what the agent may propose, four ceilings it may never cross.

New page **Growth → Boundaries**. Deliberately no campaign wizard, no targeting builder, no creative editor — the agent decides what to propose and to whom from the merchant's own data. The merchant decides what it is *allowed* to propose, and that is these nine fields.

The boundary is not decoration: switching offers off removes `ELIGIBLE_OFFER` from **detection**, not merely from execution. A test pins that.

## Consolidated

Growth is now one section rather than a page plus a page two clicks away under Merchant Agent:

```
📈 Growth   Opportunities · Offers · Results · Boundaries
🤖 Agent    Console · Readiness · Connect          (Offers moved out)
```

Detection and outcome are two ends of one loop. Splitting them meant nothing on screen ever closed it — nine opportunities on one page, a campaign's revenue on another, and no way to tell whether the second came from the first.

Old paths redirect: `/merchant/agent/offers` and `/merchant/offers` → `/merchant/growth/offers`.

## Verification

| Check | Result |
|---|---|
| `pnpm typecheck` | clean, 4 packages |
| `pnpm lint` | clean |
| `pnpm build` | all 4 build |
| **domain** | 35 files — new `campaign-lift.test.ts`; those two files now total **58 tests** |
| **API** | **41 files pass** on a clean seed — +1: `growth-boundaries.test.ts` (7 tests) |
| web / contracts | 9 / 1 |

What the tests pin, beyond the arithmetic:

- lift is **withheld** below the sample floor, with both rates still shown — they are observations; only the *difference* is unsupported
- a campaign that underperformed reports **negative** lift and zero attributable revenue
- `observedOfferLiftBps` returns null when nothing was measured, so the engine keeps withholding
- an estimate can never exceed the ceiling it is applied to
- a partial boundary change **does not clobber** the fields the merchant did not mention
- an out-of-range ceiling and an empty change are both refused, not silently accepted
- every boundary change lands on the audit ledger with what changed
- switching a boundary off removes the opportunity from **detection**

## Not done, deliberately

- ~~**No scheduled/automatic cycle.**~~ **Done** in the [closing pass](TRACK01_CLOSING_PASS.md#1-the-scheduled-cycle--closed). The reasoning below was not overridden — the decision was handed to the merchant instead, behind two switches that are both off by default: the operator's `AGENT_SCHEDULER_ENABLED` and the merchant's own `autonomousRunsEnabled`. A scheduled cycle is the same run, with the same policy checks and the same approval ceilings.
- **No significance testing.** Reviewed again in the closing pass and **deliberately kept**: this build does not have the traffic to run one honestly, and a p-value on a five-subject cohort would dress up noise as a finding. Refusing it is the decision, not an omission.
- **`GrowthSummaryPanel` / `AgentDrivenGrowth` / `CampaignManager` kept as-is** on the Offers tab. They read real Decision Records and real campaign rows; nothing about them is redundant now that Results exists beside them.

## Not verified in a browser

Same as Parts 1–4: the preview browser has no session and signing in would mean entering a password. The Boundaries page's write path is verified end to end through the API; the form itself is typechecked and built but not clicked.
