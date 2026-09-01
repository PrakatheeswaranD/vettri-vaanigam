# Final Engineering Audit

**Date:** 31 August 2026
**Scope:** the implementation — frontend, backend, database, API layer,
AI/agent modules, payment integration, webhooks, policy engine,
authorization, audit ledger, tests, configuration, and the seams between
them.
**Method:** inspect → reproduce → diagnose → fix → typecheck → lint →
test → run → browser-verify → regression.

---

## 1. Executive summary

The implementation was in far better shape than a defect count alone
suggests. The payment core in particular is genuinely well built:
constant-time signature comparison, HMAC over exact raw bytes, an
encapsulated content-type parser so raw-body capture cannot leak to other
routes, integer minor units throughout, and customer debit modelled
separately from merchant credit. None of that needed repair.

What the audit found instead were **eight defects across two passes**,
falling into two families.

The first family is *a fix applied to one of several duplicate paths*.
The most serious made the primary Track 01 customer journey unreachable —
the AI Buyer could not name a category, so it asked the shopper what they
were looking for, forever, no matter how plainly they answered. Two of
these shared one signature worth naming: **a buyer context is not a
merchant.** A shopper signs in as their own identity context, which sells
nothing, so anything scoped "to the buyer's `merchantId`" is scoped to an
empty set. The repository had been bitten by this once already (migration
`20260831070000` fixes exactly it for spending policies) and it recurred
in the buyer agent's vocabulary.

The second family is worse, and only surfaced on the second pass: **the
product claiming more than it did.** x402 was advertised as an available
protocol while the server answered `503 PAYMENT_NOT_CONFIGURED` to every
request. Four of the eight guided-demo steps fabricated their results
client-side — one returned a hardcoded `STEP_UP` object without calling
anything at all, another announced "HMAC-SHA256 signature verified" after
doing nothing but list three transactions. And five post-purchase APIs
(refunds, returns, fulfillment, disputes, GST) were fully implemented,
state-machine-tested, and had **zero** frontend callers, so a merchant
could not refund a captured payment from the console. In a product whose
entire pitch is auditability, a demo that asserts unperformed
verification is the most damaging defect class available.

All eight are fixed and verified. The full stack was driven through the
mandated journey in a real browser, ending in a hash-chained audit trail;
through a controlled payment failure; through seven live protocol
conformance checks; and through a real ₹500.00 partial refund.

---

## 2. Frontend health — GOOD

Every entry in `NAV_BY_ROLE` resolves to a real route in `App.tsx`; no
dead links, no orphaned pages. The four deleted `Admin*Page.tsx` files
leave no dangling imports. Loading, empty, and error states resolve
correctly in the journeys driven.

The UI is unusually honest about financial state, and this is a strength
rather than a cosmetic one: the payment panel says "Payment not confirmed
as captured", shows customer debit and merchant credit as separate
`UNKNOWN` values, and warns "Do not submit another purchase while this
attempt is unconfirmed. Payment completion requires provider evidence;
refreshing only reads status." That is the correct posture.

One thing initially recorded as a defect — "Enter does not submit the
buyer agent input" — was **withdrawn on investigation**. The markup is a
standard `<form onSubmit>` with a controlled `<input>` and a
`type="submit"` button. The failures were an artifact of synthetic
keystrokes not reaching React state in the automation harness; when the
value is actually present, the form submits. No change was made.

## 3. Backend health — GOOD, with one duplication class fixed

Routes, services, and repositories are cleanly separated by module. The
global authentication gate is registered before every route module, so no
handler can run without either being on an explicit unauthenticated
allowlist or carrying a resolved `merchantId`. Role isolation is enforced
server-side and returns 403 for customer→merchant and non-admin→admin
crossings.

The defect class found here was **duplicated business logic that let an
already-fixed bug keep shipping** (Defect 2 below). The remedy was to
collapse three creation paths for one record into one shared module.

