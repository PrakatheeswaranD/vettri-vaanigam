# TRACK01 PART 8 — governed autonomy

Continues [Part 0](TRACK01_PART0_FIXES.md) → [Part 7](TRACK01_PART7_COMMERCE_OPERATIONS.md).

> Problems hit along the way: [TRACK01_PROBLEMS_LOG.md](TRACK01_PROBLEMS_LOG.md).
>
> Followed by [Part 9](TRACK01_PART9_AI_BUYER_CORE.md), which made the Buyer Agent carry the whole customer pipeline.

Governance becomes the control system that makes an autonomous agent safe: nine boundaries, all enforced in deterministic backend code, a complete lifecycle, and an adversarial suite that tries to get around all of it.

---

## The finding

**Six of the nine boundaries the spec names had no enforcement.**

| Boundary | Before | Now |
|---|---|---|
| Maximum discount | ✅ `maxDiscountBps` | unchanged |
| Approval thresholds | ✅ `autoApproval*` | unchanged |
| Recovery attempt limit | ✅ `maxRecoveryAttempts` | unchanged |
| **Minimum margin** | ❌ did not exist | `minMarginBps` |
| **Daily action limit** | ❌ did not exist | `maxAutonomousActionsPerDay` |
| **Eligible customers** | ❌ did not exist | `minCustomerPaidOrders` |
| **Eligible products** | ⚠️ derived, not settable | `eligibleCategories` |
| **Prohibited actions** | ⚠️ booleans in `MerchantGrowthConfig` | `prohibitedActions` |
| **Recovery permission** | ⚠️ inferrable from a zero limit | `recoveryEnabled` |

The three marked ⚠️ are the interesting ones. They *existed* — as columns on `MerchantGrowthConfig`, a table the Policy Engine did not read when deciding whether an action was permitted. A merchant could set them, the console displayed them, and nothing enforced them.

**A column nothing reads is indistinguishable from a control that works, right up until it matters.**

## Where enforcement lives

Every boundary is evaluated by [`evaluatePolicy`](../packages/domain/src/policy-engine.ts) — a pure function with no database access, no AI provider, and no network call. The API calls it before anything executes. The console has no part in it: a hidden button is a hint, and the server is the control.

Rule precedence is fixed and total, and the new boundaries went into **Tier 1 (deny outright)**, not Tier 3 (require approval):

```
Tier 1  invalid / prohibited / ineligible  →  DENY
Tier 2  hard limit breached                →  DENY
Tier 3  above the automatic threshold      →  REQUIRE_APPROVAL
Tier 4  within every bound                 →  ALLOW
```

That placement is the point. Each of these is a merchant saying *"not this, ever"* rather than *"not this without asking me"* — routing any of them to approval would turn a prohibition into a prompt, and invite a merchant to approve something they had forbidden. A test pins it: a prohibited action that *also* exceeds the approval threshold must report `ACTION_TYPE_PROHIBITED`, never `DISCOUNT_REQUIRES_APPROVAL`.

### Three decisions worth stating

**The margin floor denies on unknown cost.** A variant with no recorded `costMinor` yields `marginBps: null`, and a null margin with a floor configured is treated as a breach. A merchant who asked not to sell below a margin did not mean *"unless the margin cannot be computed"* — proceeding would discount a product whose cost is unknown, which is exactly what a floor exists to prevent.

**The daily limit applies only to unattended runs.** A merchant pressing *Run a cycle* is present and supervising; the ceiling exists for the case where nobody is. `unattended` is threaded from the scheduler through the cycle to the tool to the engine, and **defaults to `false` at every hop** — a caller that forgets it gets the supervised behaviour, because forgetting must never be the thing that exempts a scheduled run from its own limit.

**It counts authorizations issued, not proposals raised.** A proposal the policy engine denied consumed none of the merchant's autonomy budget; counting it would let a run of denials exhaust a limit that exists to bound what actually happens.

## The lifecycle, completed

```
PROPOSED → PENDING_APPROVAL → APPROVED → AUTHORIZED → EXECUTED → VERIFIED
                                                              ↘  FAILED
   ↘ REJECTED_VALIDATION   ↘ APPROVAL_REJECTED   ↘ POLICY_DENIED
```

Part 5 stopped at `AUTHORIZED` deliberately: execution outcome lives on the rows execution writes, and duplicating amounts would create a second financial truth.

