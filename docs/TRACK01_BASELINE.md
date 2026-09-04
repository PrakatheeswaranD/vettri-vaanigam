# TRACK01_BASELINE — Vettri Vaanigam, as it actually exists

**Part 0 of the Track 01 (AI Growth & Agentic Commerce) staged transformation.**
Established 2026-09-02 against branch `security/review-fixes`, working tree at commit `d3102fe` plus 27 modified and 13 untracked files.

This document records **what was in the repository at the start of Part 0**, verified by reading code and by running the build, typecheck and test suites — not by reading filenames or older specification documents.

> **Status: superseded.** The problems in §8, §9 and §12 were fixed in [TRACK01_PART0_FIXES.md](TRACK01_PART0_FIXES.md); the nineteen-destination console described in §5 was then restructured into five in [TRACK01_PART1_RESTRUCTURE.md](TRACK01_PART1_RESTRUCTURE.md). This baseline is left as written so the "before" is still legible — its route and page inventory no longer describes the app.

---

## 1. How this baseline was established

| Check | Command | Result |
|---|---|---|
| Typecheck | `pnpm typecheck` | **Clean** across all 4 packages |
| Domain tests | `pnpm --filter @razorgrowth/domain test` | **418 passed / 418** |
| Contracts tests | `pnpm --filter @razorgrowth/contracts test` | **6 passed / 6** |
| Web tests | `pnpm --filter @razorgrowth/web test` | **37 passed / 37** |
| API tests | `pnpm --filter @razorgrowth/api test` | **31 files passed, 5 files failed** (~35 individual failures) |

The API suite required a local database to say anything at all. It was brought up as follows, so the failures below are *real code failures*, not environment noise:

1. `prisma migrate deploy` against the local PGlite dev DB — 38 migrations applied.
2. `prisma/seed.ts` — Meridian Athletics, 200 products, 703 variants, 8 customers.
3. `scripts/provision-demo-identities.ts` — the CUSTOMER and PLATFORM_ADMIN identities, which `seed.ts` does **not** create.

Step 3 is undocumented in CI (`.github/workflows/ci.yml` runs migrate + seed only), which is its own finding — see §9, P4.

---

## 2. Repository shape and size

```
apps/api        Fastify + Prisma backend        180 .ts   (144 source, 36 test)    27,418 LOC
apps/web        React 18 + Vite console         146 files (139 source,  7 test)    19,347 LOC
packages/domain Pure domain logic, no I/O        86 .ts   ( 51 source, 35 test)    11,328 LOC
packages/contracts Zod DTO contracts             23 .ts   ( 22 source,  1 test)     1,965 LOC
packages/config Shared tsconfig                    2 json                               —
apps/api/prisma schema + 38 migrations + seed   1 .prisma (1,818 lines) + 1,197-line seed
scripts + apps/api/scripts  demo/eval/redteam   11 files                            1,955 LOC
```

**≈ 62,000 LOC of TypeScript.** Package manager pnpm 11.24.0, Node ≥ 20 (the machine runs Node 24, which is why `scripts/node-runtime-compat.mjs` exists).

Stack: Fastify 5, Prisma 6, Zod 3, React 18, TanStack Query 5, React Router 7, Tailwind-less hand-rolled UI, Pino logging, PGlite for local dev DB, Supabase Postgres for the deployed DB.

### Quality signals worth stating up front

This is not a scaffold. The code is unusually disciplined for a hackathon codebase:

- A **pure-domain / IO-service split** that is genuinely honoured — `packages/domain` has no Prisma import anywhere, and 418 tests pin its arithmetic.
- **One ledger writer.** `modules/audit/ledger.ts` is the only place `prisma.agentAction.create` is called, which is what makes the per-workflow hash chain meaningful.
- **One policy engine, one authorization issuer, one execution service** — recovery, growth actions and gateway purchases all funnel through the same `/policy/evaluate → approval → execution-authorization` pipeline rather than forking it.
- Payment gateway, AI provider and protocol adapters are all behind interfaces chosen once at startup, with tests structurally unable to reach a live provider.

