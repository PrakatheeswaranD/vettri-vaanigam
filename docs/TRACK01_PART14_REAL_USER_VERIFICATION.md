# TRACK01 PART 14 — real-user verification

Continues [Part 0](TRACK01_PART0_FIXES.md) → [Part 13](TRACK01_PART13_RAZORPAY_AGENTIC_COMMERCE.md).

> Problems hit along the way: [TRACK01_PROBLEMS_LOG.md](TRACK01_PROBLEMS_LOG.md).

Both journeys driven end to end in a browser as a person, not as a developer reading source. Six real defects found and fixed, each rerun afterwards.

---

## How this was tested

Every claim below is backed by four things, not one: the click, the network call, the backend log, and a direct read of the database. A 200 was never taken as proof.

The app ran against the local database with the real Razorpay Test Mode adapter — `GET /system/capabilities` reported `paymentProvider: RAZORPAY_TEST_MODE` throughout, and the buyer's purchase produced provider order `order_TXqh077kSzt0vI`, which is a Razorpay id, not the mock's `mock_order_…`.

## What the defects had in common

Five of the six are invisible to the test suite and to code review, because each one only appears when a **person** does the ordinary thing: press Save, click the button, watch what the page does next. The suite was green before this part and green after it; it was never going to find them.

---

## P14-1 · The whole app rendered a blank white page when the database was down

Hit by accident and worth more than anything I planned. The local database died mid-session and the app rendered **nothing at all** — `#root` empty, no message, no retry, at `/merchant/overview`.

`RequireAuth` redirected to `/login` on *any* error from `/auth/me`. For a 401 that is right: the API client has already cleared the token, so the login form renders. For a **500** the token is still there, so the login screen bounced straight back — guard → login → guard → login, which React Router resolves by rendering nothing.

A database blip or a deploy restart left a signed-in user staring at a white screen with no way out but clearing site data.

Now a 401/403 goes to login as before, and anything else says so and offers to try again. Verified by restarting the database and clicking **Retry**: the session recovered in place, no re-login, route preserved.

## P14-2 · An "Observed" figure paired a count and an amount from different populations

The Overview's *Revenue at risk* tile read **₹9,06,052.00 — 186 failed payments and stalled checkouts that exist right now**, under a heading promising figures "countable right now in your own orders and payments".

The amount came from the opportunity cards. The count came from a different endpoint counting failed payments. They disagreed by ₹11,783 against real data, and the caption implied one explained the other.

The composition, once traced: recoverable failed payments ₹7,49,770 + unknown-outcome ₹1,39,179 + abandoned checkouts ₹17,103 — never the 186 it named. Now the tile counts the cards the amount was actually summed from, and reconciles exactly.

## P14-3 · The Merchant Agent's own headline objective failed on every cycle

Clicking **Run a cycle** returned `"failed": 3`, every step reading *"An unexpected error stopped this step."* — against the objective printed at the top of the console, *"Verify payments with an unknown outcome"*.

`reconcilePayment` never compared `Payment.provider` to the configured gateway. On a Razorpay-configured server it asked Razorpay about `mock_order_…` identifiers: a call that cannot succeed, once per payment, every cycle, forever.

This is not only a dev-data artifact. Any deployment that changes provider, or holds rows from a previous one, has payments the current gateway never made — and an answer from the wrong provider is not a worse answer, it is a meaningless one, in the one function whose job is deciding financial truth.

Refused now, with the reason said out loud. `CONFLICT` is deliberate: `REFUSAL_CODES` classifies it as a guardrail declining rather than an outage, so a working safeguard is not counted among failures.

**Reran the cycle: `failed: 3` → `failed: 0`.**

## P14-4 · An unexpected error was shown to nobody and logged nowhere

Underneath P14-3. `classifyToolError` returned that generic sentence for any non-`AppError` and dropped the error on the floor. A real provider outage and a typo in an id were indistinguishable — to the merchant, and to whoever they asked, because nothing reached the logs either.

The merchant still gets a short honest sentence; the actual error now reaches the operator, with the tool name, merchant, workflow and subject.

## P14-5 · A buyer could not save their spending policy at all — including to tighten it

Pressing **Save spending policy** returned a bare `400 VALIDATION_ERROR`. For every change. For **1 of 1** buyer policies in the database.

The read schema had no maximum; the update schema capped every amount at the single-purchase ceiling. So the server returned a policy — one it had seeded itself — that it would then refuse to accept back.

The modelling error underneath: `dailyLimitMinor` bounds a **sum across purchases**, and it was capped at the single-purchase maximum. "Up to ₹10,00,000 per purchase, a few times a day" was not expressible.

The direction that matters: a spending control that cannot be saved is one a buyer **cannot lower**. That is worse than a cosmetic bug.

Both shapes now share `MAX_SINGLE_PURCHASE_MINOR` and `MAX_DAILY_SPEND_MINOR`, with the daily ceiling above the per-purchase one. A contracts test asserts the property rather than either number: *anything the read shape accepts, the update shape must accept.*

**Reran the save: 400 → 200**, and `restrictedCategories: ["Hydration"]` landed in the database.

## P14-6 · A checkout that never opened left the page unusable

