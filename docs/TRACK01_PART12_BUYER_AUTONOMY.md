# TRACK01 PART 12 — buyer autonomy, spending policy and activity

Continues [Part 0](TRACK01_PART0_FIXES.md) → [Part 11](TRACK01_PART11_PRODUCT_DISCOVERY.md).

> Problems hit along the way: [TRACK01_PROBLEMS_LOG.md](TRACK01_PROBLEMS_LOG.md).

The buyer sets the boundaries. The backend enforces them. The activity page shows what actually happened, read from the ledger the agent writes as it works.

---

## What was already right

`BuyerSpendingPolicy` existed with a real engine behind it: an approval threshold, a daily limit that counts pending purchases as well as completed ones, a category allow-list with an explicit wildcard boolean, and a re-check at authorization time. Purchases were priced in exactly one function.

**And there was no fake agent activity to remove.** The spec asks for that specifically. The old activity view was thin, but every field on it came from a real `DecisionRecord`. The work was making the *real* events visible — not deleting invented ones.

## The boundaries that could not be expressed

Five of the seven the spec names had nowhere to live:

| Boundary | Before | Now |
|---|---|---|
| Maximum purchase amount | — | `maxPurchaseAmountMinor` — **hard refusal** |
| Approval threshold | `autonomousPurchaseLimitMinor` | unchanged |
| Daily spending limit | `dailyLimitMinor` | unchanged |
| Restricted categories | — | `restrictedCategories` — beats every allow |
| Preferred categories | — | `preferredCategories` — ranking signal only |
| Automatic purchase permission | — | `autoPurchaseEnabled` |
| Merchant restrictions | — | `restrictedMerchantIds` |

### Why the ceiling is not the threshold

`autonomousPurchaseLimitMinor` is the point above which the buyer is **asked**. There was nothing that meant **refused**.

One number was doing both jobs, so a buyer who wanted the agent to handle larger routine purchases could only get that by also accepting larger exposure. They are two different questions — *how much may the agent spend without me* and *how much am I willing to spend at all* — and they now have two different fields.

Above the ceiling the proposal is `DECLINED`, not `STEP_UP`. The buyer is not offered the chance to approve something they already said never to do.

### Restrictions beat allows, always

The obvious implementation treats `allowedCategories` and `restrictedCategories` as alternatives. Then a category on both lists resolves by whichever check runs first, and **"never buy this" becomes negotiable by editing a different field**.

Restrictions are checked independently, after the allow-list, so restricted always wins — including over `allowAllCategories`. The update contract additionally refuses to save a category on both lists, and the policy screen warns before you press save, so the buyer resolves the contradiction rather than discovering later which one the engine picked.

`preferredCategories` is documented in the schema as a ranking signal and never read as a gate, because the obvious next change is to "enforce" it and that would silently convert a preference into a restriction.

## Enforced where money is decided, not where it is displayed

Every boundary is checked in `createPurchaseProposal` — the one function both `POST /buyer/purchases` and the Buyer Agent conversation call. There is no second place a purchase is priced, so there is no second place a boundary can be skipped.

```
MAX_PURCHASE_AMOUNT_EXCEEDED   → DECLINED
CATEGORY_RESTRICTED            → DECLINED
MERCHANT_RESTRICTED            → DECLINED
autoPurchaseEnabled = false    → STEP_UP, at any amount
```

The policy-bypass suite from Part 8 already proves the frontend cannot talk the backend into anything; Part 12's boundaries sit inside the same function it attacks.

### And re-checked at authorization

`authorizePurchaseProposal` re-reads the policy before executing, precisely so a buyer who changes their mind between pricing and authorizing is obeyed. It was re-checking category, currency and the autonomous ceiling — and would have sailed past every new boundary above it.

That window is exactly when someone changes their mind. All five are re-checked there now, and a test restricts a category *after* a proposal is priced and asserts the in-flight authorization is refused.

## Agent activity: the ledger, not a summary

The old page showed three fields per purchase proposal — policy outcome, reason code, negotiation status. Real data, and not activity: it showed the **result** of a pipeline while the pipeline was invisible, and a conversation that searched without buying produced no row at all.

`activity-service.ts` reads the `AgentAction` ledger and maps each row to one of the ten stages the spec names:

```
INTENT → DISCOVERY → COMPARISON → RECOMMENDATION → OFFER CHECK
       → POLICY → AUTHORIZATION → CHECKOUT → PAYMENT → ORDER
```

Eight of the ten were **already writing real ledger events and nothing was reading them**. Two were not: COMPARISON and OFFER CHECK pushed a trace stage and wrote nothing durable — real backend actions the buyer could never see afterwards. Both now write.

The offer check records even when no offer applies. *"We checked and there were none"* and *"we never checked"* are different facts, and only one of them means the buyer saw list price for a good reason.

### Scoped by the buyer, never by the merchant

Workflows are gathered from the buyer's own decision records and conversations. Scoping by merchant would have been simpler and would have shown one buyer another party's agent activity.

### What did not happen is absent

A workflow that searched and stopped renders `INTENT → DISCOVERY → RECOMMENDATION` and nothing else. It does not render a ten-step tracker with seven greyed-out steps — a progress bar showing work nobody did is a lie with a nice animation.

### No chain-of-thought

Each event carries the ledger's own `actionType`, the actor, the timestamp, and the structured reason written **at the time of the action**. A test asserts every returned event exists in the ledger with a matching id, actor and timestamp. Model reasoning is neither persisted nor rendered.

## Verification

| Check | Result |
|---|---|
| `pnpm typecheck` | clean, 4 packages |
| `pnpm lint` | clean |
| `pnpm build` | green |
| API tests | **50 files, 497 tests** (13 new) |
| Domain tests | 36 files, 528 tests |
| Web tests | 10 files, 69 tests |
| Contracts tests | 1 file, 6 tests |

The Part 12 suite asserts each boundary refuses at the backend with the frontend uninvolved, that a restriction applied mid-flight stops an authorization already in progress, and that every event the activity endpoint returns is a real ledger row rather than a rendering of one.

## Not verified in a browser

Same as every part since 1. The policy screen's new controls and the activity timeline are asserted at the DOM level with `@testing-library/react`; nothing here is a screenshot.