The problems below are concentrated in **surface layers** (routes, pages, role gating, duplicated feature entry points), not in the core.

---

## 3. Database baseline

**46 Prisma models, 33 enums, 1,818 schema lines, 38 applied migrations.** Row-level security is enabled with deny-direct-access policies (`20260110000000_enable_rls_deny_direct_access`, plus later `protect_*` migrations for tables added afterwards).

Grouped by concern:

| Concern | Models |
|---|---|
| Tenancy & identity | `Merchant`, `MerchantUser`, `Session`, `Customer` |
| Catalog | `Product`, `ProductVariant`, `Inventory`, `ProductRelationship`, `CatalogCompilation` |
| Commerce | `Cart`, `CartItem`, `Order`, `OrderItem`, `CheckoutSession`, `IdempotencyRecord` |
| Payments | `Payment`, `PaymentProviderEvent`, `Refund` |
| Governance | `MerchantPolicy`, `PolicyEvaluation`, `Approval`, `ExecutionAuthorization`, `BuyerSpendingPolicy` |
| Audit | `AgentAction` (hash-chained ledger) |
| Agent gateway | `AgentIdentity`, `AgentGatewayPolicy`, `DecisionRecord` (166 lines — the widest model in the schema), `SpendMandateNonce` |
| Protocols | `AcpCheckoutSession`, `AcpDelegatedPayment` |
| Growth | `GrowthOpportunity`, `MerchantGrowthConfig`, `GrowthActionProposal`, `Campaign`, `CampaignAssignment`, `CampaignOrderAttribution`, `CampaignConversion` |
| Buyer agent | `BuyerConversation`, `BuyerMessage`, `RecommendationRecord` |
| Readiness | `ReadinessSnapshot` |
| Post-purchase | `ReturnRequest`, `ReturnItem`, `Fulfillment`, `FulfillmentItem`, `Dispute` |

**Structural observation.** There is no first-class customer identity. A shopper is a `MerchantUser` with `role = CUSTOMER` belonging to a synthetic merchant (`demo-customer-context`), and that merchant's id is then reused as `buyerContext` / `DecisionRecord.protocolActorRef`. Cross-merchant purchasing works because the *selling* merchant is stored separately on the decision record — but every customer route resolves its tenant through `getAuthenticatedMerchantId()`, a function whose own docstring describes it as a merchant scoping primitive. This is the single largest modelling debt in the repository.

---

## 4. Backend baseline — 128 endpoints across 25 modules

All routes are registered in `apps/api/src/app.ts` under `/api/v1`, behind one global `authenticateRequest` preHandler.

| Module | LOC | Files | Role |
|---|---|---|---|
| `gateway` | 2,822 | 8 | **The product's centre.** Inbound external agent traffic: protocol detect → adapter parse → SKU resolve → server-side repricing → agent identity → mandate verify → policy → decide → `DecisionRecord` |
| `payments` | 2,131 | 16 | Razorpay + mock gateway, state machine, webhooks with raw-body signature verification, reconciliation, recovery execution |
| `agents` | 1,660 | 9 | `AIProvider` boundary + Anthropic / Gemini / deterministic-demo / fixture providers + 3 prompt sets |
| `buyer-agent` | 1,600 | 12 | Intent extraction, candidate evaluation, grounded recommendation, conversation state |
| `commerce` | 1,293 | 13 | Cart/checkout/order repositories, execution service, order fingerprinting, pricing |
| `merchant-agent` | 1,221 | 7 | Growth proposals, opportunity engine over `ProductRelationship`, failure-first recovery proposal |
| `policy` | 1,084 | 9 | Deterministic policy engine orchestration, approvals, execution authorizations |
| `buyer-policy` | 862 | 4 | Customer spending policy, automated negotiation, purchase proposal lifecycle |
| `acp` | 821 | 4 | Agentic Commerce Protocol checkout sessions + delegated payment |
| `x402` | 742 | 2 | x402 402-challenge purchase flow |
| `growth` | 715 | 7 | Opportunity list, catalogue scan, summary, **and the new Revenue Opportunity Engine** |
| `catalog` / `catalog-compiler` | 1,201 | 7 | Product CRUD, quality analysis, JSON-LD + MCP manifest compilation with publish/rollback |
| `sandbox` | 601 | 4 | "Break the agent" adversarial presets |
| `post-purchase` | 539 | 1 | Refunds, returns, fulfilments, disputes — **all in one 539-line route file, no service layer** |
| `readiness` | 560 | 5 | Deterministic AI-readiness scoring engine |
| `campaigns` | 491 | 2 | Campaign lifecycle + auto-attribution from captured payments |
| `audit` | 486 | 5 | Hash-chained ledger writer, trace, verify |
| `auth` | 276 | 6 | Opaque server-side sessions (SHA-256 hashed tokens, not JWT), RBAC helpers |
| `merchant` | 197 | 4 | Profile, policy, stats, `commerce-overview` |
| `agent-commerce` | 197 | 3 | Agent-readable catalog DTO boundary |
| `marketplace` | 173 | 3 | Cross-merchant discovery + platform admin routes |
| `system` | 117 | 2 | Capabilities, connected systems, readiness |
| `privacy` | 107 | 2 | Redaction, retention |
| `authorization` | 30 | 1 | `getAuthenticatedMerchantId` |