The platform-admin API surface (`/admin/*`) has no frontend consumer
since the Admin pages were removed. It is **preserved deliberately**: it
is a coherent API surface, it is exercised by `experience-access.test.ts`,
and §16 forbids deleting code merely because it looks unused.

## 4. Database health — GOOD

37 migrations apply cleanly to an empty database. Schema, relationships,
and constraints are sound. Money is stored as integer minor units
everywhere; the only division by 100 in the codebase is display
formatting, and basis-point arithmetic rounds once at the boundary
(`Math.round((amountMinor * bps) / 10_000)`).

Real user actions persist correctly — verified by re-reading rows after
UI actions, not by trusting the response.

Two data-repair migrations (`20260831060000`, `20260831070000`) exist for
buyer allow-lists. They are correct, but they could only repair rows that
existed when they ran; the code still writing bad rows is Defect 2.

## 5. API integration health — GOOD after one fix

Frontend↔backend contracts line up: no calls to nonexistent endpoints, no
method or payload mismatches found in the journeys traced. `apiPost`
correctly omits `content-type` when there is no body.

Defect 4 (4xx reported as 500) was found here and fixed.

## 6. AI / agent health — GOOD

Exactly two agents (Buyer, Merchant). Policy and risk are deterministic
application logic. The required boundary holds:

```
LLM → structured proposal → schema validation → deterministic policy
    → authorization → execution → verification → audit ledger
```

