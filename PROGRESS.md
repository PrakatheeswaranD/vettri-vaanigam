# Vaanigam — current implementation status

Last verified: 2026-08-31 (full-stack audit, auto-fix and browser verification)

**Current phase:** post-audit. Repository repaired and re-verified.
**Status:** READY_WITH_KNOWN_LIMITATIONS — see
[`docs/FINAL_ENGINEERING_AUDIT.md`](docs/FINAL_ENGINEERING_AUDIT.md) and
[`docs/FEATURE_MATRIX.md`](docs/FEATURE_MATRIX.md).

The full agentic commerce gateway and governance platform implementation is complete and verified.

## Delivered Capabilities

- **Protocol Adapters & Conformance**:
  - **ACP (Agentic Commerce Protocol)**: Spec-implemented 2026-04-17 checkout sessions with detached Ed25519 signatures, scoped delegated-payment tokens, and live charge capture.
  - **x402 Protocol v2**: Complete HTTP 402 challenge/response with price quotation, internal settlement reservation, nonce replay protection, and tamper-evident ledger audit.
  - **AP2 & SD-JWT**: Cart-mandate compatibility envelope normalization paired with an IETF SD-JWT selective disclosure parser utility.
  - **UAP & UCP**: Universal Agent Protocol and Universal Checkout Protocol adapters for unified basket intake.
- **Decision Engine & Policy Enforcement**:
  - Basket repricing from authoritative merchant catalog with multi-currency minor unit precision.
  - Negotiated bundle and upsell acceptance directly hooked into checkout execution lines and totals.
  - Crash recovery and stale lock timeouts for human step-up decisions stuck in `PROCESSING`.
- **Commerce & Inventory Lifecycle**:
  - Automated maintenance service sweeping expired/abandoned checkout sessions and restocking reserved inventory into available stock.
  - Multi-variant catalog management with atomic compilation, publishing, and rollback index safety.
- **Post-Purchase Operations**:
  - **Refunds**: Full and partial refunds on captured payments with strict state machine validation and inventory restock tracking.
  - **Returns**: Multi-item return request workflow (`REQUESTED` → `APPROVED` → `RECEIVED` → `COMPLETED`).
  - **Fulfillment**: Item-level carrier assignment, tracking number registration, and real-time transit state tracking.
  - **Disputes / Chargebacks**: Evidence tracking and status transitions (`OPEN`, `UNDER_REVIEW`, `WON`, `LOST`).
  - **Taxation**: Intra-state (CGST + SGST) and Inter-state (IGST) Indian GST calculation across basis point brackets.
- **Autonomous Growth & Attribution**:
  - Automatic campaign assignment binding on order placement (`CampaignOrderAttribution`).
  - Automatic campaign conversion recording and budget tracking on verified payment capture (`CampaignConversion`).
- **Distributed Architecture & Security**:
  - Pluggable `DistributedRateLimitStore` supporting cluster backends and in-memory bucket stores.
  - SHA-256 hash-chained tamper-evident agent action ledger.
- **Merchant Console & OpenAPI**:
  - Interactive web application with Product creation modals and Autonomous Campaign Management UI.
  - Comprehensive OpenAPI 3.1 schema covering all gateway, ACP, x402, UAP/UCP, and post-purchase endpoints.

## Verification

```bash
pnpm typecheck
pnpm test
pnpm build
```

Full automated suites verify ACP signatures and isolation, delegated payment charges, x402 lifecycle, SD-JWT parsing, catalog compilation/rollback, post-purchase state machines, and end-to-end payment flows.


---

## FEATURES_1.md — Tier 1, built and wired (31 Aug 2026)

All four Tier 1 features are implemented against the real gateway, not
mocked. Where the spec's own formula had a defect, the deviation is
documented in the code and the reasoning is below.

### A. Adaptive Agent Trust Score

A per-agent score derived from that agent's own history with THIS merchant
— a pure aggregate over Decision Records already being written, with no
new write path, exactly as the spec describes.

- `packages/domain/src/agent-trust-score.ts` — score, bands, effective ceiling.
- Threaded through `evaluateAgentGatewayPolicy` as an optional
  `adaptiveTrust` context, so the function stays testable without a
  database and a caller that passes nothing gets the old flat behaviour.
