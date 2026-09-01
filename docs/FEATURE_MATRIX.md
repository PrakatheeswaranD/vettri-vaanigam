# Feature Matrix

Status of every meaningful feature, as verified on 31 Aug 2026 against a
running stack (Fastify API on `:4000`, Vite SPA on `:5173`, local PGlite
Postgres, live Gemini provider, Razorpay **Test Mode**, x402 on Base
Sepolia testnet).

A feature is **COMPLETE** only where the whole chain was exercised in the
running application — database → domain → API → frontend client → UI →
user action → backend effect → database effect → UI update. Where a
column was not exercised for a given feature it says so rather than
inheriting a neighbouring row's evidence.

Legend: **Browser** = driven through the real UI; **E2E** = full chain
including a persistence re-read; `—` = not exercised in this pass.

There are no `n/a` columns left. Every protocol and post-purchase surface
that previously had "no frontend by design" now has one, because "by
design" was mostly an accident: the backends existed, were tested, and
simply had no caller. See [Filling the gaps](#filling-the-gaps).

| Feature | Database | Backend | API | Frontend API | Frontend UI | Browser | E2E | Status |
|---|---|---|---|---|---|---|---|---|
| Demo login (customer / merchant) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | COMPLETE |
| Role isolation (customer ≠ merchant ≠ admin) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | COMPLETE |
| Buyer Agent intent extraction | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | COMPLETE |
| Catalogue grounding / vocabulary | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | COMPLETE |
| Product discovery + recommendation | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | COMPLETE |
| Agent trace ("how this was worked out") | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | COMPLETE |
| Buyer spending policy (read/update) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | COMPLETE |
| Explicit "allow every category" control | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | COMPLETE |
| Deterministic purchase policy decision | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | COMPLETE |
| Step-up (human authorization above limit) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | COMPLETE |
| Bounded negotiation / offer eligibility | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | COMPLETE |
| Order + checkout execution | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | COMPLETE |
| Razorpay Test Mode order creation | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | COMPLETE |
| Razorpay Checkout SDK handoff | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ | — | PARTIAL |
| Webhook signature verification | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | COMPLETE |
| Webhook idempotency (replay safety) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | COMPLETE |
| Payment capture → state transition | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | COMPLETE |
| Payment failure classification | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | COMPLETE |
| Debit/credit modelled as distinct states | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | COMPLETE |
| Automatic-retry blocking on ambiguity | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | COMPLETE |
| Recovery proposal → policy → resolution | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | COMPLETE |
| Agent Action Ledger (hash-chained) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | COMPLETE |
| Customer purchase history | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | COMPLETE |
| Merchant overview dashboard | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | COMPLETE |
| Merchant payments / transactions | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | COMPLETE |
| Real decision latency reporting | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | COMPLETE |
| Agentic Readiness score | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | COMPLETE |
| Marketplace discovery (multi-merchant) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | COMPLETE |
| Catalogue management / publishing | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | COMPLETE |
| Growth opportunities & campaigns | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | COMPLETE |
| Adaptive agent trust score | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | COMPLETE |
| Natural-language policy authoring (diff only) | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | COMPLETE |
| Red-team / break-the-agent sandbox | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | COMPLETE |
| **Live protocol conformance runner** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | COMPLETE |
| ACP checkout sessions + signature enforcement | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | COMPLETE |
| x402 challenge / quote | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | COMPLETE |
| x402 on-chain settlement | ✅ | ⚠️ | ⚠️ | ✅ | ✅ | ✅ | — | EXPERIMENTAL |
| AP2 / SD-JWT envelope normalization | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | EXPERIMENTAL |
| UAP / UCP basket adapters | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | EXPERIMENTAL |
| Agent-readable catalogue (JSON-LD) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | COMPLETE |
| MCP tool manifest | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | COMPLETE |
| **Refunds (full + partial)** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | COMPLETE |
| **Returns lifecycle** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | COMPLETE |
| **Fulfillment / tracking** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | COMPLETE |
| **Disputes / chargebacks** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | COMPLETE |
| **GST calculation (CGST/SGST/IGST)** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | COMPLETE |
| Guided demo tour (live evidence) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | COMPLETE |

## Filling the gaps

The previous revision of this table carried `n/a` in the frontend columns
for every protocol and post-purchase surface, and marked post-purchase
COMPLETE with ✅ in columns it had not earned. Both were wrong, and in
different ways.

**`n/a` was hiding real gaps.** A backend with no caller is not "not
applicable" — it is unreachable. Four fixes closed them:

- **Live protocol conformance** (`components/protocols/LiveConformance.tsx`).
  Seven checks that make real HTTP calls from the browser to the live
  server and report the status code that came back. Verified: discovery
  200, MCP manifest 200, x402 → **402 quoting 469900 minor units on
  eip155:84532**, forged x402 payment refused, unsigned ACP session →
  **401**, unsigned gateway intent → **403**, ₹0.01 price forgery → **403**.
  Half the checks pass only on a *refusal*, so the panel cannot go green
  by authentication breaking.
- **Post-Purchase Operations page** (`routes/PostPurchasePage.tsx`).
  Refunds, returns, fulfillment, disputes and GST, all against endpoints
  that previously had no frontend caller at all. A real partial refund of
  **₹500.00** was issued through the UI and came back `PROCESSED`.
- **x402 was advertised but not configured.** The console listed x402 as
  available while the server answered `503 PAYMENT_NOT_CONFIGURED`,
  because `X402_ASSET` / `X402_PAY_TO` were only ever set in the test
  harness. Now set to the same Base Sepolia testnet values in `.env` and
  documented in `.env.example`.
- **The demo tour was reporting verification it had not performed.**
  Four steps fabricated their results client-side — "Simulate Inbound ACP
  & x402 Handshakes" fetched `/system/capabilities`; "Trigger Step-Up"
  returned a hardcoded object and called nothing. All four now call the
  real surfaces and report what actually came back.

## Notes on the non-COMPLETE rows

**Razorpay Checkout SDK handoff — PARTIAL.** The server-side half is fully
verified: real Razorpay Test Mode orders created through the live API
(`order_TWQpPUhbM2vytY`, `order_TWR7w4mibKxOVj`), the SDK loads, and
Razorpay's Test Mode checkout iframe initializes. The card form itself was
not driven to completion — entering card numbers is outside what this
audit does automatically, and the sandboxed browser does not complete
Razorpay's iframe handshake. The states a completed card payment produces
were verified through signature-verified webhooks instead, which also
proves signature checking and replay safety.

**x402 on-chain settlement — EXPERIMENTAL.** The 402 challenge, the priced
`accepts` offer, header decoding and the governed retry are real and
browser-verified. Settlement is not: no facilitator is called and nothing
settles on-chain. The API says so in its own responses and the console
labels it a compatibility shim rather than claiming the protocol whole.

**AP2 / SD-JWT and UAP / UCP — EXPERIMENTAL.** Envelope normalization is
implemented and tested; SD-JWT verifiable credentials are **not**
cryptographically verified, so an AP2 mandate is accepted on its shape.
This is the repository's own stated claim and the audit did not find it
overstated.

**Rows marked `—` under Browser.** Verified through the API and database
rather than by driving the UI. Their surfaces exist and render; what was
not re-exercised in this pass is the click-through.