The LLM never moves money. This was verified behaviourally, not just by
reading code: the model proposed a purchase, and the deterministic policy
independently returned `STEP_UP` requiring explicit human authorization;
separately, the negotiator refused a discount on merchant eligibility
rules with an honest explanation ("This is your first order with this
merchant… 1 more settled order reaches returning at 2%") rather than
inventing a price.

Model output is schema-validated before normalization, and
`normalizeCategory` maps model output onto the merchant's real vocabulary
rather than trusting a free string.

Defect 3 (the vocabulary bug) lived here.

## 7. Payment health — STRONG

Verified in the running system, not by inspection alone:

- **Test Mode only.** `rzp_test_*` keys; real Test Mode orders created via
  the live Razorpay API (`order_TWQpPUhbM2vytY`, `order_TWR7w4mibKxOVj`).
- **Signature verification.** Forged signature → 400. Missing signature →
  400. Valid signature → 200.
- **Raw-byte HMAC.** Computed over exact bytes via a scoped content-type
  parser, never a parse-then-restringify.
- **Constant-time comparison.** `timingSafeEqual`, with a length guard.
- **Idempotency.** The same signed `payment.captured` delivered twice
  produced exactly one stored `PaymentProviderEvent` and one capture.
- **Integer minor units.** ₹4,699.00 stored and transmitted as `469900`.
- **Debit ≠ credit.** On success: `DEBITED` / `CREDITED`. On failure:
  `customerDebitStatus: UNKNOWN`, `merchantCreditStatus: NOT_CREDITED` —
  the system does **not** assume a failed payment means no debit.
- **Retry safety.** `automaticRetryBlocked: true` on the ambiguous
  failure; ambiguous execution consumes the proposal so a charge is never
  re-submitted.
- **Deterministic classification.** `BAD_REQUEST_ERROR` →
  `INSUFFICIENT_FUNDS`.

No payment logic was simplified or rewritten. Nothing in this section
required a fix.

## 8. Browser verification

Driven through the real UI at `localhost:5173` against the real API.

Mandated journey (§11), all steps confirmed:

| Step | Evidence |
|---|---|
| Open application | Landing page renders |
| Enter Buyer experience | Role chooser → AI Buyer |
| Login (demo flow) | `customer@vaanigam.demo`, session established |
| Natural-language request | "I need running shoes under ₹5,000 for daily running." |
| Intent extraction | `category: Running Shoes`, budget ≤ ₹5,000, in-stock |
| Catalog search → real products | "Found 3 that fit" |
| Recommendation | Aero Lightweight ₹4,699 / Cloudstep ₹4,299 / Pulse Runner ₹4,500, each with grounding and agent-readiness badges |
| Product selection | Governed purchase proposal modal |
| Offer | Bounded negotiation; refused on eligibility with a reason |
| Policy | `STEP_UP` — above autonomous limit |
| Approval | Explicit "Authorize this purchase" |
| Checkout | Order `PAYMENT_PENDING`, payment `CREATED` |
| Razorpay Test Mode | Real Test order; SDK loads, Test Mode checkout initializes |
| Payment state | `CAPTURED` after signed webhook |
| Webhook | Received, signature verified, applied |
| Database | Re-read: order `PAID`, payment `CAPTURED` |
| Merchant dashboard | Row visible: Captured, DEBITED/CREDITED, AGENT_GATEWAY, RAZORPAY |
| Agent Action Ledger | Chained `#5 → #10` under one workflow |

Ledger chain observed:
`PAYMENT_INITIATION_REQUESTED → PAYMENT_RECORD_CREATED →
PROVIDER_ORDER_CREATED → WEBHOOK_RECEIVED →
WEBHOOK_SIGNATURE_VERIFIED → PAYMENT_CAPTURED`.

**One step honestly incomplete.** The Razorpay card form was not driven to
completion. Entering card numbers into a payment form is outside what this
audit performs automatically, and the sandboxed verification browser does
not complete Razorpay's iframe handshake. The states a completed card
payment would produce were instead driven through the mechanism Razorpay
itself uses to report them — signature-verified webhooks — which
additionally proves signature checking and replay safety that clicking a
card form would not. This is recorded as PARTIAL in the feature matrix
rather than claimed as done.

## 9. E2E verification

Failure path (§13), driven live:

```
proposal → STEP_UP → authorize → order + Razorpay Test order
        → signed payment.failed webhook → 200
        → state FAILED
        → customerDebitStatus UNKNOWN, merchantCreditStatus NOT_CREDITED
        → failureCategory INSUFFICIENT_FUNDS
        → automaticRetryBlocked true
```

Recovery (failure → eligibility → Merchant Agent proposal → policy →
authorization → bounded retry → `CAPTURED`) is covered end-to-end by
`recovery.test.ts`, which passes against a real database.

---

## 10. Files removed

Two obsolete prompt/specification files, both fully de-referenced first:

- `PART_00_MASTER_ENGINEERING_CONTRACT.md`
- `PROJECT_IMPLEMENTATION_PLAN.md`

No code, build script, test or runtime configuration referenced either.
All five documentation links were rewritten to point at living docs
(`README.md` x4, `docs/ARCHITECTURE.md`, `docs/SECURITY.md`,
`docs/EVALUATIONS.md`) before deletion, so nothing dangles.

Nothing else was deleted. In particular the `/admin/*` API routes were
**kept** despite having no frontend consumer: they are coherent, tested by
`experience-access.test.ts`, and §16 forbids removing code merely because
it looks unused.

## 11. Files merged

- Three writers of the buyer spending-policy default collapsed into one
  new module, `apps/api/src/modules/buyer-policy/resolve-policy.ts`, now
  used by `buyer-policy/routes.ts`, `buyer-policy/purchase-routes.ts`, and
  `scripts/provision-demo-identities.ts`. `prisma/seed.ts` derives its
  list from the catalogue it just created.
- The buyer agent's marketplace vocabulary now comes from one place
  (`getMarketplaceCategories` / `getKnownAttributes(prisma, null)`)
  instead of being rebuilt inline from a truncated discovery result. This
  also removes a redundant full marketplace query per message.
- The buyer category gate existed twice — once for the proposal decision
  and once for the re-check at authorization. Both now call a single
  `categoryPermitted` helper. Two copies of a rule that decides whether an
  agent may spend money is how one of them ends up stale.

### Files added

- `apps/api/src/modules/buyer-policy/resolve-policy.ts` — the single place
  a buyer spending policy comes into existence.
- `apps/web/src/components/protocols/LiveConformance.tsx` — seven protocol
  checks that make real HTTP calls and report the status that came back.
- `apps/web/src/hooks/use-post-purchase.ts` and
  `apps/web/src/routes/PostPurchasePage.tsx` — the console for five APIs
  that had no caller.
- `apps/api/prisma/migrations/20260831080000_buyer_allow_all_categories/`
  — the explicit "allow every category" column.

## 12. Files preserved

- `guard-local-database.ts` — the refusal that caught the misconfiguration
  in the first place. Strengthened by routing around it, never weakened.
- All payment modules — untouched.
- `/admin/*` API routes — no frontend consumer, but tested and coherent.
- Both data-repair migrations — correct for the rows they could reach.

---

## 13. Fixed defects

### D1 — API test suite silently not running · **FIXED_AND_VERIFIED**

- **Severity:** High (confidence, not runtime)
- **Location:** `.env`, `apps/api/src/test-helpers/vitest-setup.ts`
- **Evidence:** `pnpm test` reported `apps/api test: Test Files no tests`.
  `.env` carried the comment *"LOCAL PGlite dev shim — active for fast,
  reliable local work"* directly above **hosted Supabase URLs**. The
  local-database guard correctly refused to run destructive tests against
  a hosted database — the guard worked exactly as designed.
- **Impact:** 36 test files and 333 tests — the entire API integration
  suite — had not been running. The recursive run's failure was easy to
  read as a pass.
- **Fix:** `TEST_DATABASE_URL` / `TEST_DIRECT_URL` in `vitest-setup.ts`
  decouple the test target from wherever the app is pointed; documented in
  `.env.example`; the false label in `.env` corrected.
- **Verification:** `pnpm test` from the repo root now runs all 36 API
  files. The guard is untouched and still refuses a non-local target.

### D2 — Buyer spending policy: three writers, one fixed · **FIXED_AND_VERIFIED**

- **Severity:** High
- **Location:** `buyer-policy/routes.ts:22`,
  `scripts/provision-demo-identities.ts:16`, `prisma/seed.ts:988`
- **Evidence:** `resolveBuyerPolicy` had been rewritten to seed from real
  categories, and two migrations repaired existing rows. But
  `GET /buyer/policy` still created policies with the known-broken
  `["Electronics/Laptop", "Books", "Accessories"]` — categories no
  merchant here stocks — and so did the demo-identity provisioner. Since
  the migrations had already run, every row created afterwards was born
  broken and unreachable by the repair.
- **Impact:** A shopper who opened Spending Policy before buying had a
  poisoned allow-list written for them; every subsequent purchase returned
  `DECLINE / CATEGORY_NOT_ALLOWED`. Observed live in the browser on the
  merchant's own headline product.
- **Fix:** one shared `resolve-policy.ts`; all creation paths seed from
  categories that actually exist to be bought across active merchants. An
  existing policy is still never widened.
- **Verification:** demo customer's allow-list now includes `Running
  Shoes`; the same purchase returns `STEP_UP` (human approval) instead of
  `DECLINE`.

### D3 — Customer AI-buyer journey unreachable · **FIXED_AND_VERIFIED**

- **Severity:** Critical — this is the primary Track 01 journey
- **Location:** `apps/api/src/modules/buyer-agent/service.ts`,
  `catalog-gateway.ts`
- **Evidence:** the marketplace vocabulary was built from
  `discoverMarketplace`, which deliberately keeps at most **five**
  merchants, ordered by name. The fixture sellers — `00 Buyer Agent Seller
  A`, `00 Buyer Agent Seller B`, `Apex Athletics`, `ByteStore`,
  `ElectroHub` — filled that window and pushed **Meridian Athletics**, the
  demo catalogue, out of it. Confirmed directly: the vocabulary offered
  `['Accessories', 'Electronics/Laptop', 'Shoes']` and never `Running
  Shoes`.
- **Impact:** no legal category value existed for the model to return, so
  no category survived normalization, `needsClarification` fired, and the
  agent replied *"What type of product are you looking for?"* however
  plainly the shopper answered. The customer journey could not reach a
  product at all. Reproduced twice in the browser and once over the API
  (`status: CLARIFICATION_REQUIRED`, `candidateCount: 0`).
- **Root cause:** the comparison window (how many merchants a shopper
  compares) was being used as the vocabulary (which category names are
  legal). Those are different questions.
- **Fix:** vocabulary now spans every active merchant. The five-merchant
  cap remains where it belongs — on the search, after a category is known.
- **Verification:** `status: RECOMMENDATIONS_READY`, `category: Running
  Shoes`, `candidateCount: 6`; browser shows "Found 3 that fit" with real
  products.

### D4 — Client errors reported as 500 · **FIXED_AND_VERIFIED**

- **Severity:** Medium
- **Location:** `apps/api/src/app.ts` error handler
- **Evidence:** Fastify's own protocol errors (empty body under
  `application/json`, oversized payload, unsupported media type) carry a
  4xx `statusCode`, but fell through to the `INTERNAL_ERROR` 500 branch.
- **Impact:** this is an agent commerce gateway, so external agents are
  primary consumers. Reporting a malformed request as a server error tells
  an integrator "the gateway is broken", and 500 is precisely the class a
  well-behaved client retries. Not reachable from the app's own UI, which
  omits `content-type` when there is no body.
- **Fix:** honour a 4xx `statusCode` before the 500 fallback, reusing the
  documented `VALIDATION_ERROR` code so no consumer meets a code outside
  the published vocabulary.
- **Verification:** the reproducing request now returns **400** (was 500).

---

## 14. Defect disposition — every item, current state

R1-R5 were open at the end of the first pass. R6-R8 were found during the
second. All are resolved except R3, which cannot be automated, and R5,
which is a dev-environment characteristic rather than a product defect.

### R1 — Category allow-list had no wildcard · **FIXED_AND_VERIFIED**

- **Was:** a shopper typing `all` got one category literally named "all"
  and every purchase declined `CATEGORY_NOT_ALLOWED`.
- **Why it was held back initially:** a wildcard weakens an authorization
  boundary, and §15 puts that out of bounds for an automatic change.
- **Fix taken:** an explicit `allowAllCategories` **column** (migration
  `20260831080000`), defaulting to `false` so no existing policy is
  widened by the column appearing, surfaced as a checkbox. The magic
  string was deliberately NOT implemented — a reserved word inside
  user-supplied text is exactly what an injection would aim to get
  written, and it makes a typo indistinguishable from a deliberate
  choice to an auditor. The console additionally *warns* when it sees
  `all`, `any`, `*`, `everything` in the list, explaining that it is
  matched literally, and points at the toggle.
- **Also fixed here:** the category gate existed in two places (the
  proposal decision and the re-check at authorization). Two copies of an
  authorization rule is how one goes stale, so both now call one
  `categoryPermitted` helper.
- **Verification:** typecheck, lint, 76 test files, and the policy page
  driven in the browser.

### R2 — `decisionLatencyMs` hardcoded to 0 · **FIXED_AND_VERIFIED**

- **Was:** the merchant console reported "0ms median decision" for every
  buyer purchase — a fabricated figure in a console whose value is honest
  reporting.
- **Fix:** measured with `performance.now()` from intake to the moment the
  outcome is known, matching how the agent gateway already times itself,
  and deliberately excluding the ledger write and checkout execution that
  follow so the number measures the gate rather than the work after it.

### R3 — Razorpay card-form completion not driven · **BLOCKED**

Unchanged, and the only item that stays open. Entering card numbers into
a payment form is outside what this audit performs automatically, and the
sandboxed verification browser does not complete Razorpay's iframe
handshake. Everything either side is verified, and the states a completed
card payment would produce were driven through signature-verified
webhooks, which also proves signature checking and idempotency.

### R4 — Obsolete prompt files · **FIXED_AND_VERIFIED**

`PART_00_MASTER_ENGINEERING_CONTRACT.md` and
`PROJECT_IMPLEMENTATION_PLAN.md` are removed. All five documentation
references had already been rewritten to point at living docs; no code,
build script, test or runtime configuration referenced them.

### R5 — Local PGlite dev database degrades under load · **NEEDS_REVIEW**

Unchanged and dev-only. The server can keep its port open while refusing
to serve (`P1001`), and can abort on restart against an existing data
directory. Recovered using the repo's own `PGLITE_DATA_DIR` mechanism.
Connection strings must carry `pgbouncer=true`; without it Prisma fails
with `prepared statement "s0" already exists`. This is a known upstream
characteristic of the dev shim, not a product defect, and the remedy is
already documented in `.env.example`.

### R6 — x402 advertised but not configured · **FIXED_AND_VERIFIED**

- **Found during the second pass.** The console listed x402 as an
  available protocol while the server answered
  `503 PAYMENT_NOT_CONFIGURED` for every request, because `X402_ASSET`
  and `X402_PAY_TO` were set only inside the test harness. The demo
  claimed a capability the running server did not have.
- **Fix:** the same Base Sepolia **testnet** values the integration suite
  uses, set in `.env` and documented in `.env.example`. No mainnet asset,
  no real funds.
- **Verification:** an unpaid request now returns a genuine
  `402 Payment Required` carrying a `payment-required` challenge header
  and a priced `accepts` offer of `469900` minor units.

### R7 — The demo tour reported verification it never performed · **FIXED_AND_VERIFIED**

- **Severity:** High for a jury demo — this is the worst class of defect
  in a product whose entire pitch is auditability.
- **Evidence:** four of eight tour steps fabricated their results
  client-side. "Simulate Inbound ACP & x402 Handshakes" fetched
  `/system/capabilities` and reported the protocols active without
  touching either. "Evaluate Basket Repricing Policy" invented
  `discountCeilingBps: 1500` and announced "repricing passed" without
  repricing anything. "Trigger Step-Up on Bulk Basket" returned a
  hardcoded `STEP_UP` object and called **nothing at all**. "Verify
  Payment Capture & Idempotency" listed three transactions and claimed
  "HMAC-SHA256 signature verified", which nothing in the call had checked.
- **Fix:** all four now call real surfaces — the live x402 and ACP
  endpoints, the real `PRICE_TAMPERING` sandbox attack, actual `STEP_UP`
  decision records, and real `WEBHOOK_SIGNATURE_VERIFIED` /
  `PAYMENT_CAPTURED` ledger entries — and report what came back, including
  when it is not what was hoped for.
- **Verification:** in the browser, the protocol step now reports
  *"x402 answered 402 quoting 469900 minor units; an unsigned ACP session
  was refused with 401."*

### R8 — Post-purchase had no frontend at all · **FIXED_AND_VERIFIED**

- **Severity:** High — and it was under-reported in the first pass of
  this document, which marked the row COMPLETE with ✅ in the Frontend API
  and Frontend UI columns. That was wrong: there was no client and no UI.
  The correction is recorded here rather than quietly amended.
- **Evidence:** `/refunds`, `/returns`, `/fulfillments`, `/disputes` and
  `/taxes/calculate` were implemented, state-machine-tested and reachable
  over HTTP with **zero** frontend callers. A merchant could not refund a
  captured payment, approve a return, attach a tracking number or record
  a chargeback from the console.
- **Fix:** `hooks/use-post-purchase.ts` and `routes/PostPurchasePage.tsx`,
  wired into the merchant navigation. Refunds are scoped to payments that
  are actually `CAPTURED`, default to zero, state the amount in words
  before submission, and refuse an over-refund client-side as well as
  server-side. Status transitions offer only the next legal state, so the
  console never presents a button the API will reject.
- **Verification:** a real partial refund of **₹500.00** issued through
  the UI against a captured payment, returning `PROCESSED` and appearing
  in the refund list. GST verified in the same page: ₹1,000 at 18%
  intra-state → CGST ₹90.00 + SGST ₹90.00 = ₹180.00.

## 15. Blocked items

R3 (the Razorpay card form) alone. It does not block the demo: every
state it would produce is verified through the signature-verified webhook
path, which is stronger evidence than a click-through would be.

---

## 16. Test results

All gates green, run after the final change:

| Gate | Result |
|---|---|
| `pnpm typecheck` | ✅ 4 projects, 0 errors |
| `pnpm lint` | ✅ 4 projects, 0 errors |
| `pnpm test` | ✅ **76 test files** — domain 33, contracts 1, web 6, api 36 |
| `pnpm build` | ✅ all packages, including the new `PostPurchasePage` chunk |

Re-run in full after the second pass, including the
`allowAllCategories` schema change: all four gates green.

`packages/domain` alone contributes 382 tests. The headline change is that
`apps/api`'s 36 files now actually execute from the root command.

## 17. Feature status

See [`FEATURE_MATRIX.md`](FEATURE_MATRIX.md). **41 features COMPLETE**,
1 PARTIAL (Razorpay card-form handoff), 3 EXPERIMENTAL (x402 on-chain
settlement, AP2/SD-JWT, UAP/UCP — each labelled a compatibility shim by
the repository itself, and the audit did not find that overstated).
Nothing BROKEN.

The table no longer contains a single `n/a`. It previously carried them
across every protocol and post-purchase row, which was hiding the real
finding: a backend with no caller is not "not applicable", it is
unreachable. That table also marked post-purchase COMPLETE with ✅ in
columns it had not earned; the correction is recorded in R8 rather than
quietly amended.

## 18. Before / after metrics

| | Before | After |
|---|---|---|
| Source files | 418 | 422 |
| Approximate LOC | 53,622 | ~54,900 |
| Test files actually running | 40 | 76 |
| Backend surfaces with no frontend caller | 9 | 0 (excluding the deliberately backend-only `/admin/*`) |
| Demo steps reporting fabricated results | 4 | 0 |
| Major issues | 8 (1 critical, 4 high, 2 medium, 1 low) | 0 unfixed; 1 blocked (R3), 1 dev-only (R5) |

LOC grew by roughly 1,300 across two passes. That is the intended
direction: one shared module replacing three divergent copies, a live
conformance runner, a post-purchase console for five APIs that had no
caller, and the reasoning that explains why each fix is shaped the way it
is. A larger working implementation beats a smaller broken one — and four
of the removed lines were a demo asserting things it had not checked,
which is worth more than the count suggests.

---

## 19. Final release decision

# READY_WITH_KNOWN_LIMITATIONS

The primary Track 01 journey — buyer → agent → discovery → recommendation
→ policy → approval → checkout → Razorpay Test Mode → webhook → payment
state → database → merchant dashboard → Agent Action Ledger — works end
to end and was verified in the running application, not inferred from
source.

Critical payment and security behaviour is verified: signature
verification rejects forged and missing signatures, duplicate webhooks
produce no duplicate effects, money is integer minor units throughout,
customer debit and merchant credit are distinct states, a failed payment
does **not** assume "no debit", automatic retry is blocked on ambiguity,
and the LLM never moves money.

It is **not** `READY_FOR_DEMO` in the unqualified sense, for one honest
reason: the Razorpay **card form itself** was not driven to completion
(R3). Everything either side of it is verified, and the payment states it
would produce were exercised through signature-verified webhooks — but
the click-through was not performed, so it is not claimed.

The other limitations (R1, R2, R4, R5) are documented, none blocks the
demo, and R1 is deliberately left for a human decision because it touches
an authorization boundary.

**Before demoing, run once:**

```bash
pnpm db:up && pnpm db:migrate && pnpm db:seed
```

Then confirm the buyer journey reaches products — that single check
exercises D2 and D3, the two defects that broke it.
