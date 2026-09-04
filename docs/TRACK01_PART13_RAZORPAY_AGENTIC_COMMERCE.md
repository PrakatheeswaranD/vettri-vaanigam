# TRACK01 PART 13 — real Razorpay test-mode agentic commerce

Continues [Part 0](TRACK01_PART0_FIXES.md) → [Part 12](TRACK01_PART12_BUYER_AUTONOMY.md).

> Problems hit along the way: [TRACK01_PROBLEMS_LOG.md](TRACK01_PROBLEMS_LOG.md).

An audit, not a rebuild. The payment infrastructure was already right; the half nobody had ever driven end to end was a **buyer's** payment reaching capture, and what the buyer and the merchant see afterwards.

---

## What the audit found intact

Before changing anything I read every file on the money path and drove the chain against real data. Most of what Part 13 asks for was already true, and saying so plainly matters more than manufacturing work:

| Requirement | Verdict |
|---|---|
| Integer minor units | Held everywhere; no float touches money |
| Deterministic payment state | One `resolvePaymentEvent`, called by all four evidence sources |
| Webhook signature verification | HMAC over the **raw bytes**, in its own Fastify scope so the buffer parser cannot leak |
| Idempotency | Event fingerprint + `PaymentProviderEvent` unique constraint, plus a same-state no-op in the state machine |
| Authorization | Re-checked at pricing **and** at execution |
| Auditability | Hash-chained `AgentAction` ledger on every transition |
| The AI never moves money | No AI import anywhere on the payment path — now asserted by a test |

### There are no duplicate payment implementations to remove

The spec asks to remove duplicates after testing. I looked for them specifically:

```
webhook routes ...... 1     Razorpay HMAC modules ... 1
PaymentGateway impls  2     (the real adapter + the deterministic mock, by design)
resolvePaymentEvent   1     called from webhook, client verification, reconcile, x402
createPaymentOrder    1     call site
```

**Nothing was consolidated, because there was nothing duplicated.** Claiming a consolidation that did not happen would be worse than reporting none.

The one genuine duplication is two checkout builders — `commerce/execution-service.ts` for the merchant growth path and `gateway/execution-service.ts` for the agent path. They consume different authorization types and enforce different invariants, and merging two money paths on suspicion is exactly the risk the spec warns against. **Left alone, deliberately, and reported** — see P13-1, which is the symptom of that split and was worth fixing on its own.

## `payment.failed` never means "not debited"

The single most important assertion in this part, and it already held:

```ts
state: "FAILED",
customerDebitStatus: "UNKNOWN",      // not NOT_DEBITED
merchantCreditStatus: "NOT_CREDITED",
automaticRetryBlocked: true,
```

A debit can succeed while the credit fails. Recording that as "the customer was not charged" is how a retry becomes a double charge. There is now a test that asserts the field is `UNKNOWN` **and** explicitly not `NOT_DEBITED`, so a future simplification cannot quietly collapse the two.

## What was actually broken

The backend chain worked. What was broken was everything downstream of it — the buyer could not see what their own agent had done.

### P13-1 · Agent Activity showed 3 of 9 real events

A probe drove one conversational purchase through a real signed webhook to capture. The ledger recorded nine events. The buyer's activity page showed three.

```
ledger:    BUYER_PURCHASE_PROPOSED, BUYER_PURCHASE_AUTHORIZED,
           AGENT_CHECKOUT_CREATED, PAYMENT_INITIATION_REQUESTED,
           PAYMENT_RECORD_CREATED, PROVIDER_ORDER_CREATED,
           WEBHOOK_RECEIVED, WEBHOOK_SIGNATURE_VERIFIED, PAYMENT_CAPTURED

shown:     POLICY → AUTHORIZATION → PAYMENT
```

The stage map listed `CHECKOUT_CREATED` — what the *merchant* growth path writes. The buyer's path writes `AGENT_CHECKOUT_CREATED`. One name apart, and the CHECKOUT stage never appeared for any buyer, ever. `PROVIDER_ORDER_CREATED` — the actual Razorpay Test Mode order, the most concrete step in the entire chain — was invisible too, as were both webhook events, so the buyer could never see that their payment had been **verified** rather than assumed.

### P13-2 · An order becoming PAID left no trace

`resolvePaymentEvent` set the order to `PAID` and appended nothing. The ORDER stage could not appear because no order-level event existed to map. The buyer path also never wrote `ORDER_CREATED` at all, though the merchant path did.

Both now write. `ORDER_CONFIRMED` is written only against a verified capture.

### P13-3 · The ORDER stage would have lit up before payment

Caught in a browser, after fixing P13-2. An `Order` row exists from the moment stock is reserved, so mapping `ORDER_CREATED` to the ORDER stage lit the last step of the pipeline for a purchase that might never be paid — the same overstatement as a checkout screen saying "order placed" because a row was inserted.

`ORDER_CREATED` sits under CHECKOUT, which is what it is. **ORDER means the buyer has an order**, and only a verified capture produces one.