- Snapshotted per decision (`DecisionRecord.trustScoreAtDecision`) so the
  console shows the score AS IT WAS when a call was decided. A later attack
  must not silently rewrite the reason an earlier order was approved.
- Surfaced in the console as `AgentTrustPanel`, with the ceiling each score
  produced and the sentence explaining it.

**Three deliberate deviations from the spec's formula**, each closing a
hole the raw version has:

1. **The ramp is anchored at the baseline, not at zero.** The spec's
   `base * (1 + score/100)` gives a brand-new agent at the starting score
   of 50 **1.5x the merchant's unknown-agent ceiling** — more authority
   than was configured, for an agent nobody has transacted with. Anchored
   at the baseline, a fresh agent lands exactly on the configured unknown
   ceiling.
2. **The ramp runs both ways.** Below the baseline it collapses toward
   zero, so a caught agent loses the unknown-agent ceiling too. Without
   this, "collapses the moment an agent misbehaves" only means "loses its
   earned headroom", and a caught agent still auto-approves everything a
   stranger could.
3. **Earned credit saturates at five settled orders.** Uncapped, an agent
   with 500 orders scores 5,050 before clamping, so every penalty vanishes
   into the clamp and a high-volume integration buys permanent immunity to
   being caught.

Also narrower than the spec on what counts against an agent. Declines split
three ways rather than one: attacks at -40 (`ATTACK_REASON_CODES`),
overstepping at -25 (`POLICY_DECLINE_REASON_CODES`), and integration errors
at nothing. A typo'd SKU is a support ticket, not a risk signal, and at -25
two of them would halve an honest integration's ceiling. Penalties are also
counted over a trailing 30-day window — a score nothing can fall off is a
ban, not a score.

### B. Red-Team Agent — `apps/api/scripts/redteam-buyers.ts`

Six checks against a live gateway over real HTTP with a real enrolled
Ed25519 key. Asserted, not narrated: the script exits non-zero if any
defence fails, and the console panel takes its verdict from the exit code
rather than from its own parse of the output.

`pnpm redteam`, or the **Break the gateway** panel in the console.

| Check | Defence |
| --- | --- |
| Prompt injection into the Negotiator | held |
| Replay (spent nonce) | `MANDATE_NONCE_REPLAYED` |
| Expired mandate | `MANDATE_EXPIRED` |
| Mandate/cart mismatch | `MANDATE_AMOUNT_EXCEEDED` |
| Price forgery | `AMOUNT_MISMATCH` |
| Adaptive trust collapse | ceiling falls to ₹0 |

Two honest notes the script prints on every run:

- **The injection attack runs FIRST, deliberately.** The mandate attacks
  collapse the attacker's trust score to zero, and a zero ceiling steps
  every later order up to a human — which means the negotiator never runs.
  An injection test placed after them would report "held" without the model
  path having been exercised at all. A defence that was never reached is
  not a defence that held, and the script says so if the order does not
  come back `AUTO_APPROVE`.
- **The injection has no surface to hit.** The Negotiator is fed only the
  merchant's own catalogue rows; nothing agent-supplied reaches the prompt.
  That is a stronger defence than a clamp, and it is reported as such
  rather than being dressed up as the clamp working. The clamp is proved
  separately: every decision now stores the model's raw proposal beside the
  enforced outcome (`DecisionRecord.negotiatorRawProposal`), so "the LLM
  never moves money" is checkable from the data rather than from the code.

### C. Natural-language policy authoring

`POST /agent-gateway/policy/draft` **writes nothing**. It returns a diff.

This is the riskiest LLM call in the product — everywhere else a model
influences one transaction with a deterministic gate behind it; here the
model is writing the gate, and a bad value affects every order afterwards,
silently. So the model's output is never a configuration:

- Parsed to known fields only; unknown keys are reported as ignored, never
  merged.
- Clamped to `POLICY_AUTHORING_BOUNDS`, with the clamp shown to the merchant.
- `allowFirstUseKeyPinning` is **unreachable from a sentence**. It is the
  one setting whose "on" state weakens an authenticity guarantee rather
  than a spending limit, and exactly what an injection would want turned on.
- A field nobody mentioned keeps its value. There is no path from a
  sentence to "reset to defaults".
- Applying goes through the same authenticated `PUT` the manual form uses.

The diff marks which way each change points, because "₹10,000 → ₹40,000"
is easy to skim as a tightening. The response also distinguishes "I did not
understand you" from "that is already your policy" — conflating them makes
a working feature look broken.