**Protocols supported:** ACP, AP2, x402, UAP, UCP — detected from `x-agent-protocol` header or body shape, each with an adapter in `packages/domain/src/protocol-adapters.ts` (15,461 bytes, tested).

**Payment providers:** Razorpay Test Mode when credentials are present; a deterministic `MockPaymentGateway` otherwise. Production boot **refuses** to start on the mock. `NODE_ENV=test` always forces the mock.

**AI providers:** Anthropic, Gemini, deterministic demo (default), fixture. Chosen once at startup. Tests always get the deterministic provider. Currently `.env` selects Gemini with a live key.

---

## 5. Frontend baseline — 27 page modules, 31 routes, 109 components

`apps/web/src/App.tsx` defines two role experiences behind `RequireAuth` + `AppShell`, plus a public landing page and login.

**Customer (`/customer/*`)** — home, buyer-agent chat, discover, product detail, cart, orders, payments, activity, spending policy.
**Merchant (`/merchant/*`)** — overview, growth, ai-buyers (gateway), catalog, customers, orders, analytics, offers, approvals, activity, trust-trace, payments, post-purchase, policies, readiness, ledger.
**Legacy redirects** — 11 old top-level paths (`/growth`, `/catalog`, `/settings`, …) redirect to their role-scoped equivalents.

The landing page alone is 2,795 LOC across 16 marketing components (`components/landing/`) — roughly 14% of the frontend.

### Pages that exist but are not routed (orphans)

| File | LOC | Status |
|---|---|---|
| `routes/DemoTourPage.tsx` | 651 | Not imported anywhere. A scripted jury walkthrough that calls live endpoints. |
| `routes/ProductDetailPage.tsx` | 334 | Superseded by `CustomerProductPage`. |
| `routes/ProtocolsPage.tsx` | 243 | Protocol conformance viewer; `components/protocols/LiveConformance.tsx` is still imported by it only. |
| `routes/BreakTheAgentPage.tsx` | 132 | Adversarial sandbox UI. Backend (`/sandbox/*`, 601 LOC) is fully implemented and tested. |

**1,360 LOC of dead pages**, two of which (Break-the-Agent, Protocols) front backend capability that is otherwise invisible to a judge.

### Routed but unreachable from navigation

`/merchant/activity` and `/merchant/trust-trace` are real routes with real pages but appear in **no** nav section in `components/layout/nav-items.ts`. `TrustTracePage` is backed by a whole `features/trust-trace/` module (8 files, tested).

Every component under `components/`, `features/`, `hooks/` and `lib/` — 109 files — has at least one importer. There are no orphan components.

---

## 6. Agent capability baseline

