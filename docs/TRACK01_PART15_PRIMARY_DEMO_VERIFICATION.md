# TRACK01 PART 15 — primary demo verification

Continues [Part 0](TRACK01_PART0_FIXES.md) → [Part 14](TRACK01_PART14_REAL_USER_VERIFICATION.md).

> Problems hit along the way: [TRACK01_PROBLEMS_LOG.md](TRACK01_PROBLEMS_LOG.md).

Both primary demos driven end to end, plus one deliberate failure. Four defects found and fixed, each rerun.

---

## DEMO A — merchant revenue growth

One click of **Run a cycle**, traced through every stage against the database.

| Stage | Evidence |
|---|---|
| Real merchant data | 10 opportunities from this merchant's own catalogue and payments |
| Opportunity detected | *"11 selling products are marked promotion-eligible by you, and no bounded offer is currently attached"* |
| Agent analysis → structured action | `CROSS_SELL`, StrideLace Kit → CoolMax Socks, reason codes `MERCHANT_CONFIGURED_RELATIONSHIP, COMPLEMENTARY_PRODUCT, READINESS_SUPPORTED` |
| Policy | `ALLOW` · `WITHIN_AUTONOMOUS_LIMIT` |
| Automatic execution | `ExecutionAuthorization` ACTIVE, bounds `{currency: INR, orderAmountMinor: 64800}` |
| Execution | proposal `EXECUTED` |
| Verification | deliberately **not** `VERIFIED` — nothing has touched a basket yet |
| Revenue measurement | **₹5,58,486.00** captured across **114** agent-proposed orders, verified against the database |
| Agent ledger | `GROWTH_PROPOSAL_CREATED → POLICY_ALLOWED → EXECUTION_AUTHORIZATION_ISSUED` |
| Merchant UI | run summary, per-step cards with stage rails, recovered-revenue tile |

### The useful revenue action, proven where it actually matters

An authorized offer is only useful if a buyer receives it. Demo B's purchase closes that loop: a **5% offer the merchant's own policy engine authorized** reduced a real basket from ₹4,500.00 to **₹4,275.00**, recomputed against that basket rather than copied.

### A15-1 · The agent reported closing a gap it had not closed

The `ELIGIBLE_OFFER` opportunity says *"the permission exists; the offer does not"*. The agent answered it with a **cross-sell carrying no discount**, and reported *"Authorized and ready."* A merchant reading the card's own title concludes the offer gap is closed. It was not.

`proposeGrowthActionTool` handles three different opportunity types and returned **one fixed sentence for all of them**, with no way to tell which gap it was answering.

That the proposal carries no offer is often *correct* — the demo provider deliberately never invents a discount without real signal, which is the behaviour we want. Reporting it as though it had created the offer is not.

The tool now receives the opportunity type and names what it actually did:

> Authorized a cross sell **with no discount attached**. … **This does NOT close the missing-offer gap that was detected**: no bounded offer was proposed, because the agent will not invent a discount without a reason in your own data.

---

## DEMO B — AI buyer

Driven by typing, as a shopper would.

| Stage | Evidence |
|---|---|
| Buyer intent | *"I need running shoes over 4500 and under 4520"* |
| Discovery | constraints `category = Running Shoes`, `budget ≥ ₹4500`, `≤ ₹4520`, `must be purchasable now` |
| Grounded reasoning | *"Ranked #1: costs ₹4,500; ₹20 below your ₹4,520 maximum; is currently in stock"* |
| Recommendation | Meridian Pulse Runner — UK7 (Blue) |
| **Offer** | 5% / −₹224.95 on ₹4,499 — *"Authorized by the merchant's policy engine on 2026-09-04"* |
| Spending policy | `AUTO_APPROVE` — within the buyer's saved limits |
| Authorization | explicit "yes"; allowance reserved |
| Checkout | cart → order → checkout session, stock reserved transactionally |
| **Razorpay Test Mode** | `order_TXuhbBzjvkdTEL` — a real Razorpay order id, for the discounted ₹4,275.00 |
| Payment verification | signature verified over the raw bytes |
| Order | `PAID`, ₹4,275.00 |
| Merchant update | order visible to the merchant as PAID at ₹4,275.00 |
| Agent activity | nine stages, 15 steps, ending in **ORDER** |

The offer was **applied, not just displayed**, and recomputed against this basket:

```
1 × ₹4,500.00              ₹4,500.00
Merchant offer, 5% off       −₹225.00     (not the merchant's ₹224.95 against a different variant)
Total                      ₹4,275.00
```

### B15-1 · A buyer was quoted a discount the merchant had forbidden

`findBuyerVisibleOffers` checked status and product, and never checked whether the merchant still permits promoting that product.

On the seeded data this was not hypothetical. **Every single committed offer — all 151 — sat on Meridian Pulse Runner, which was marked `INELIGIBLE`**, and zero committed offers existed on any of the 64 `ELIGIBLE` products. A buyer was being quoted ₹224.95 off ₹4,499 on a product its own merchant had excluded from promotion.

