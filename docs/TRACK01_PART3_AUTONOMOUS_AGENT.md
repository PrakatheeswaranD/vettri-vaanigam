# TRACK01 Part 3 — the Merchant Agent actually runs

Continues [Part 0](TRACK01_PART0_FIXES.md), [Part 1](TRACK01_PART1_RESTRUCTURE.md) and [Part 2](TRACK01_PART2_COMMAND_CENTER.md).

> Problems hit along the way: [TRACK01_PROBLEMS_LOG.md](TRACK01_PROBLEMS_LOG.md).

## What was actually missing

**Every stage of the loop already existed. Nothing joined them up.**

| Stage | Already existed |
|---|---|
| OBSERVE / IDENTIFY / ANALYZE / PRIORITIZE | `revenue-opportunity.ts` — nine detectors, ranked, over real rows |
| PROPOSE | `evaluateAndProposeRecovery`, `proposeGrowthAction` |
| VALIDATE | `validateGrowthProposal` |
| POLICY CHECK | `evaluateProposalPolicy` |
| AUTHORIZATION | `issueExecutionAuthorization` |
| EXECUTE | `executeRecovery` |
| AUDIT | `appendLedgerEvent` |

A merchant had to drive each step by hand, one payment at a time, through four separate endpoints — and the console only ever called the first. **A proposal reached `PROPOSED` and stopped there forever.** The product had an autonomous revenue agent that could not act on its own.

So Part 3 adds no second agent, no second policy engine and no alternative execution path. It adds the missing drive shaft.

## The cycle

[`autonomous-run-service.ts`](apps/api/src/modules/merchant-agent/autonomous-run-service.ts) — `POST /merchant-agent/run`:

```
detect (ranked, real rows)
  → propose + validate
    → policy check
      → ALLOW             → authorize → execute → verify
        REQUIRE_APPROVAL  → stop, leave for the human
        DENY              → stop
      → ledger, at every transition
```

Every step records **which stages it reached**, so a step that stopped at `POLICY_CHECKED` visibly never reached `AUTHORIZED`. The shape makes a skipped guardrail impossible to hide.

### The LLM's blast radius

The model's entire contribution is a structured proposal shape, produced inside `evaluateAndProposeRecovery` and validated against merchant configuration before it is persisted. **It never reaches the orchestrator.** Money moves only through `executeRecovery`, which consumes an `ExecutionAuthorization` the deterministic policy engine issued against a proposal fingerprint. There is no code path from model output to a payment.

### Boundaries were already merchant-defined

No new settings model. `MerchantPolicy.autoApprovalOrderAmountMinor` and `autoApprovalDiscountBps` are exactly "the limits inside which the agent may act alone" — the policy engine returns `ALLOW` within them and `REQUIRE_APPROVAL` outside. The run honours that verdict and does not second-guess it.

### What auto-executes, honestly

Only failed-payment recovery, because it is the only detected type whose action needs nothing from a buyer — the order, basket and price already exist. A cross-sell cannot execute without a live basket, so those are proposed, governed, and then wait. Reporting them as "executed" would be the more impressive outcome and a false one.

## Three real bugs the work found

**1. `REQUIRES_APPROVAL` vs `REQUIRE_APPROVAL`.** The enum is singular. Comparing against the plural silently routed every needs-a-human proposal into the BLOCKED branch — telling merchants *"your policy refused this action outright"* when it was in fact waiting for them to approve it. Caught by running the cycle against real data and reading the output.

**2. One opportunity is not one action.** The engine aggregates — a single `FAILED_PAYMENT_RECOVERY` card covers **80 payments** on this merchant's data. The first implementation took `subjectIds[0]`, acted on one payment, and reported the cycle complete while leaving 79 recoverable payments untouched. The work list is now one entry per payment, bounded at 5 per cycle, with the remainder reported as `deferredCount`.

**3. Guardrail refusals were counted as crashes.** `executeRecovery` refusing because the order moved on is the system protecting the merchant's money. Counting it as `FAILED` makes a working safeguard look like an outage — and buries a real outage among them. Refusals are now classified by error code and reported as `REFUSED`.

Before → after on the same data:

```
counts: {executed:0, awaitingApproval:0, blocked:1, refused:1, failed:1}   ← bugs
counts: {executed:2, awaitingApproval:1, blocked:0, refused:2, failed:0}   ← fixed
```

with the full chain visible: `DETECTED>PROPOSED>POLICY_CHECKED>AUTHORIZED>EXECUTED>VERIFIED`.

## The console

[`AgentConsolePage.tsx`](apps/web/src/routes/AgentConsolePage.tsx) at **Merchant Agent → Console**, answering the five questions in the order a merchant asks them:

| Question | Answered by |
|---|---|
| How can I increase revenue? | current objective + ranked next actions |
| What did you automatically do? | run log + autonomous actions (its own ledger entries) |
| Why did you do it? | every row carries `whyDetected` / its own reason |
| What happened? | per-step stage track, executed, verified, stopped |
| What should happen next? | awaiting approval + next actions |

`REFUSED` and `BLOCKED` render neutral, not red. Only `FAILED` is red — colouring correct behaviour as an error trains merchants to ignore it.

### Why there is no `AgentRun` table

Everything the status endpoint returns is already recorded: detection is computed from orders and payments, `GrowthActionProposal` carries governance status, and the `AgentAction` ledger carries every transition under a hash chain. A run table would be a fourth copy of facts three places already hold, and the first time it disagreed with the ledger the ledger would be right. `GET /merchant-agent/status` is a pure read model.

## Verification

| Check | Result |
|---|---|
| `pnpm typecheck` | clean, 4 packages |
| `pnpm lint` | clean (14 pre-existing `react-refresh` warnings in untouched files) |
| `pnpm build` | all 4 build |
| **API tests** | 39 → **40 files** |
| Web tests | 9 files pass |
| domain / contracts | 35 / 1 |

[`autonomous-agent.test.ts`](apps/api/src/autonomous-agent.test.ts) — 16 tests against real seeded rows. It asserts the loop runs, but it cares as much about what did **not** execute:

- a step that reached `EXECUTED` **provably** passed `PROPOSED`, `POLICY_CHECKED` and `AUTHORIZED` first, with `policyOutcome === "ALLOW"`
- dropping the merchant's auto-approval ceiling to zero produces **zero executions** and no `AUTHORIZED` stage anywhere
- switching `growthActionsEnabled` off carries nothing to execution
- a refusal is never counted as a failure
- the whole cycle writes to the ledger under one workflow, every event `actorType: MERCHANT_AGENT`
- a second cycle cannot reuse the first cycle's authorizations to open more checkouts
- both routes refuse an invalid session

Two of those tests exist specifically to pin bugs 1 and 2, and fail against the code as it was an hour ago.

**A cycle that executes everything it finds is not evidence the guardrails work — it is evidence they were not exercised.** On this merchant's data a single cycle produces executions, an approval hold, refusals and deferrals together, which is the outcome worth having.

## Not verified in a browser

Same limitation as Parts 1 and 2: the preview browser has no session and signing in would mean entering a password. The backend loop is verified end-to-end against real rows, including execution creating real authorized checkouts. The console page is typechecked and built but not clicked. Worth one look at **Merchant Agent → Console**, and one press of *Run a cycle*.

`.dbdata` was still corrupt from Part 0, so all verification here ran against `.dbdata-verify`. Both were deleted and `.dbdata` rebuilt in the [closing pass](TRACK01_CLOSING_PASS.md#removed-permanently).