### Merchant Agent (`modules/merchant-agent`, `modules/growth`)
- Propose bounded growth actions (cross-sell, upsell, bundle, bounded offer) over a **relationship-graph-derived candidate set**, never the open catalogue.
- Every proposal is validated against `MerchantGrowthConfig` ceilings (`maxUpsellIncreaseBps`, `maxProposedDiscountBps`, `maxCrossSellItems`, `maxBundleItems`) *after* the model returns, in `packages/domain/growth-proposal-validation.ts`.
- Catalogue opportunity scan on `catalog.published`, writing `GrowthOpportunity` rows marked `isSyntheticDemo: false` and a ledger event. **5 integration tests pass**, including idempotency and "never attaches a fabricated value".
- Failure-first payment recovery: evaluate eligibility deterministically → propose a bounded action → same approval pipeline → `payments/recovery-execution-service.ts` issues a new `CheckoutSession` against the *same* immutable Order.
- **New, uncommitted:** a Revenue Opportunity Engine (`packages/domain/revenue-opportunity.ts`, 50KB + `growth-scores.ts`, 15KB, both tested) detecting failed-payment recovery, stalled checkouts, repeat-purchase due, reactivation, cross-sell and underperforming products, with a strict three-way value classification (`OBSERVED` / `ESTIMATED` / `OPPORTUNITY`) that is deliberately never summed into one headline number.

### AI Buyer (`modules/buyer-agent`, `modules/buyer-policy`)
- Natural-language intent extraction → server-filtered candidate set → grounded ranking → `EXACT_MATCH` / `NEAR_MATCH` / `NO_EXACT_MATCH` / `NEEDS_CLARIFICATION` with reason codes.
- Conversation state merge/override/reset semantics.
- Purchase proposal → automated negotiation against a derived customer standing tier → authorize → payment.
- Spending policy: autonomous limit, daily limit, category allowlist, approval-above-limit.

### Inbound external agents (`modules/gateway`)
- Agent identity registry with first-use key pinning, revocation, and an adaptive trust score (`packages/domain/agent-trust-score.ts`, 12KB, tested).
- Spend-mandate verification (`spend-mandate.ts`, SD-JWT support).
- Server-side repricing of every basket before any check runs — the wire price is recorded only so a disagreement can be surfaced.
- `DecisionRecord` per intent with a plain-English explanation, `ALLOW` / `STEP_UP` / `BLOCK` outcome and reason code.
- Red-team and demo runners exposed as endpoints.

---

## 7. Flows that work end-to-end

Verified by passing integration tests against a real seeded database:

| Flow | Evidence |
|---|---|
| Login → session → RBAC (OWNER/APPROVER/VIEWER/CUSTOMER/PLATFORM_ADMIN) | `auth.test.ts` — 10 tests |
| Catalog compile → publish → rollback → serve JSON-LD + MCP manifest unauthenticated | `catalog-compiler.test.ts` — 12 tests |
| Agent-readable catalog boundary (DRAFT/ARCHIVED never leak) | `part02.test.ts` — 20 tests |
| x402 402-challenge → payment → lifecycle | `x402-handshake.test.ts` (10), `x402-lifecycle.test.ts` (1) |
| ACP surface | `acp-surface.test.ts` |
| Policy authoring + evaluation | `policy-authoring.test.ts` (11), `policy.test.ts` |
| Commerce execution from an authorization | `commerce.test.ts` |
| Payments: initiate → verify → webhook → reconcile → recovery | `payments.test.ts`, `recovery.test.ts` |
| Campaign attribution from captured payments only, once, under budget | `campaigns.test.ts` |
| Catalogue opportunity scan | `opportunity-scan.test.ts` — 5 tests |
| Break-the-agent sandbox + gateway attack presets | `sandbox.test.ts` (8), `sandbox-gateway-attacks.test.ts` (5) |
| Protocol conformance against fixtures | `protocol-conformance.test.ts` (4) |
| Rate limiting, security headers, privacy redaction, retention | 4 suites, all passing |

---

## 8. Flows that are broken

### 8.1 `POST /api/v1/buyer-agent/messages` is unreachable by every role — **critical**