The growth engine honours the flag when **detecting**. Nothing honoured it at the point the discount was **shown and charged**.

Only an explicit `INELIGIBLE` now suppresses an offer: `UNKNOWN` is the absence of a statement, not a refusal, and revoking a governed offer on silence would be its own invention.

### B15-2 · A promised filter that did not exist and could not

The same file's docblock promised *"Not expired — an authorization that lapsed is not an offer."* **No such check existed**, and on inspection every authorization behind those offers had already lapsed.

It cannot be implemented as written: `GrowthActionProposal` **has no validity window**. The only time bound in reach is the `ExecutionAuthorization`'s ~10 minutes, and that bounds executing one checkout, not how long a merchant's price commitment stands. Treating them as the same thing would invent a product rule about money.

So the promise is **withdrawn rather than faked**, and what is actually enforced is now stated — with the missing field named as the thing a merchant would need before offers can lapse.

### B15-3 · The seed contradicted itself

Why did every offer sit on an ineligible product? The seed assigns eligibility by index — `productIndex % 7 === 0 → INELIGIBLE` — and Pulse Runner is index 0. It is also the buyer's worked example, the relationship graph's hub, and the product every offer fixture discounts.

Nothing enforced the flag, so the contradiction was invisible. Now that it is enforced, the seed has to mean what it says: a named set keeps the demo's hero product out of the index rule.

---

## The deliberate failure

A second real purchase (`order_TXulniQqy81JnA`, ₹4,275.00) failed on purpose with a retryable `GATEWAY_ERROR`.

| Stage | Evidence |
|---|---|
| Failure | `payment.failed`, signature verified |
| **Correct diagnosis** | `failureCode: GATEWAY_ERROR` → `failureCategory: PROVIDER_ERROR` |
| **Safe payment state** | `customerDebitStatus: UNKNOWN` — never "not debited"; `merchantCreditStatus: NOT_CREDITED`; `automaticRetryBlocked: true`; inventory reservation released |
| Policy | `RECOVERY_ELIGIBILITY_EVALUATED` → `POLICY_ALLOWED` |
| Recovery when eligible | `RETRY_SAME_CHECKOUT`, reasons `RETRYABLE_PAYMENT_FAILURE, RECOVERY_ATTEMPT_AVAILABLE`; a **new** checkout, never a silent re-charge |
| Verification | attempt #2 `CAPTURED`, order `PAID`, checkout `COMPLETED` |
| Audit | **28 events on one workflow** |

The detail that matters most: after recovery succeeded, **attempt #1 still reads `debit=UNKNOWN`**. The system never retroactively claims the first attempt did not charge the customer — which is exactly the assumption that turns a retry into a double charge.

```
attempt #1: FAILED    debit=UNKNOWN  credit=NOT_CREDITED  failure=PROVIDER_ERROR
attempt #2: CAPTURED  debit=DEBITED  credit=CREDITED
order     : PAID ₹4,275.00
```

Merchant UI: **₹1,17,576.00 recovered across 24 orders** whose money arrived only on a later bounded retry.

### F15-1 · Running the demo broke the test suite

Driving these demos left the shared demo shopper with settled purchases, and three assertions in `customer-negotiation.test.ts` began failing.

Not pollution I could clean up and forget: the test's own reset cleared `SETTLED` and `REFUNDED` and **missed `CAPTURED`** — the status a *real* purchase produces and the service counts. So any genuine run of the product's primary demo broke its own test suite.

Both status lists are now exported from the service and the reset derives from them. A fixture reset that knows less than the code it is resetting is not a reset.

---

## Verification

| Check | Result |
|---|---|
| `pnpm typecheck` | clean, 4 packages |
| `pnpm lint` | clean |
| `pnpm build` | green |
| API tests | **51 files, 516 tests** (2 new) |
| Domain tests | 36 files, 528 tests |
| Web tests | 10 files, 69 tests |
| Contracts tests | 2 files, 12 tests |

The two new tests pin B15-1 from both sides: an offer stops being quoted the moment a product is marked `INELIGIBLE`, and keeps being quoted while it is merely `UNKNOWN`.

## Honesty about the payment evidence

Two payments were captured here by delivering `payment.captured` webhooks **signed with the merchant's own configured secret** — the mechanism `scripts/demo-golden-path.ts` already provides, and its caveat applies unchanged:

> This is a genuine exercise of the real verification pipeline — signature check over raw bytes, schema validation, idempotency, the payment state machine, ledger append. The app cannot tell it from a real delivery, which is the point.
>
> **It is not evidence produced by Razorpay.** Say "this exercises our webhook pipeline end to end", never "Razorpay confirmed this payment".

What *is* Razorpay's own evidence: the order ids. `order_TXuhbBzjvkdTEL`, `order_TXulniQqy81JnA` and `order_TXupquJpT5Ln8t` were returned by live calls to `api.razorpay.com` in Test Mode.

I did not complete the hosted checkout, because that means typing a card number into a payment field — test card or not.
