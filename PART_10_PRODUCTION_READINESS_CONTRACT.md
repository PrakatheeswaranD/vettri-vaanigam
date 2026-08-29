# PART 10 — Production Hardening & Go-Live Readiness

> **STATUS: SUPERSEDED — kept for provenance, not as a plan.**
>
> This document said "not yet started" and quoted a test count that has
> been wrong for a long time, while `PROJECT_IMPLEMENTATION_PLAN.md` said
> no Part 10 exists at all. Both statements outlived the work.
>
> Most of what it proposed HAS since been built, under the Anumati
> repositioning rather than under this numbering: real merchant identity
> and RBAC, agent credentials, the deterministic gateway, the hash-chained
> ledger extension, Razorpay Test Mode integration and the deployment
> scaffolding. `PROGRESS.md` is the record of what actually happened; the
> README's Limitations section is the honest statement of what has not.
>
> Nothing below should be read as a commitment or as a description of the
> current system. It is retained only so the reasoning that produced the
> hardening work is not lost.

## How to use this prompt

Paste this file's contents (or point the agent at this file) as the task.
Before writing any code, the agent must read, in this order:
`PART_00_MASTER_ENGINEERING_CONTRACT.md`, `PROGRESS.md` (specifically its
*Known Issues* and *Deferred Intentionally* sections), `docs/SECURITY.md`,
`docs/ARCHITECTURE.md`, and the *Limitations* section of `README.md`. Every
item below traces back to something one of those documents already states
honestly — this prompt does not invent new gaps, it sequences the ones the
codebase already admits to.

## Non-negotiable principles (extends PART 00's spine)

- Every invariant PART 00–09 already established must remain true when this
  part is done: the LLM never moves money directly; the browser never
  defines the amount that reaches the payment layer; the frontend never
  determines whether a payment succeeded; recovery stays bounded and
  gated. Nothing in this part may weaken any existing guarantee to make a
  task easier.
- No new AI actors. Identity, rate limiting, and observability are
  deterministic infrastructure — exactly like the Policy Engine — never
  delegated to a model, ever.
- Every one of the existing 372 tests must remain green throughout. Every
  new capability ships with its own tests at the same rigor as the existing
  suite (unit + integration + at least one adversarial case), not a
  lighter standard because this is "just infra."
- Update `PROGRESS.md`, `docs/SECURITY.md`, and `README.md`'s Limitations
  section honestly as each item lands — remove a documented limitation only
  once it is genuinely resolved and verified, not merely coded.

## Scope: three tiers, in priority order

### Tier 0 — Blocking. Nothing below this line ships before a real transaction runs.