An uncommitted 3-line change to `apps/api/src/modules/auth/middleware.ts` added a merchant-side mirror of the customer restriction:

```ts
} else {
  const customerOnly = path.startsWith("/api/v1/buyer/")
    || path.startsWith("/api/v1/buyer-agent/")
    || path.startsWith("/api/v1/marketplace/");
  if (customerOnly) throw AppError.forbidden("Merchant sessions cannot access customer purchasing APIs.");
}
```

The pre-existing CUSTOMER allowlist admits only `/api/v1/buyer-agent/conversations/`. So:

- CUSTOMER session → `/buyer-agent/messages` does not match the allowlist → **403**
- Any merchant-side role → matches `customerOnly` → **403**

The endpoint is registered, tested, and dead. The web app happens to route customers to the sibling `/buyer/marketplace/messages` instead, which is why this is not visible in the UI — see 8.3.

### 8.2 The same change broke 5 API test suites — ~35 tests

`test-helpers/test-app.ts` provides exactly one factory, `buildAuthedTestApp()`, which logs in as the **merchant owner**. Four suites use it to drive customer routes:

| Suite | Failing |
|---|---|
| `customer-negotiation.test.ts` | 20 / 20 |
| `buyer-agent.test.ts` | 12 |
| `agent-trust.test.ts` | 1 |
| `buyer-purchase-integration.test.ts` | 1 |
| `merchant-agent.test.ts` | 1 |

Every failure is the same 403. There is no `buildCustomerTestApp()`. **CI on this branch is red.**

### 8.3 `/buyer/marketplace/messages` and `/buyer-agent/messages` are the same handler

```ts
app.post(`${prefix}/buyer/marketplace/messages`, …handleBuyerMessage({ …, marketplace: true }));
app.post(`${prefix}/buyer-agent/messages`,      …handleBuyerMessage({ … }));
```

Two public endpoints, one implementation, distinguished by a boolean. The frontend picks between them with `getExperienceRole() === "customer"`. One of the two must go.

### 8.4 `GET /merchant/commerce-overview` reports inaccurate money — **high**

An 55-line inline route handler in `modules/merchant/routes.ts` with no service layer and no contract DTO. Three defects:

1. `averageOrderValueMinor` is computed over **all order statuses**, so cancelled and failed orders drag the average.
2. It is computed over `take: 100` — the AOV is the AOV of the most recent page, not of the business.
3. `orderCount: orders.length` reports **at most 100**, whatever the real count is.
4. `lifetimeValueMinor` per customer sums orders regardless of status, overstating every customer's value.

This powers `/merchant/analytics` and `/merchant/customers`. The new `revenue-evidence-service.ts` explicitly calls this out and computes from `PAID` orders only — the two now disagree by construction.

### 8.5 Platform admin has a backend and no frontend

Nine endpoints (`/admin/overview`, `/admin/merchants`, `/admin/users`, `/admin/payments`, `/admin/readiness`, `/admin/risk`, `/admin/audit`, plus merchant create/status/readiness mutations) are implemented and RBAC-gated to `PLATFORM_ADMIN`. `provision-demo-identities.ts` creates that identity and it can log in. **Zero references to `admin/` exist anywhere in `apps/web/src`.** Logging in as the platform admin lands on a merchant console it has no rights to call.

### 8.6 The gateway step-up decision loop has no UI

`POST /agent-gateway/decisions/:decisionId/decide` and `GET /agent-gateway/step-ups` implement the human-in-the-loop resolution of a `STEP_UP` outcome — with a stale-lock timeout, consent revalidation, and `requireApprovalRole`. Neither is called from the frontend. `AgentGatewayPage` only surfaces `stepUpPaymentLinkUrl`. For a track judged on agentic commerce governance, the "a human decides" moment is API-only.

---

## 9. Duplicated and overlapping implementations