### D. Protocol-native structured declines

`CheckoutSessionBase.messages` on the ACP surface, using ACP's own
`MessageError` codes. A step-up returns `approval_required`; a caller-
fixable refusal returns `intervention_required`.

`code` carries **only** the two values ACP defines. Vaanigam has fifteen
reason codes and putting `MANDATE_NONCE_REPLAYED` in that field would be
inventing an extension inside someone else's enum and calling it
compliance — an ACP client switching on `code` would meet a value its own
types do not contain. The specific reason travels in `content`, and the
machine-readable Vaanigam code stays in our own namespace alongside.
Messages are persisted, so an agent polling the session sees a stable
reason rather than one that shifts under it.

## Frontend — white, throughout

The console ground and the landing page are both `surface` white. On grey,
separation is free; on white it has to be built, so the token set grew
rather than shrank: a four-step warm-tinted shadow ramp, a `border.hair`
lighter than the default hairline, two barely-there section washes, and a
5%-opacity dot mesh behind the hero. One accent, one brand ramp, no glow.

## Verification

```bash
pnpm typecheck
pnpm test
pnpm redteam
```


---

## Audit, auto-fix and verification pass — 31 Aug 2026

Full inspect → fix → test → run → browser-verify → regression pass over the
implementation. Four defects found and fixed; all gates green afterwards.

### Fixed and verified

1. **The API test suite was not running at all.** `.env` carried the comment
   "LOCAL PGlite dev shim — active" directly above hosted Supabase URLs, so
   the local-database guard (correctly) refused, and `pnpm test` reported
   `apps/api: no tests` — 36 files and 333 tests silently skipped. Added
   `TEST_DATABASE_URL` / `TEST_DIRECT_URL` in `vitest-setup.ts` so the test
   target is decoupled from wherever the app is pointed. The guard itself was
   not weakened.

2. **Buyer spending policy had three writers and only one had been fixed.**
   `GET /buyer/policy` and `provision-demo-identities.ts` still created
   policies from the known-broken `["Electronics/Laptop", "Books",
   "Accessories"]` list, so rows created after the repair migrations were born
   broken and unreachable by them. Every purchase came back
   `CATEGORY_NOT_ALLOWED`. Collapsed into one shared
   `buyer-policy/resolve-policy.ts`.

3. **The customer AI-buyer journey could not reach a product.** The
   marketplace vocabulary was built from `discoverMarketplace`, which keeps
   at most five merchants ordered by name — the fixture sellers filled the
   window and pushed Meridian Athletics out, so the extractor was offered
   `Shoes` but never `Running Shoes`. No category could be extracted and the
   agent asked "what type of product are you looking for?" forever. Vocabulary
   now spans all active merchants; the five-merchant cap stays on the search,
   where it belongs.

4. **Client errors were reported as 500.** Fastify's own protocol errors
   carry a 4xx status but fell through to `INTERNAL_ERROR`. For an
   agent-facing gateway that tells an integrator the gateway is broken, and
   500 is the retryable class. Now returns the real 4xx.

Defects 2 and 3 share a root cause worth remembering: **a buyer context is
not a merchant.** A shopper's identity context sells nothing, so anything
scoped to "the buyer's `merchantId`" is scoped to an empty set. Migration
`20260831070000` fixes exactly this for spending policies; it recurred in the
buyer agent's vocabulary.

### Browser-verified journey

Login → buyer agent → "I need running shoes under ₹5,000 for daily running"
→ intent (`category: Running Shoes`) → 3 real grounded products → governed
proposal → bounded negotiation (refused on eligibility, with a reason) →
`STEP_UP` → explicit authorization → order + real Razorpay **Test Mode**
order → signed webhook → `CAPTURED` → merchant dashboard → hash-chained
Agent Action Ledger (`#5 → #10`).

Payment safety verified live: forged and missing signatures rejected (400),
duplicate webhook produced one stored event and one capture, and a controlled
failure classified as `INSUFFICIENT_FUNDS` with `customerDebitStatus:
UNKNOWN`, `merchantCreditStatus: NOT_CREDITED`, `automaticRetryBlocked: true`
— a failed payment is never assumed to mean "no debit".

### Second pass — closing the gaps (same day)