That holds for the *amounts* and does not hold for the *state*. With no terminal status, **an authorization that was issued and then failed was indistinguishable from one still waiting to run.** "What did the agent actually do" could not be answered from the governance rows at all — it had to be reassembled by joining out to whatever each action type happened to write.

The terminal states record **what happened, never how much money moved**. `VERIFIED` means the row execution claimed to write was read back and exists — not that revenue arrived. Amounts stay on the payment rows.

Transitions are validated against the domain's own table rather than written blind, and `AUTHORIZED` is the only path into `EXECUTED`: an action that skipped issuing an authorization skipped the one row proving it was permitted at the moment it ran.

## Governance: six tabs → three

| | |
|---|---|
| **Policies** | the boundaries — the only tab where a merchant *decides* anything |
| **Approvals** | what those boundaries pushed to a human |
| **Agent Ledger** | what happened, at whatever depth is needed |

A merchant asking *"is this agent safe"* needs those three in that order. Decisions, Trace and Sandbox were all different depths of the third question wearing their own tab.

**Nothing was deleted.** Every route still resolves, every page is still reachable, and old URLs still work. What changed is which pages are top-level destinations — a tab bar is a claim about what matters most, not an inventory.

## Verification: can the agent get around it?

The spec asks for proof that policy cannot be bypassed through direct API calls or manipulated frontend state. [`policy-bypass.test.ts`](../apps/api/src/policy-bypass.test.ts) is an adversarial suite that assumes the caller is hostile — not an outsider, but *the agent itself*, or a merchant user with a valid session and bad intentions.

| Attack | Result |
|---|---|
| Authorize without evaluating policy | refused; no `ACTIVE` authorization row exists |
| Authorize a proposal policy **denied** | `DENY` / `ACTION_TYPE_PROHIBITED`; nothing issued |
| Authorize while only `PENDING_APPROVAL` | denied `APPROVAL_REQUIRED` |
| Authorize a terminally-invalid proposal | **403 `AUTHORIZATION_NOT_ALLOWED`** — "can never be authorized" |
| Invoke a prohibited action via the tool endpoint | refused; `authorizationId` null |
| Invoke a tool name not in the registry | 404 — the registry is the allowlist |
| Act on another merchant's product | refused; nothing executed |
| Supply your own `discountBps: 9000` in the body | ignored; server-computed, ≤ the merchant's ceiling |
| Supply your own `marginBps: 9999` | ignored; recomputed from catalogue rows |
| Reach governance as a shopper session | 403 on all five routes |
| Reach governance unauthenticated | 401 |
| Issue two authorizations for one proposal | at most one `ACTIVE` |
| Race a policy tightening | version-stale refusal |

Every assertion checks the **specific** refusal — the reason code or status the guardrail is supposed to produce — and several re-read the database afterwards to confirm nothing was written. Asserting "some 4xx" would let a route that 404s from a renamed path look like a refusal.

## What this part nearly shipped

The bypass suite's first fixture asked only for "a product with a purchasable variant" and got one with **no product relationship**. `proposeGrowthAction` therefore returned `REJECTED_VALIDATION` with a null action type, and three tests exercised *"a proposal that was never valid"* while their names claimed *"a proposal policy denied"*.

Different guardrails; only one under test. The suite failed loudly enough that I found it — but had my accepted-status list been one entry wider, all three would have gone green while proving nothing.

That is the fourth vacuous-test near-miss in this project. The fixture now requires a relationship, and every skip is an explicit `expect(outcome).toBe("ran")` rather than a silent `return`.

## Verification

| Check | Result |
|---|---|
| `pnpm typecheck` | clean, 4 packages |
| `pnpm lint` | clean |
| `pnpm build` | green |
| Domain tests | **35 files, 469 tests** (21 new boundary tests) |
| API tests | **46 files, 456 tests** (15 bypass + 9 governed-autonomy) |
| Web tests | 9 files, 57 tests |
| Migration | applies clean; defaults are the permissive reading of existing behaviour |

The migration cannot silently change what any existing merchant's agent may do: `recoveryEnabled` defaults true, `prohibitedActions` and `eligibleCategories` default empty, `minCustomerPaidOrders` defaults 0. The two non-permissive defaults — a 10% margin floor and 50 unattended actions per day — cannot affect a merchant-triggered cycle, and no merchant is opted into unattended runs by default.

## Not verified in a browser

Same as every part since 1: signing in would mean entering a password, which I do not do. The Policies page's new controls are typechecked and built; the write path is verified end to end through the API, including that a saved boundary reaches the engine that enforces it and changes the decision.