| # | Duplication | Detail |
|---|---|---|
| D1 | **Two growth opportunity feeds** | `/merchant/growth` (`GrowthOpportunitiesPage`, new) renders the Revenue Opportunity Engine from `/growth/revenue-opportunities`. `/merchant/offers` (`GrowthPage`, labelled "Offers & Actions") renders the older `GrowthOpportunity` table from `/growth/opportunities` — with its own category labels, its own `GrowthSummaryPanel`, and a `DemoDataBadge` to distinguish seeded rows. Two answers to "what should I do next", side by side in the nav. |
| D2 | **Two buyer-message endpoints** | §8.3. |
| D3 | **Two revenue truths** | `/merchant/commerce-overview` (all statuses, page-capped) vs `revenue-evidence-service.ts` (`PAID` only, full history). Both are live and reachable. |
| D4 | **Two opportunity detectors in the domain** | `growth-opportunity.ts` + `opportunity-scan.ts` (catalogue-shaped: missing relationships, unbuyable products) and `revenue-opportunity.ts` (money-shaped: failed payments, stalled checkouts, repeat cadence). Not redundant in *logic*, but they produce two unreconciled opportunity vocabularies. |
| D5 | **`ProductDetailPage` vs `CustomerProductPage`** | The former is orphaned; the latter is routed. |

**Explicitly NOT duplicates** (checked, both are needed): `merchant-agent/recovery-service.ts` *proposes* recovery, `payments/recovery-execution-service.ts` *executes* an approved one. They share the policy pipeline rather than forking it.

---

## 10. Per-feature Track 01 assessment

Legend: **✅ satisfies** · **◐ partial** · **⚠ incorrect** · **⧉ duplicated** · **✖ unnecessary** · **♻ reuse as-is** · **✎ modify** · **⟲ replace**

| Feature | Verdict | Disposition |
|---|---|---|
| Agent gateway (protocol detect → reprice → policy → decide) | ✅ | ♻ Core asset. Do not touch except to add UI. |
| Agent identity, key pinning, trust score, mandates | ✅ | ♻ |
| Policy engine / approvals / execution authorizations | ✅ | ♻ |
| Hash-chained agent action ledger | ✅ | ♻ |
| Payments (Razorpay + mock, webhooks, reconciliation) | ✅ | ♻ |
| Failure-first recovery (propose → approve → execute) | ✅ | ♻ |
| Readiness engine | ✅ | ♻ |
| Catalog compiler (JSON-LD + MCP manifest, publish/rollback) | ✅ | ♻ |
| ACP / x402 / UAP / UCP adapters | ✅ | ♻ |
| Campaigns + attribution | ✅ | ♻ |
| Revenue Opportunity Engine (domain + service) | ✅ | ♻ Strongest new Track 01 asset. Commit it. |
| Composite growth / AI-buyer capability scores | ✅ | ♻ |
| Merchant Agent growth proposals | ✅ | ✎ Reconcile its opportunity vocabulary with D4. |
| Buyer Agent (intent → ranking → recommendation) | ◐ | ✎ Endpoint unreachable (§8.1); tests red (§8.2). |
| Customer negotiation | ◐ | ✎ Logic sound (domain tests green); integration path 403s. |
| Buyer spending policy | ◐ | ✎ Sound, but tenanted through a synthetic merchant. |
| Customer identity model | ⚠ | ⟲ `MerchantUser{role:CUSTOMER}` + merchant-id-as-buyer-context is the deepest debt. |
| Role gating in `auth/middleware.ts` | ⚠ | ✎ Prefix allowlists that contradict each other. Needs a route-declared policy, not string prefixes. |
| `/merchant/commerce-overview` | ⚠ | ⟲ Replace with the evidence service; it already computes this correctly. |
| Growth page duplication (D1) | ⧉ | ✎ Merge into one Growth surface. |
| Buyer message endpoints (D2) | ⧉ | ✎ Keep one. |
| Platform admin backend | ◐ | ✎ Needs a console, or should be descoped. |
| Gateway step-up decide + step-ups list | ◐ | ✎ Needs a console. |
| Post-purchase (539-line single route file) | ◐ | ✎ Works; wants a service layer before it grows. |
| Break-the-Agent / Protocols pages | ◐ | ✎ Backend is real and tested; wire the pages back or delete them. |
| `DemoTourPage` (651 LOC) | ✖ | Decide: route it as the jury path, or delete. |
| `ProductDetailPage` (334 LOC) | ✖ | ⟲ Superseded. |
| Landing page (2,795 LOC, 16 components) | ✖ (for Track 01 scoring) | Freeze. It is 14% of the frontend and 0% of the product. |
| Marketplace discovery | ✅ | ♻ |
| Sandbox / red-team | ✅ | ♻ backend; ✎ frontend. |
| Privacy (redaction, retention) | ✅ | ♻ |
| Evals (`eval:intent`, `eval:recommendation`) | ✅ | ♻ |