Clicking **Complete Razorpay Test checkout** loaded Razorpay's real script and opened their hosted checkout — and their frame answered 403 to an automated browser and never rendered. `modal.ondismiss` never fired, `handler` never fired, the promise never settled: the button stuck on *"Opening checkout…"* under a full-screen backdrop, with no way out but a reload.

Their bot protection is not a product defect. **Everything downstream of it is**, and the same dead end is reachable by an ad blocker or a CSP.

The buyer now gets *"Close the payment window"* while the checkout is open. Deliberately a human escape rather than a timer: a timer long enough to be safe is useless, and a short one would interrupt somebody midway through paying. It asserts nothing about the payment.

First attempt was half a fix — the button recovered but Razorpay's `close()` does nothing to a frame that never initialised, so the backdrop stayed. Verified again, and this time the container is removed if their teardown does not do it.

**Reran: overlay gone, backdrop gone, button enabled, page usable** — and the payment still `CREATED` / debit `UNKNOWN` / `capturedAt: null`.

---

## What the agents actually did, proven in the database

### Merchant Agent

One click of **Run a cycle**, measured before and after:

| | before | after |
|---|---|---|
| ledger rows | 16,478 | 16,518 |
| growth proposals | 1,179 | 1,197 |
| proposals awaiting approval | 40 | 42 |

The run detected 10 opportunities across 229 actionable items, worked 12, executed 1, escalated 1 for approval, and refused 10 with a stated reason each. Ledger tail: `RECOVERY_PROPOSAL_CREATED → POLICY_ALLOWED → EXECUTION_AUTHORIZATION_ISSUED → AGENT_RUN_COMPLETED`.

**Approving one**, with a typed reason, through the Governance screen:

```
approvals              87 → 88
pending approvals      42 → 41
execution authorizations 769 → 770
proposal status        PENDING_APPROVAL → AUTHORIZED
approver               owner@meridianathletics.demo (server-derived, not client-supplied)
ledger                 … → APPROVAL_APPROVED → EXECUTION_AUTHORIZATION_ISSUED
```

### Buyer Agent

Typed as a shopper would type: *"I need running shoes under 5000"* → 5 grounded recommendations, every one under budget, each with its own stated reason. Then *"buy the first one"* → priced at ₹3,489.00 with an itemised breakdown and an explicit "nothing has been charged". Then *"yes"*:

```
providerOrderId  order_TXqh077kSzt0vI      ← real Razorpay Test Mode
payment          CREATED · RAZORPAY · ₹3,489.00 · debit UNKNOWN · captured null
order            PAYMENT_PENDING
ledger           BUYER_INTENT_EXTRACTED → PRODUCTS_DISCOVERED → RECOMMENDATION_PROPOSED
                 → OFFERS_EVALUATED → BUYER_PURCHASE_PROPOSED → BUYER_PURCHASE_AUTHORIZED
                 → ORDER_CREATED → AGENT_CHECKOUT_CREATED → PAYMENT_INITIATION_REQUESTED
                 → PAYMENT_RECORD_CREATED → PROVIDER_ORDER_CREATED
```

Eleven events, one workflow — Part 13's chain, rendered on the buyer's own Agent Activity page as eleven steps.

### And policy actually stops a purchase

The strongest end-to-end check in this part, because it crosses every layer. Set *"Never buy from: Hydration"* through the form; asked the agent for a hydration belt. It found five (a restriction governs buying, not seeing). Asked to buy one:

> **Your spending policy said no to that one.** — `CATEGORY_NOT_ALLOWED, CATEGORY_RESTRICTED`

`outcome: DECLINE`, no order, no payment. A boundary typed into a form by a person, enforced in deterministic backend code, against a real catalogue product.

## Everything else exercised

Landing (nav, CTAs, the scripted transaction demo); login **empty-submit** (client-validated, no request fired), **wrong password** (401, no user-enumeration leak), and success; logout; merchant Overview, Agent Console / Readiness / Connect, Growth's four tabs, Commerce's five, Governance's three; **Recalculate Readiness** (snapshots 32 → 33); **Run conformance checks** (11/11, real HTTP, including a 402 challenge and a forged payment header refused); the Boundaries form saved and restored (`bundleEnabled` false → true, round-tripped through the database); the per-payment manual agent tool; buyer Discover with search, an **empty state**, and Clear filters recovering; Orders; Payments; Agent Activity; Spending Policy including its conflict guard (warning shown *and* save disabled).

## Verification

| Check | Result |
|---|---|
| `pnpm typecheck` | clean, 4 packages |
| `pnpm lint` | clean |
| `pnpm build` | green |
| API tests | **51 files, 514 tests** (1 new) |
| Domain tests | 36 files, 528 tests |
| Web tests | 10 files, 69 tests |
| Contracts tests | **2 files, 12 tests** (6 new) |

## What I did not do

**I did not complete a payment.** Finishing the Razorpay checkout means typing a card number into a payment field, which I do not do — test card or not. The integration is proven up to Razorpay's own hosted UI (real order, real public key, their script, their session), and the capture path beyond it is covered by Part 13's suite through signed webhooks, which is the authoritative path regardless.

**Razorpay's 403 is theirs, not ours.** Their checkout refuses to render in an automated browser. I fixed what that exposed on our side and did not report their bot protection as a product bug.