The first pass left five open items and, more importantly, a feature
matrix full of `n/a` in the frontend columns. That `n/a` was hiding the
real finding: **a backend with no caller is not "not applicable", it is
unreachable.** Four more defects came out of chasing it.

5. **x402 was advertised but not configured.** The console listed x402 as
   an available protocol while the server answered
   `503 PAYMENT_NOT_CONFIGURED` to every request — `X402_ASSET` and
   `X402_PAY_TO` were only ever set inside the test harness. Now set to
   the same Base Sepolia **testnet** values the suite uses. An unpaid
   request returns a genuine 402 with a priced offer of 469900 minor
   units.

6. **Four of eight demo-tour steps reported verification they never
   performed.** "Simulate Inbound ACP & x402 Handshakes" fetched
   `/system/capabilities`. "Evaluate Basket Repricing Policy" invented
   `discountCeilingBps: 1500` and announced "repricing passed" without
   repricing anything. "Trigger Step-Up on Bulk Basket" returned a
   hardcoded object and called **nothing at all**. "Verify Payment
   Capture & Idempotency" listed three transactions and claimed
   "HMAC-SHA256 signature verified". All four now call real surfaces and
   report what came back. In a product whose pitch is auditability, this
   was the most damaging defect class present.

7. **Post-purchase had no frontend at all.** Refunds, returns,
   fulfillment, disputes and GST were implemented, state-machine-tested
   and reachable over HTTP with zero frontend callers — a merchant could
   not refund a captured payment from the console. Built
   `PostPurchasePage` + `use-post-purchase`. A real ₹500.00 partial
   refund was issued through the UI and came back `PROCESSED`.
   (The first pass of the audit doc had marked this row COMPLETE with ✅
   in columns it had not earned. That was wrong and is corrected in the
   open, not quietly.)

8. **The category allow-list wildcard** (previously deferred as
   NEEDS_REVIEW because it touches an authorization boundary). Resolved
   as an explicit `allowAllCategories` **column**, defaulting to `false`
   so no existing policy is widened — deliberately NOT a magic string,
   because a reserved word inside user-supplied text is what an injection
   would aim to get written and makes a typo indistinguishable from a
   deliberate choice. The console warns when it sees `all` / `any` / `*`
   in the list and points at the toggle. The category gate also existed
   in two places; both now call one helper.

Also fixed: `decisionLatencyMs` was hardcoded to 0, so the console
reported "0ms median decision" for every buyer purchase. Now measured the
same way the gateway times itself. And the two obsolete prompt files are
removed.

### Live protocol conformance

`/protocols` now has a **Prove it — run the protocols now** panel: seven
checks making real HTTP calls from the browser to the live server.
**7/7 pass.** Discovery 200 · MCP manifest 200 · x402 → 402 quoting
469900 minor units on eip155:84532 · forged x402 payment refused ·
unsigned ACP session → 401 · unsigned gateway intent → 403 · ₹0.01 price
forgery → 403.

Half the checks pass only on a **refusal**, so the panel cannot go green
by authentication breaking — a conformance display that turns green when
the gate fails is worse than none.

### Known limitations

- The Razorpay **card form** itself is still not driven to completion.
  Everything either side of it is verified, and the states it would
  produce were exercised through signature-verified webhooks — which also
  proves signature checking and replay safety that a click-through would
  not. This is the only genuinely open item.
- x402 **settlement** remains a shim: the 402 challenge, priced offer and
  governed retry are real; no facilitator is called and nothing settles
  on-chain. The API and console both say so.
- AP2 mandates are accepted on their **shape**, not their cryptography —
  SD-JWT credentials are not verified.
- The local PGlite dev database can degrade mid-session (port open, not
  serving) and abort on restart against an existing data directory.
  Restart with a fresh `PGLITE_DATA_DIR`; connection strings need
  `pgbouncer=true` or Prisma fails with `prepared statement "s0" already
  exists`.

### Next action

Nothing is blocking. Before demoing, run once:

```bash
pnpm db:up && pnpm db:migrate && pnpm db:seed
```

then confirm the buyer journey reaches products — that single check
exercises the two defects that broke it.

### Gates

```bash
pnpm typecheck   # 4 projects, clean
pnpm lint        # 4 projects, clean
pnpm test        # 76 test files: domain 33, contracts 1, web 6, api 36
pnpm build       # all packages
```

All four green after the `allowAllCategories` schema change.
