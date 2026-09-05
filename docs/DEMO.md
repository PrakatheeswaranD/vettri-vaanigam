# Five-minute demo

Everything below has been run end to end against a seeded local database. Timings are the target, not a promise — the point of the script is the order, which builds one argument rather than touring the product.

> **Before you start.** Complete the README setup and run `pnpm db:identities`. Run verification with `pnpm test:isolated`; it creates a separate database and leaves demo spending limits untouched.

**One-line framing to open with:** *"Any AI agent can now try to buy from this merchant. This is the gate it has to get through."*

---

## 0:00–0:30 · The problem, and the proof it is solved

Open **Activity** (the agent action ledger) on a completed workflow.

Say: agent-to-agent commerce is arriving through ACP, AP2, UAP and x402, and a merchant's real question is not "can an agent talk to me" but "what stops one spending money it shouldn't." Point at a single hash-chained workflow: intent, proposal, policy decision, execution, provider result.

**Land this:** the audit trail is the product, not a feature of it.

---

## 0:30–1:30 · The AI does the language, and nothing else

Sign in as the buyer (`customer@vettrivaanigam.demo`). Ask in natural language:

> `I need running shoes under 8000 rupees`

Show the returned recommendations. Point at the reason codes on the top result — `WITHIN_BUDGET`, `IN_STOCK`, `STRONG_METADATA` — and at the explanation, which cites the real catalogue price against the stated budget.

Say what the model did and did not do: it turned a sentence into a structured intent and ranked a candidate set the server had already filtered. It never saw a price it could change. If it returns a product that was not in that set, the grounding check drops the ranking and a deterministic ordering is used instead.

**Land this:** AI interprets language and proposes offers; deterministic code authorizes the final basket.

---

## 2:00 · The gate, fired three times

This is the centre of the demo. Same product, three quantities, three different answers.

| Quantity | Total | Outcome | Why |
|---|---|---|---|
| 1 | ₹3,489 | `AUTO_APPROVE` | under the ₹5,000 autonomous limit |
| 3 | ₹10,467 | `STEP_UP` | over the limit — the buyer is **asked** |
| 8 | ₹27,912 | `DECLINE` | over the ₹25,000 hard ceiling — the buyer is **refused** |

Say why there are two thresholds rather than one: *"how much may the agent spend without me"* and *"how much am I willing to spend at all"* are different questions. A purchase over the hard maximum is never offered for approval, because approving it was never on the table.

Point out that the request carries a variant id and a quantity — never a price. Every rupee on screen was computed on the server from the catalogue row.

**Land this:** bounded and gated, watched live rather than asserted.

---

## 3:00 · Razorpay is the settlement authority

Run, or show the output of:

```bash
pnpm --filter @razorgrowth/api razorpay:proof
```

This exercises the same `RazorpayPaymentGateway` the application uses against live Test Mode. Show `docs/evidence/razorpay-testmode-proof.json`:

- a real order (`order_…`) created against `api.razorpay.com`
- Razorpay echoing the server-computed amount back unchanged
- the reconciliation read-back that resolves an `UNKNOWN` payment
- a real Razorpay 401 arriving as `ProviderGatewayError(PROVIDER_AUTHENTICATION_ERROR)` rather than a leaked HTTP status

Be precise about the boundary: this proves the project transacts with Razorpay. It does not prove a capture — completing a checkout needs a human and a test card, and the script says so rather than implying otherwise. If you have completed the payment link beforehand, show the captured payment here.

**Land this:** the payment provider is the authority on financial truth, and the failure path is typed, not improvised.

---

## 4:00 · Break the agent

Open **Break the Agent** and run **"Raise my own spending limit"** (mandate forgery).

A real Ed25519 keypair is generated, a real mandate is signed, the attacker substitutes their own key — and the same verifier the live request path uses refuses it. Nothing here is scripted: if the guarantee regressed, this preset would report a success and say so.

If time allows, run **"Name my own price"** — the server recomputes from the catalogue and refuses the stale authorization with `PRICE_CHANGED`.

**Land this:** one failure, handled gracefully, demonstrated rather than described.

---

## 4:30–5:00 · Back to the ledger

Return to **Activity** and open the workflow the demo just created. Walk the chain once, quickly:

```
intent -> AI proposal -> validation -> policy decision -> execution -> provider result -> hash-chained event
```

Note that the conversation and the purchase share one `workflowId`, so "you recommended this" and "you charged me for it" are links in the same verifiable chain rather than two disconnected halves.

**Close with:** every money action explainable, bounded and gated — and here is the trail that shows it.

---

## Questions you should expect, and the honest answers

- **"Did a payment actually settle?"** No. The order, the amount echo, the reconciliation read and the classified failure are live; capture needs a human at Razorpay's hosted checkout. The proof script draws that line itself.
- **"Is the AI live?"** Configurable. The default is a labelled deterministic provider so the demo runs without a key; set `AI_PROVIDER=anthropic` or `gemini` for the live path. The mode is shown in the UI rather than implied.
- **"What is the weekly growth plan?"** Partially implemented, and the README says which parts. Do not demo it.
- **"Does the agent prove revenue growth?"** No. Holdout comparisons are estimates, and missing cost data is not profit.

## What not to demo

The weekly growth-plan executor, the marketplace discovery page, and the platform admin surface. They are real code, but none of them carry the argument, and each one costs thirty seconds you need elsewhere.