### P13-4 · One journey was several unrelated hash chains

The ledger workflow id was the per-turn `traceId`. A buyer who searched in one turn and bought in another wrote three separate chains, so their own activity showed one journey as three disconnected cards with nothing joining *"I recommend this"* to *"you were charged for it"*.

A per-request correlation id had been doing a workflow's job by accident. `BuyerConversation.workflowId` now holds the journey; `traceId` still correlates one request's logs and response, which is the job it is actually for.

```
BUYER_INTENT_EXTRACTED → PRODUCTS_DISCOVERED → RECOMMENDATION_PROPOSED
→ OFFERS_EVALUATED → BUYER_PURCHASE_PROPOSED → BUYER_PURCHASE_AUTHORIZED
→ ORDER_CREATED → AGENT_CHECKOUT_CREATED → PAYMENT_INITIATION_REQUESTED
→ PAYMENT_RECORD_CREATED → PROVIDER_ORDER_CREATED → WEBHOOK_RECEIVED
→ WEBHOOK_SIGNATURE_VERIFIED → ORDER_CONFIRMED → PAYMENT_CAPTURED
```

Fifteen events, one chain, read back from the database.

### P13-5 · The activity feed silently became "spending only"

Found by looking at the running app rather than at the code. The feed concatenated purchase workflows and conversation workflows, then took the first twenty. Purchases came first, so a buyer with twenty or more proposals — **the demo shopper has ninety-six** — never saw a single search-only workflow.

The docblock on that very function says a search that never became a purchase is still the agent's activity and omitting it would make the feed look like it only records spending. It did exactly that, for precisely the buyers who use the agent most. Both sources are now merged on their own timestamps.

### P13-6 · A failed step looked identical to a successful one

Introduced by P13-1: once failure events could reach the page, every event still rendered with the same blue dot. A refused capture and a completed one looked the same. Failure statuses now render in the danger colour.

### P13-7 · A load-bearing `!` on a nullable column

`webhook-service.ts` did `payment.checkoutId!`. `Payment.checkoutId` is nullable and **55 of 512 rows are null**.

Reported precisely: those 55 are seeded `DEMO` history with no provider references at all, and the webhook resolves payments by `provider` + `providerOrderId`, so **not one of them is reachable** — this was a latent hazard, not a live bug, and I checked rather than assuming either way. Had one ever arrived, Prisma would have thrown inside the route, the request would have 500'd, and Razorpay would have retried something no retry could fix. Now recorded as UNRESOLVED, which ends the retry loop and leaves the row for a human.

## Verification

| Check | Result |
|---|---|
| `pnpm typecheck` | clean, 4 packages |
| `pnpm lint` | clean |
| `pnpm build` | green |
| API tests | **51 files, 513 tests** (16 new) |
| Domain tests | 36 files, 528 tests |
| Web tests | 10 files, 69 tests |
| Contracts tests | 1 file, 6 tests |

The Part 13 suite drives the whole chain: a real conversation, a real proposal, a real authorization, a real provider order, and a webhook posted to the real route, signed with the real HMAC function, parsed by the real schema and resolved by the real state machine. The only test double is the provider itself, and it verifies signatures with the same algorithm as the live adapter.

It asserts three deliveries produce exactly one capture; that a tampered body with a valid signature changes nothing; that a correctly-signed event reporting the wrong amount is refused and recorded; that a stale `authorized` after a `captured` does not regress anything; that a failure leaves the debit status `UNKNOWN`; that redelivering a failure does not release the same stock twice; and that no file on the payment path imports an AI provider.

## Verified in a browser — the first part that was

Every part since 1 ended with "not verified in a browser". This one did not.

Running against the local database, signed in as the demo shopper, the activity page renders the full pipeline from the ledger — `Understood what you asked for → Searched the catalogue → Recommended products → Checked for offers → Checked your spending policy → Authorization → Created the checkout → Payment → Order` — with every step's real `conciseReason`, actor and action type beneath it, including *"Razorpay Test Mode order created: mock_order_…"* and *"Webhook signature verified against the raw request body."*

P13-3 and P13-5 were both **found this way and would not have been found any other way**: one was a stage lighting up too early, the other was a card that never appeared. Both look completely correct in the code.

The failure dot was confirmed by reading its computed style back off the live page — `rgb(220, 38, 38)`, the danger token — rather than by trusting the class name, which is how I found that the palette has no `danger-600`.

## One thing to know before deploying

`apps/api/prisma/migrations/20260905000000_conversation_workflow` has been applied to the **local** database only. The `DATABASE_URL` in `.env` points at a hosted Supabase instance, and I did not run a migration against it — that is a change to a real database and it is yours to make:

```bash
pnpm --filter @razorgrowth/api db:migrate
```

The column is nullable with no backfill, so it is additive: conversations created before it fall back to the turn's `traceId`, exactly as they behaved before.