**1. Real merchant and approver identity.**
`apps/api/src/modules/authorization/demo-context.ts` currently resolves one
hardcoded demo merchant server-side, and the Approval Service's
`approverId` is a server-controlled constant by deliberate design (PART 00
§36's "identity simplification"). Replace this with real authentication
(session- or JWT-based), multi-tenant merchant scoping enforced on every
route, and role-based permission over who may approve or reject a
proposal.
*Acceptance:* two distinct merchant accounts cannot see or act on each
other's data under any endpoint; an unauthenticated request to any
mutating route is rejected; a recorded `Approval` row carries the real
authenticated user's identity, not a constant.

**2. Live-provider verification of the Razorpay adapter.**
`apps/api/src/modules/payments/razorpay-gateway.ts` is written directly
from Razorpay's documented API shape but has never been exercised against
the real API in this environment — only `MockPaymentGateway` has run.
Exercise it end-to-end against genuine Razorpay Test Mode: order creation,
Checkout widget, webhook delivery, signature verification, and capture.
*Acceptance:* one full golden-path payment and one full
failure→recovery→capture path completed live against real Test Mode
credentials, with evidence retained (logs, request/response captures) —
not "the mock-backed tests pass" standing in for this.

**3. A refund / chargeback flow.**
There is currently no refund path anywhere in the codebase — explicitly
out of scope for the buildathon, not optional for real money. Design and
implement it through the exact same proposal → validation → policy →
approval → authorization → execution pattern every other financial action
already uses. Do not shortcut this with a direct-mutation endpoint that
bypasses the governance pipeline.
*Acceptance:* a refund is deterministic, policy-gated, ledgered, and
idempotent under concurrent requests, with its own adversarial test suite
built to the same standard as `recovery.test.ts`.

**4. Provider-order-creation timeout reconciliation.**
Closes `PROGRESS.md` Known Issue #5: a timeout during order creation is
currently retried against the same `Payment` row without proof the
original call didn't already succeed at Razorpay — an accepted residual
risk for the demo, not for production. Implement Razorpay's
list-orders-by-receipt (or equivalent) reconciliation so this can be
resolved with certainty instead of accepted as risk.

**5. Real secrets management.**
`RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `AI_PROVIDER_API_KEY`,
and `DATABASE_URL` currently live in a plain `.env` file. Move them into a
real secrets manager appropriate to the deployment target, with a
documented rotation procedure — not a one-time value that's never
rotated.

### Tier 1 — Hardening. Fast-follow, before real transaction volume.

**6. A background expiry sweep**, replacing the lazy-only expiry pattern
(documented and deliberate at demo scale) for `Approval`,
`ExecutionAuthorization`, and `CheckoutSession` with a real scheduled job,
so a stale pending approval can no longer sit invisibly until someone
happens to act on it.

**7. Rate limiting and abuse protection** on every public endpoint,
especially the Buyer/Merchant Agent conversation endpoints and the payment
endpoints — nothing currently limits calls per merchant, per IP, or per
conversation.

**8. Observability beyond the ledger.** Pino logs plus the
`/action-ledger/.../verify` and `/trace` endpoints are the entire
observability surface today, by design, for the demo. Add metrics and
alerting (policy denial rate, approval SLA, recovery success rate, webhook
failure/retry rate) and real error tracking — the audit trail was never
meant to substitute for operational monitoring.

**9. A CI/CD pipeline.** Typecheck, lint, the full test suite, and both
eval suites (`eval:intent`, `eval:recommendation`) on every PR, plus
dependency/security scanning of the workspace; a deploy pipeline with a
documented rollback path.

**10. Real merchant onboarding and KYC/AML.** The system has exactly one
pre-seeded merchant today. Build genuine merchant verification before a
merchant can configure a live policy or accept real payments.

**11. Production-grade HTTP hardening.** A real CORS policy, security
headers, CSRF handling if item 1 introduces cookie-based sessions, and
structured audit logging of admin/configuration changes kept distinct
from the Agent Action Ledger (which is scoped to agent-driven financial
actions, not admin operations).

### Tier 2 — Scale and completeness. Defer until real usage data justifies it.

**12. Push remaining catalog filtering into SQL.** The Buyer Agent's
catalog gateway currently pushes only category filtering to the database;
price and attribute filtering happen in application code — explicitly
fine at this catalog's size, explicitly not at a much larger one.

**13. Replace curated `ProductRelationship` rows with a computed
similarity/co-purchase graph** in the Merchant Agent's Opportunity Engine,
once catalog size makes the curated approach impractical to maintain by
hand.

**14. Migrate off PGlite entirely** to a managed Postgres with real
connection pooling, removing the `pgbouncer=true` /
`connection_limit=5` workarounds that exist only to accommodate the local
single-process dev database.

**15. Recovery actions beyond `RETRY_SAME_CHECKOUT`** (e.g.
`ALTERNATIVE_PRODUCT`, a bounded second recovery attempt) — the recovery
and grounding machinery is already built generically enough to add these
without re-plumbing the AI call, per the existing README.

**16. A legal and compliance surface** — Terms of Service, a real refund
policy, a privacy policy, and a genuine data retention/deletion path for
buyer conversation data.

**17. Multi-region resilience** — backups, a documented disaster-recovery
plan, and a stated RTO/RPO.

## Explicitly out of scope for this part

- No new AI agent types (a "RiskAgent," "ComplianceAgent," etc.). Every
  item above is deterministic application infrastructure, matching PART
  05–08's own precedent — identity, rate limiting, and observability are
  never delegated to a model.
- No protocol certification claims (ACP/AP2/UCP/x402). That remains a
  distinct, separately-scoped initiative, not part of production hardening.
- No UI redesign. This part is backend and infrastructure hardening;
  visual/UX work is a separate, unrelated track of effort.

## Sequencing

Work Tier 0 first, in the order listed — identity (item 1) should land
before almost everything else, since refunds, rate limiting, and
observability all assume a real identity model underneath them. Tier 1 can
start in parallel once identity work lands. Tier 2 stays explicitly
deferred until real transaction volume justifies it — do not front-load it
ahead of Tier 0/1, for the same reason PART 00's master contract already
warns against building infrastructure without a real need.

## Deliverables per item

For every item completed: tests at the same rigor as the existing 372,
an update to `PROGRESS.md`'s *Known Issues* / *Deferred Intentionally*
sections reflecting the new true state, and an update to `README.md`'s
*Limitations* section — removing a claim only once it is genuinely
resolved and verified, never in advance of the work.

## Definition of done

All Tier 0 items complete and verified live, not merely test-suite-green;
Tier 1 items complete; Tier 2 items explicitly still deferred and
documented as such. Only then can the system honestly claim
"production-ready for real-money Razorpay transactions" — not before, and
not on the strength of the buildathon build alone.