---

## 11. Files removed during this pass

Only files that are unambiguously scratch with zero inbound references:

| Path | Why |
|---|---|
| `apps/api/scripts/_probe.ts` … `_probe5.ts` | Five untracked ad-hoc Prisma query scripts written 2026-09-01 while auditing seeded data (`console.log("MERCHANT", m)`). No importer, no package.json script, no test. |
| `apps/web/src/auth/` | Empty directory. The real guard lives at `components/auth/RequireAuth.tsx`. |

`apps/api/dist/` (3.8 MB) is stale build output — it still contains a `modules/buyer-agent/providers/` directory that no longer exists in `src`. It is gitignored and regenerated by `pnpm build`, so it was left alone rather than deleted.

Not removed, pending the relevant transformation part: the four orphaned pages (§5), the duplicate endpoints (§9), and the landing page.

---

## 12. Highest-priority problems, ranked

**P1 — `POST /buyer-agent/messages` is 403 for every role, and 5 test suites are red.**
One uncommitted 3-line block in `auth/middleware.ts` did both. The AI Buyer is half the track. Fix the role model (route-declared, not prefix-matched), add `buildCustomerTestApp()`, collapse the duplicate message endpoint. *Everything else is downstream of this.*

**P2 — Two competing growth surfaces and two competing revenue numbers.**
`/merchant/growth` and `/merchant/offers` both answer "what should I do next" from different data. `/merchant/commerce-overview` and `revenue-evidence-service.ts` both answer "how much money is there" and disagree — the former counts cancelled orders and caps at 100 rows. For a track named *AI Growth*, having two growth pages that contradict each other is the most damaging thing a judge can click on.

**P3 — The governance loop has no console.**
`STEP_UP` decisions and the entire platform-admin surface are implemented, RBAC-gated, and unreachable from the UI. The single most compelling Track 01 demo beat — an AI buyer's order held for a human, and a human deciding it — currently requires curl.

**P4 — Nothing in CI provisions the CUSTOMER identity.**
`.github/workflows/ci.yml` runs migrate + seed, but the customer and platform-admin identities come from `scripts/provision-demo-identities.ts`, which CI never calls. Any test needing a real customer session cannot pass in CI even after P1 is fixed.

**P5 — Customer identity is modelled as a merchant.**
`MerchantUser{role: CUSTOMER}` in a synthetic `demo-customer-context` merchant, whose merchant id doubles as `buyerContext`. It works, and it will keep working — but every customer-side authorization question has to be answered twice because of it, which is exactly how P1 happened.

**P6 — 1,360 LOC of orphaned pages fronting real, tested backends.**
Break-the-Agent (601 LOC of tested backend), Protocols conformance, and the 651-line Demo Tour are all dark. This is capability the project has already paid for and is not showing.

---

## 13. What Part 1 should not do

- Do not rewrite `modules/gateway`, `modules/policy`, `modules/audit`, `modules/payments`, or `packages/domain`. They are correct, tested, and load-bearing.
- Do not add a second policy engine, a second ledger writer, a second authorization issuer, or a second opportunity vocabulary. The existing ones are single by design and the codebase defends that invariant in comments and tests.
- Do not delete `GrowthOpportunity` rows or the catalogue scan to resolve D1 — merge the two surfaces, and keep the `isSyntheticDemo` distinction that already lets seeded and real rows be told apart.
