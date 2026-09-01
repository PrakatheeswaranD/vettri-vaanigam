# Architecture

Concise reference for how Vaanigam is actually built. This document is
the "how"; the financial-safety rationale behind these choices is in
[`SECURITY.md`](SECURITY.md).

## Modular monolith, not microservices

One Fastify process (`apps/api`), one React SPA (`apps/web`), one
PostgreSQL database. Domain separation is enforced by folder/module
boundaries and TypeScript imports, not network calls or separate
deployables.

```
apps/api/src/modules/
├── merchant/          Merchant profile, policy read-view, aggregate stats
├── catalog/           Products, variants, inventory, CatalogQualityAnalyzer (evidence collection)
├── agent-commerce/    Agent-readable catalog mapper + routes (PART 02)
├── buyer-agent/       Intent extraction, deterministic catalog filtering, grounded recommendation (PART 03)
├── merchant-agent/    Growth opportunity engine, proposal validation, failure-recovery orchestration (PART 04, PART 08)
├── policy/            Deterministic Policy Engine, Approval Service, Execution Authorization Service, ledger fingerprinting (PART 05)
├── commerce/          CommerceGateway (read/discovery) + CommerceExecutionService, CartPricingService, order fingerprinting (PART 06)
├── payments/          PaymentGateway (RazorpayPaymentGateway + MockPaymentGateway), webhook verification, payment state transitions, recovery execution (PART 07, PART 08)
├── audit/             Agent Action Ledger (hash-chain append/verify) + workflow trace aggregation (PART 05, PART 08)
├── readiness/         AgenticReadinessEngine + snapshot persistence/history (PART 02)
├── growth/            Growth opportunities read-model
├── agents/            AIProvider interface + AnthropicProvider / DemoRuleBasedProvider / FixtureProvider (PART 03, relocated PART 04)
├── authorization/     Demo merchant context resolution
└── system/            Health / readiness endpoints
```

## Dependency direction

```
HTTP (Fastify routes)
   ↓
Application services  (modules/*/service.ts)
   ↓
Repository functions   (modules/*/repository.ts — thin Prisma wrappers)
   ↓
Prisma / PostgreSQL
```

`packages/domain` sits outside this stack entirely: it has zero
dependencies on Fastify, Prisma, HTTP, or any provider SDK. It is pure
TypeScript, independently tested, and imported by both `apps/api` (for
payment-state transitions, readiness rules) and `apps/web` (for readiness
dimension labels/order, so the frontend never redefines that vocabulary).

`packages/contracts` holds the Zod schemas that are the actual wire
contract between `apps/web` and `apps/api` — a DTO shape changes in
exactly one place, and both sides get a compile error if they drift.

## The financial safety boundary (established in PART 01, fully implemented by PART 09)

PART 01 established three narrow interfaces precisely so later parts could
fill them in without ever changing the shape callers depend on. As of
PART 09, all three are real, implemented, and load-bearing:

- **`CommerceGateway`** (`modules/commerce/gateway.ts`) — deliberately
  scoped to read/discovery only: `searchProducts`, `getProduct`,
  `getAuthoritativeProduct`. No payment or write method exists on it; the
  transactional write path (cart/order/checkout creation) lives directly
  in `modules/commerce/execution-service.ts`, the one orchestrator that
  may turn an `ExecutionAuthorization` into a real order (PART 06).
- **`PaymentGateway`** (`modules/payments/gateway.ts`) — the interface
  deterministic application code depends on instead of the Razorpay SDK
  directly: `createPaymentOrder`, `fetchPayment`, `verifyClientCompletion`,
  `verifyWebhookSignature`, `getPublicConfig`. Two implementations exist
  behind it — `razorpay-gateway.ts` (the real Test Mode adapter, thin REST
  client over `fetch`, no SDK dependency) and `mock-gateway.ts` (the
  deterministic test double the entire automated suite runs against) —
  chosen by `gateway-factory.ts` based on environment, never by caller
  code (PART 07).
- **`AIProvider`** (`modules/agents/ai-provider.ts`) — the interface every
  LLM call goes through (`extractIntent`, `rankCandidates`,
  `proposeGrowthAction`, `proposeRecoveryAction`), with three
  implementations (`AnthropicProvider`, `DemoRuleBasedProvider`,
  `FixtureProvider`) selected by `provider-factory.ts`. The PART 01
  placeholder `ai-service.ts` this section originally described was a
  fully orphaned stub (zero real usages) and was deleted once this real
  interface superseded it (PART 04).

The Policy Engine, Buyer Agent, Merchant Agent, and Razorpay integration
all compose through these three interfaces — no application or domain
module imports an LLM SDK or the Razorpay SDK directly (verified by grep
in `PROGRESS.md`'s Security sections for PART 03/07/08).

## Deterministic financial core (`packages/domain`)

- **`money.ts`** — `Money` is the only authoritative representation of a
  monetary value. Constructed only via `Money.of()`, which rejects
  non-integers, NaN/Infinity, and unsupported currencies at construction
  time — there is no way to hold an invalid `Money` instance. Arithmetic
  (`add`, `subtract`, comparisons) throws on currency mismatch.
- **`payment-state.ts`** — `PaymentState` transition table
  (`CREATED → AUTHORIZED → CAPTURED`, etc.). `transitionPaymentState`
  throws `PaymentStateError` on any illegal transition, including any
  attempt to move a terminal state (`CAPTURED`/`FAILED`/`CANCELLED`) to a
  *different* state. A same-state transition (duplicate webhook) is
  defined as a no-op, not an error — idempotency is a first-class case in
  the type, not an afterthought bolted on later.
- **`agent-action.ts`** — the `AgentActionStatus` lifecycle
  (`PROPOSED → PENDING_APPROVAL → APPROVED/REJECTED/EXPIRED → EXECUTED →
  FAILED/VERIFIED`), shared between the future approval flow and the
  ledger so they can't drift apart.
- **`readiness.ts`** — the nine Agentic Readiness dimensions,
  `computeWeightedOverallScore`, and `deriveReadinessRecommendations`: a
  pure function mapping dimension scores below threshold to fixed
  recommendation strings. No AI model is involved anywhere in this file.
- **`readiness-config.ts`** — the single authoritative home for the
  scoring formula's tunable constants: dimension weights, readiness-level
  thresholds, price-freshness age bands, and the critical-cap rule. See
  "Agentic Readiness formula" below.
- **`availability.ts`** — `deriveAvailabilityState`: quantity + active
  flag → `IN_STOCK`/`LOW_STOCK`/`OUT_OF_STOCK`/`UNAVAILABLE`/`UNKNOWN`.
  Missing inventory data is `UNKNOWN`, never silently `IN_STOCK`.
- **`product-readiness.ts`** — `deriveProductReadiness`: per-product
  CRITICAL vs IMPORTANT evidence → `AGENT_READY`/`PARTIALLY_READY`/
  `NOT_READY`. Any missing CRITICAL field (purchasable variant, valid
  price, known availability) forces `NOT_READY` regardless of everything
  else.
- **`blockers.ts`** — `prioritizeBlockers`: sorts by severity, then by
  affected-count within a severity tier, then by code — never
  alphabetically, so critical transaction blockers always surface above
  metadata polish.
- **`clock.ts`** — `Clock` abstraction (`systemClock` /
  `fixedClock(iso)`), so anything that scores "freshness" (age since an
  update) is testable without wall-clock flakiness.

## Agentic Readiness formula

Computed by `apps/api/src/modules/readiness/engine.ts`
(`runReadinessAssessment`), fed by `apps/api/src/modules/catalog/
quality-analyzer.ts` (`analyzeCatalog`) which reads all active
products/variants/inventory in one query pass — no N+1, no
per-UI-card recomputation. Flow:

```
PostgreSQL (active products + variants + inventory)
   ↓
CatalogQualityAnalyzer.analyzeCatalog()   — per-product evidence: readiness
   ↓                                        state, attribute/policy/inventory
   |                                        completeness, price/inventory age
   ↓
scoreDimensions()   — 9 dimension scores, each a % of real per-product
   ↓                  checks passed, averaged across active products
   ↓
computeWeightedOverallScore()   — weighted by READINESS_WEIGHTS (below)
   ↓
applyCriticalCap()   — caps a misleadingly high score if the merchant
   ↓                    can't actually transact (below)
   ↓
deriveReadinessLevel(), findWeakestDimension(), findStrongestDimension(),
deriveReadinessRecommendations(), buildBlockers(), buildStrengths()
   ↓
ReadinessSnapshot row (full dimension breakdown + evidence + blockers
persisted, not just the bare overall score)
```

**Weights** (sum to exactly 100, enforced by a test —
`packages/domain/src/readiness-config.test.ts`):

| Dimension | Weight | Why |
|---|---|---|
| Catalog Completeness | 15 | Prerequisite for any transaction |
| Checkout Readiness | 15 | Prerequisite for any transaction |
| Inventory Reliability | 13 | Needed to safely commit to a purchase |
| Policy Completeness | 12 | Needed to safely commit to a purchase |
| Price Freshness | 12 | Stale pricing risks quoting the wrong amount |
| Payment Reliability | 10 | Optimization/trust, not a hard blocker |
| AI Discoverability | 10 | Optimization/trust, not a hard blocker |
| Metadata Quality | 8 | Optimization/trust, not a hard blocker |
| Trust Information | 5 | Optimization/trust, not a hard blocker |

**Critical cap** (`applyCriticalCap`): if a merchant has zero active
variants at all, the score is capped at 0 regardless of every other
dimension. If variants exist but none are purchasable (priced + not
unavailable), the score is capped at 20. This exists specifically to
prevent a misleadingly high score (e.g. 92/100) for a merchant that
literally cannot complete a transaction.

**Checkout Readiness** is deliberately the stricter of the two
"can this be sold" measures in the engine: it's the percentage of active
products that are *not* `NOT_READY` (i.e. no missing CRITICAL field on
any active variant) — not merely "has at least one purchasable variant".
This keeps it consistent with the `PRODUCTS_NOT_TRANSACTABLE` CRITICAL
blocker; a looser definition would let the dimension score high while
that blocker simultaneously reported real, unaddressed gaps.

**Price freshness** uses age-since-`priceUpdatedAt` bands (also in
`readiness-config.ts`): ≤24h → 100, ≤72h → 90, ≤7d → 75, ≤30d → 55,
older → 35.

**Readiness levels**: `AGENT_READY` ≥90, `NEARLY_READY` ≥75,
`PARTIALLY_READY` ≥50, `NOT_READY` below that.

**Calculation version**: `READINESS_MODEL_VERSION` (currently `"2.0"`),
persisted on every snapshot, so a score computed under one formula
version is never misread as comparable to a score from a different one
after the formula changes.

**No LLM anywhere in this path** — every function above is a pure
computation over real Prisma query results.

## Database

PostgreSQL via Prisma. Schema: `apps/api/prisma/schema.prisma`. Real,
tracked migrations under `apps/api/prisma/migrations/` — not
`db push`/sync-only:

- `20260101000000_init` — PART 01 foundation schema. Financially important
  tables have explicit CHECK constraints (non-negative money/inventory,
  percentage bounds) beyond what Prisma's schema language expresses
  declaratively; see its tail.
- `20260102000000_agent_catalog_and_readiness_v2` — PART 02: adds
  `Product.promotionEligibility`, `ProductVariant.priceUpdatedAt`, and
  extends `ReadinessSnapshot` with `level`, `metadataQuality`,
  `trustInformation`, `blockers`, `strengths`, `evidence`, and
  `calculationVersion`. Since the readiness formula changed versions (v1
  implicit → v2 explicit), this migration clears the `ReadinessSnapshot`
  table before adding the new `NOT NULL` columns — safe because that table
  holds only recomputable synthetic/demo data, never financial history,
  and the seed script recalculates a real snapshot immediately after.

Order/OrderItem snapshot the product name, variant title, and unit price
at the time of purchase — historical order value is never reconstructed
from current catalog pricing.

### Local dev database

No Docker or native Postgres install is available/reachable in this
sandbox (see the README's "Local development setup" section for the full
explanation). `scripts/db-server.mjs` runs PGlite — real PostgreSQL
compiled to WASM — behind the actual Postgres wire protocol, so every
layer above it (Prisma, migrations, the app) is unaware anything is
different. Swapping in a real Postgres server anywhere else requires
changing `DATABASE_URL` only.

## Data flow example: Overview page

```
Browser → GET /api/v1/readiness/latest
   → registerReadinessRoutes (modules/readiness/routes.ts)
   → getDemoMerchantId()               (server resolves merchant; never trusts client input)
   → getLatestReadiness()               (modules/readiness/service.ts)
   → findLatestSnapshot()                (modules/readiness/repository.ts → Prisma)
   → toReadinessSnapshotDTO()             (mapper.ts — Prisma model → wire DTO)
   ← ReadinessSnapshotDTO (validated by the same Zod schema on both ends)
Browser: useReadinessLatest() (TanStack Query) → ReadinessPage renders
   loading / error / empty / success explicitly — never a silent fallback.
```

## Agent-readable catalog architecture

```
Merchant Product Data (Prisma)
   ↓
CatalogQualityAnalyzer   — evidence collection (shared with the readiness engine)
   ↓
deriveAvailabilityState() per variant, deriveProductReadiness() per product
   ↓
AgentReadableProduct mapper (modules/agent-commerce/mapper.ts)
   ↓
Zod schema validation (agentReadableProductSchema, packages/contracts)
   ↓
GET /api/v1/agent-commerce/catalog[/:id]
```

The Buyer Agent (PART 03) consumes the catalog through this exact
boundary — never by querying Prisma directly. See the next section for
the full pipeline.

## Buyer Agent architecture (PART 03)

```
Buyer message (untrusted input)
   ↓
AIProvider.extractIntent()            — modules/agents/ai-provider.ts
   ↓
Zod schema validation (rawIntentSchema, intent-extraction.ts)
   ↓
Deterministic normalization            — normalizeCategory(), normalizeBudgetAmount()
   ↓
mergeIntentSignal()                    — @razorgrowth/domain, conversation continuity
   ↓
needsClarification() ?  → CLARIFICATION_REQUIRED (stop here)
   ↓ no
CommerceCatalogGateway.searchCandidateProducts()  — category filter only, real SQL
   ↓
evaluateCandidates()                   — per-variant eligibility, exact vs near-match
   ↓
buildRecommendations()                 — mode decision + AI ranking (bounded) + grounding
   ↓
validateGrounding()  → invalid? → fallbackRank() (deterministic)
   ↓
buildRecommendedProduct()              — authoritative hydration + verified reason codes
   ↓
BuyerAgentResponseDTO
```

**AIProvider boundary** (`modules/agents/ai-provider.ts` — relocated from
`modules/buyer-agent/` in PART 04 so the Merchant Agent could share the
same interface rather than a second one being built). The Buyer Agent
uses two of its four operations — `extractIntent` and `rankCandidates` —
matching PART 00 §26/§32 (least privilege, no `executeAnything()`). Three
implementations exist behind the same interface:

- `providers/demo-rule-based-provider.ts` — deterministic regex/keyword
  extraction, used whenever `AI_PROVIDER_API_KEY` is unset (the default).
  Clearly labeled `mode: "DEMO_RULE_BASED"` everywhere in logs, the ledger,
  and the UI — never presented as live AI. This is a deliberate demo-
  reliability decision (PART 00 §46): the full golden path works with zero
  network dependency and zero API cost.
- `providers/anthropic-provider.ts` — real Anthropic Messages API calls
  over plain `fetch` (no SDK dependency, keeping provider wire-format
  knowledge isolated to this one file). Only selected when
  `AI_PROVIDER_API_KEY` is configured.
- `providers/fixture-provider.ts` — scriptable test double used by every
  grounding/injection/failure test; `pnpm test` never needs network access
  or a real key.

Selection happens once at startup (`provider-factory.ts`), not per
request — predictable, and easy to explain under questioning.

**BuyerIntent contract.** The wire shape (`buyerIntentSchema`, `packages/
contracts/src/buyer-agent.ts`) is the NORMALIZED, post-merge intent —
never raw model output. Hard constraints
(`requiredAttributes`/`excludedAttributes`/`budget`) are structurally
separate from `preferredAttributes`; only hard constraints affect
eligibility (`@razorgrowth/domain` `evaluateEligibility`), preferences
only affect ranking. Money is normalized in exactly one place
(`budget-normalization.ts`): the extractor proposes a MAJOR-unit rupee
figure (asking a model to also multiply by 100 would let an arithmetic
slip become an authoritative financial value), and normalization converts
+ bounds-checks it into integer minor units.

**Catalog gateway scope decision.** `catalog-gateway.ts` pushes only
CATEGORY down as a real SQL filter. Price is deliberately NOT pushed to
SQL: doing so would make near-match discovery (PART 03 §32-§34)
impossible, since a near-match candidate is by definition over budget and
would be excluded by a `WHERE price <= maxPrice` clause before the
application ever saw it. Price, required-attribute (size/color), and
exclusion filtering all happen deterministically in `candidate-
evaluation.ts` afterward — safe for this catalog's size (~25 products,
category-filtered down to a handful) though it would need revisiting for
a much larger catalog.

**Grounding validator** (`@razorgrowth/domain` `recommendation-
grounding.ts`). Batch-level and strict: if the model recommends even one
product ID outside the supplied candidate set, duplicates a product, uses
an invalid rank, or proposes an unknown reason code, the ENTIRE ranking is
rejected — not just the bad item — and `recommendation-service.ts` falls
back to `fallbackRank()` (pure, deterministic: preference matches → 
readiness → price → metadata completeness → product ID, in that order).
Every recommendation's reason codes are additionally intersected against
an independently, deterministically computed "true" set
(`deriveReasonCodes`) before being shown to the buyer — a model can never
get credit for a claim (e.g. "matches your preference") that isn't
actually true of that specific candidate.

**Recommendation modes** (`AI_RANKED | DETERMINISTIC_SINGLE_MATCH |
DETERMINISTIC_FALLBACK | NEAR_MATCH | NO_MATCH`) are stored on every
`RecommendationRecord` and shown in the UI's technical strip — so
"the AI ranked this" vs. "grounding failed, code ranked this instead" is
never ambiguous (PART 03 §108, §160). Cost/latency optimizations (§156-
§159): a single exact candidate or a near-match-only outcome never
triggers an AI ranking call at all; the demo rule-based provider never
triggers one either (it would just be relabeling its own deterministic
fallback logic as "AI ranked", which PART 03 §108 explicitly forbids).

**Evaluation architecture** (`evals/buyer-intent/`, `evals/
recommendation/`, run via `pnpm eval:intent` / `pnpm eval:recommendation`).
Both scripts run the exact production pipeline against whichever
`AIProvider` this environment would actually select — this is a
CONTRACT/regression eval by default (deterministic provider, no network),
and becomes a LIVE evaluation automatically once `AI_PROVIDER_API_KEY` is
configured. The report header always states which mode produced the
numbers; if no key is configured, the report says so explicitly rather
than silently reusing contract numbers as if they were live-model results.
The recommendation eval also runs one fixed adversarial scenario (a
scripted hallucinating provider) specifically to prove the harness can
detect a deliberately broken implementation (PART 03 §149) — an eval that
can't fail on a known-bad case isn't a useful eval.

**Prompt injection defenses** (PART 03 §54-§58). The system prompts for
both extraction and ranking explicitly state that buyer messages and
catalog data are untrusted content, never instructions; the ranking model
is instructed to select only from the supplied candidate ID list. But the
real control is architectural, not the model's cooperation: hidden/draft
products are never in the catalog boundary the Buyer Agent can reach in
the first place (PART 02 visibility enforcement), and the grounding
validator rejects any product ID outside the supplied set regardless of
why the model produced it.

## Merchant Agent architecture (PART 04)

```
Selected/primary product (from a merchant-picked product, or a PART 03
buyer conversation/recommendation)
   ↓
MerchantGrowthConfig                   — modules/merchant-agent/repository.ts
   ↓ (bounds which action types may even be proposed)
Opportunity Engine                     — modules/merchant-agent/opportunity-engine.ts
   ↓ (ProductRelationship rows → hydrated via PART 02's agent-commerce
   ↓  boundary → evaluateGrowthCandidates: eligible vs BLOCKED_BY_DATA)
Bounded candidate set (eligible + blocked)
   ↓
Merchant Agent (AIProvider.proposeGrowthAction) OR deterministic path
   ↓
RawGrowthProposal (untrusted)
   ↓
validateGrowthProposal()               — @razorgrowth/domain, deterministic
   ↓
PROPOSED (+ offer/opportunity calculated) | REJECTED_VALIDATION
   ↓
GrowthActionProposalDTO — policyStatus always "NOT_EVALUATED" (PART 05)
```

**Shared `AIProvider`, not a second integration** (PART 04 §52). The
Buyer Agent's provider abstraction was relocated from `modules/buyer-
agent/` to `modules/agents/` this part specifically so the Merchant Agent
could extend the SAME interface (`extractIntent` / `rankCandidates` /
`proposeGrowthAction`) rather than standing up a parallel one — this also
retired a fully orphaned PART 01 stub (`modules/agents/ai-service.ts`,
never imported anywhere) that the real PART 03 `AIProvider` had already
superseded without anyone deleting it. Prompt text lives in `modules/
agents/prompts/{buyer,merchant}-prompts.ts` — infrastructure location,
per-agent content.

**Growth action taxonomy** (`@razorgrowth/domain` `growth-action.ts`):
`CROSS_SELL | UPSELL | BUNDLE | BOUNDED_OFFER | RECOVERY`, each mapped
deterministically from a `ProductRelationshipType`
(`COMPLEMENTARY→CROSS_SELL`, `UPSELL_ALTERNATIVE→UPSELL`,
`BUNDLE_COMPATIBLE→BUNDLE`, `SIMILAR→CROSS_SELL`) — the model never
invents this mapping.

**Opportunity Engine** (`opportunity-engine.ts`). Converts a product's
`ProductRelationship` rows into a bounded candidate set — never the whole
catalog — hydrating every candidate through PART 02's `agent-commerce`
boundary (`getAgentCatalogProduct`), so a DRAFT/ARCHIVED relationship
target can never appear as a live candidate: it 404s and is recorded as
`PRODUCT_NOT_AGENT_VISIBLE` instead. `evaluateGrowthCandidates`
(`@razorgrowth/domain`) then splits candidates into ELIGIBLE and BLOCKED —
a blocked candidate is a real merchant-configured relationship that
missing machine-readable data (UNKNOWN inventory, no price, no structured
attributes, no policy data) currently prevents from becoming a safe
proposal. **This is the readiness → growth economic connection made
concrete**: the seed data includes one product (`Meridian QuickBelt
Hydration Belt`) with deliberately forced UNKNOWN inventory, related by a
real COMPLEMENTARY relationship to `Meridian Pulse Runner` — every
proposal for that product surfaces the blocked opportunity alongside the
normal eligible one, with a concrete remediation ("record current
inventory") rather than a generic statement.

**Deterministic proposal validator** (`@razorgrowth/domain`
`growth-proposal-validation.ts`). Every proposal — AI-generated or
deterministic — passes through one gate before it can be persisted:
known action type, action type enabled by merchant config, every
product ID in the supplied candidate set (never a hallucination), no
duplicates, bounded item count, known reason codes, and (upsell-specific)
uplift within the configured ceiling AND within the buyer's hard budget
if known. Offer bounds (percentage or fixed-amount) are checked against
`maxProposedDiscountBps` — a fixed amount is converted to an equivalent
bps-of-price figure first, so it can't be used to sidestep the same
ceiling. On ANY failure the whole proposal is rejected
(`REJECTED_VALIDATION`) — never silently clamped to the nearest legal
value, which would misrepresent what the model actually proposed.

**Deterministic offer/opportunity arithmetic** (`@razorgrowth/domain`
`growth-money.ts`). Percentages are integer basis points (500 = 5%),
never floats; `calculateOffer` floors a percentage discount so rounding
can never push it over the configured bps ceiling, and clamps the
discount to `[0, baseAmount]` so a proposal can never make the final
amount negative. `calculateOpportunity` is the ONLY place a "potential
basket" number is computed — always labeled OPPORTUNITY in the UI, never
"revenue" (PART 04 §44, §84).

**One deterministic algorithm, three call sites**
(`deterministicGrowthProposal`, `@razorgrowth/domain`
`growth-opportunity.ts`). Used by (1) the demo rule-based provider's
`proposeGrowthAction`, (2) the orchestrator's single-eligible-candidate
shortcut, and (3) the orchestrator's AI-failure fallback — one algorithm,
never three copies that could silently diverge on what "deterministic"
means. It never proposes an offer of its own accord (no `offer` field
exists on its return type at all — structurally impossible to fabricate a
discount from this path).

**Cost/latency optimization** (PART 04 §62, mirrors PART 03 §158-159): a
single eligible candidate, or the demo provider (`mode !==
"LIVE_ANTHROPIC"`), never triggers an AI reasoning call — going straight
to the shared deterministic algorithm instead, labeled
`DETERMINISTIC_RELATIONSHIP` (never mislabeled `AI_PROPOSED`).

**Buyer-context reuse, not re-parsing** (PART 04 §28). When a proposal
request carries a `conversationId` or `recommendationId`, the orchestrator
reads the already-validated, already-normalized `BuyerIntentDTO` snapshot
straight from PART 03's `BuyerConversation`/`RecommendationRecord` tables
(`preferredAttributes`, `budget.maxMinor`) rather than re-parsing raw
buyer text — the buyer's hard budget constraint then directly bounds
which upsell candidates the validator will accept.

**`RECOVERY` proposals from a real `NEAR_MATCH` outcome, not a fixture
only.** `tryBuildRecoveryProposal()` in `merchant-agent/service.ts` takes
the `recommendationId` a Buyer Agent turn already returns, confirms the
record's `mode` was `NEAR_MATCH` and that the primary product actually
appeared in it, then computes the exact gap between that product's price
and the buyer's disclosed budget ceiling and sizes a `PERCENTAGE` offer to
close it — `Math.ceil` on the required bps so the offer never
under-closes the gap, then clamped to `maxProposedDiscountBps` so the
merchant's ceiling still governs even when it can't fully close a large
gap. The resulting `RawGrowthProposal` still passes through the same
`validateGrowthProposal()` gate as every other proposal type — there is
no separate, less-strict validation path for recovery offers. This makes
`RECOVERY` (and, by extension, `BOUNDED_OFFER`'s sibling machinery)
exercisable end-to-end from a real UI action instead of only from a
scripted `LIVE_ANTHROPIC`-mode fixture test.

**Readiness → growth connection is now visible on blocked opportunities,
not just structurally possible.** New `readiness-context.ts` maps each
`GrowthBlockerCode` to the specific `ReadinessSnapshot` dimension it
corresponds to (e.g. `UNKNOWN_INVENTORY → inventoryReliability`) and reads
the merchant's actual latest snapshot via PART 02's existing
`findLatestSnapshot` — read-only reuse across the module boundary, no
PART 02 code touched. Deliberately, this attaches only the REAL current
score, never a projected after-fix score or delta: computing one would
mean either fabricating a number (against the synthetic-data honesty rule
in the Master Contract) or actually mutating data and re-running
`POST /readiness/recalculate` as a side effect of viewing a proposal,
which is a materially different feature than "show why this is blocked."

## Policy Engine, Approval Lifecycle & Execution Authorization architecture (PART 05)

```
GrowthActionProposal (PROPOSED, from PART 04)
   ↓
POST /policy/evaluate
   ↓ revalidate commerce facts (agent-visible? purchasable? current currency?)
   ↓ derive discountBps/orderAmountMinor from the proposal's OWN stored
   ↓   offer/opportunity JSON — never a value the AI proposal itself carried
evaluatePolicy() (@razorgrowth/domain, pure, zero AI/DB dependency)
   ↓
PolicyEvaluation row (outcome, reasonCodes, evaluatedPolicyVersion,
proposalFingerprint) + GrowthActionProposal.status transition, in one
transaction with a POLICY_ALLOWED/POLICY_DENIED/POLICY_EVALUATED ledger event
   ↓
 ALLOW ──────────────────┐              DENY               REQUIRE_APPROVAL
   ↓                      │               ↓                       ↓
issueExecutionAuthorization  (terminal: POLICY_DENIED)   PENDING_APPROVAL
(automatic, same request)                                         ↓
   ↓                                              POST /approvals/:id/approve
ExecutionAuthorization (ACTIVE, fingerprint-bound,              or /reject
policy/approval-bound, time-limited) + AUTHORIZED status               ↓
                                                        Approval row (APPROVED/
                                                        REJECTED) + status
                                                        transition, then the
                                                        SAME issueExecution-
                                                        Authorization call
```

**Rule precedence is total and centralized in one function** (`evaluatePolicy`,
`@razorgrowth/domain/policy-engine.ts`). Four tiers, always checked in this
order, and a lower tier can never override a higher one: (1) invalid/unsafe
— disabled action type, expired proposal (`proposalValidityMinutes`),
currency mismatch, product no longer eligible/available, an internally
inconsistent policy configuration (auto-approval threshold above the hard
max), or a `RECOVERY` proposal at its attempt limit → always `DENY`,
regardless of amount, with every applicable reason collected, not just the
first; (2) a hard-limit breach (`discountBps > maxDiscountBps` or
`orderAmountMinor > maxOrderAmountMinor`) → `DENY`; (3) an
approval-threshold breach but within the hard limit → `REQUIRE_APPROVAL`;
(4) otherwise → `ALLOW`. Boundary semantics are explicit and tested:
exactly at the auto-approval threshold auto-`ALLOW`s; exactly at the hard
maximum still `REQUIRE_APPROVAL`s rather than denying (the max is the
highest value policy will ever authorize, gated by a human, not a value
that's simultaneously "permitted" and "denied").

**The demo policy is deliberately NOT the same number twice.**
`MerchantGrowthConfig.maxProposedDiscountBps` (PART 04, what the Merchant
Agent may even shape a proposal to) is seeded at 1000 (10%);
`MerchantPolicy.maxDiscountBps` (PART 05, what real governance actually
permits) is seeded at 800 (8%). A 9% proposal is therefore a perfectly
valid `PROPOSED` row — PART 04's validator has no objection — that PART
05's Policy Engine still legitimately `DENY`s. This is real defense in
depth, not two copies of the same limit: the agent-shape ceiling exists so
a hallucinating model can't even construct an absurd proposal; the policy
hard limit is the actual governance authority, and it is free to be
stricter.

**Proposal fingerprint** (`apps/api/src/modules/policy/fingerprint.ts`,
`PROPOSAL_FINGERPRINT_VERSION = "1"`) — `SHA256(canonical({ proposalId,
merchantId, actionType, primaryProductId, relatedProductIds (sorted),
offerKind, offerPercentageBps, offerAmountMinor, currency }))`, built on a
shared deterministic canonicalizer (`@razorgrowth/domain`
`canonicalStringify` — recursively sorts object keys, preserves array
order, used identically by the ledger hash chain below). `PolicyEvaluation`,
`Approval`, and `ExecutionAuthorization` each store the fingerprint that
was true when they were created. Because this system's proposals are
immutable by design (no `PATCH` endpoint exists on `GrowthActionProposal`
— every request creates a new row), there is no real user-facing path that
mutates a proposal's terms after the fact; the "proposal tamper" safety
property (PART 05 §118) is proven instead by a test that directly mutates
the persisted row via Prisma and confirms authorization issuance then
correctly refuses with `PROPOSAL_CHANGED` — a deliberate, honest way to
exercise a safety property whose real-world trigger (a future data-repair
tool, a race with some other future write path) doesn't exist yet, without
building a fake edit feature just to test it.

**Approval Service** (`modules/policy/approval-service.ts`) creates an
`Approval` row only at decision time (`APPROVED`/`REJECTED`) — there is no
separate "request" row; the request IS the proposal's `PENDING_APPROVAL`
status plus an `APPROVAL_REQUESTED` ledger event. `approverId` is a fixed
server-side constant (`"demo-merchant-owner"`), never read from the
request body (PART 00 §36, PART 05 §33). A database-level unique
constraint on `Approval.proposalId` makes concurrent duplicate decisions
safe: if two requests race, one wins the insert; the other catches the
`P2002` conflict and either returns the same row idempotently (identical
decision — a double-click retry) or surfaces `APPROVAL_ALREADY_DECIDED`
(conflicting decision — a genuine race), verified by a concurrency test
that fires both simultaneously.

**Authorization Service** (`modules/policy/authorization-service.ts`) is
the sole place an `ExecutionAuthorization` is created. Before issuing one
it: (1) reconciles any existing `ACTIVE` row against the CURRENT proposal
— if the fingerprint no longer matches, the row is retired (`REVOKED`) and
issuance is refused, even though nothing marked it inactive until this
exact check ran; if merely expired, it's retired (`EXPIRED`) and a fresh
issuance is attempted; (2) refuses outright (`AUTHORIZATION_NOT_ALLOWED`,
403) if the proposal's status structurally cannot be authorized yet
(`PROPOSED`, `PENDING_APPROVAL`) or never can be (`POLICY_DENIED`,
`REJECTED_VALIDATION`, `APPROVAL_REJECTED`); (3) re-evaluates policy from
scratch if `PolicyEvaluation.evaluatedPolicyVersion` no longer matches the
current `MerchantPolicy.policyVersion` — re-evaluation can move a
previously-`APPROVED` proposal back to `PENDING_APPROVAL` under a
tightened policy, which is correct: a materially changed policy means the
old human approval no longer covers the current terms; (4) recomputes the
fingerprint and compares it to the policy decision's (and, if applicable,
the approval's) stored value; (5) for `REQUIRE_APPROVAL`, requires a
matching, unexpired, `APPROVED` `Approval`; (6) revalidates the product is
still agent-visible, purchasable, and priced in the expected currency. A
partial unique index — `CREATE UNIQUE INDEX ... ON "ExecutionAuthorization"
("proposalId") WHERE status = 'ACTIVE'` (hand-written in the migration;
not representable in `schema.prisma`'s DSL) — enforces at most one active
authorization per proposal at the database level even under concurrent
issuance requests; a race is caught as a `P2002` conflict and resolved
idempotently to whichever request's row actually committed.

**Every refusal is a structured result, never an exception.** Once a
proposal is in a status where authorization is a meaningful thing to
attempt, a failed check returns `{ denied: true, reasonCode, explanation }`
(200 OK) rather than throwing — "not yet authorized" is an expected
governance outcome, not a bug. Only a genuinely wrong-lifecycle-stage
request (asking to authorize something that structurally can't be, yet or
ever) is a thrown `AppError` (403 `AUTHORIZATION_NOT_ALLOWED`).

**Agent Action Ledger hash chain** (`modules/audit/ledger.ts`). Every
ledger write in the entire repository — Buyer Agent, Merchant Agent,
readiness recalculation, and all of PART 05's policy/approval/authorization
events — goes through one function, `appendLedgerEvent`, which assigns a
1-indexed `sequence` per `workflowId` and computes `eventHash =
SHA256(canonical({workflowId, sequence, merchantId, actorType, actionType,
conciseReason, relatedEntityType, relatedEntityId, metadata,
previousEventHash}))`. This is explicitly application-level tamper
EVIDENCE, not a blockchain: `verifyWorkflowLedger` recomputes the chain
from persisted rows and reports the first sequence at which stored data no
longer matches what was recorded at write time — sufficient to detect an
altered or removed row, nothing more, and never marketed as more. Chaining
is scoped per `workflowId` (PART 05 §59) rather than one global chain,
which keeps concurrency reasoning local: two unrelated proposals' ledgers
can never interfere with each other, and a write race within ONE workflow
is caught via the `(workflowId, sequence)` unique constraint and retried
by `withLedgerConcurrencyRetry` (re-runs the whole enclosing transaction on
that specific conflict, nothing else). PART 05's Merchant Agent proposal
workflow reuses the SAME `workflowId` the proposal's own `traceId` already
established (PART 04) — policy/approval/authorization events chain
directly onto the `GROWTH_PROPOSAL_CREATED` event, so one workflow's
timeline tells the complete governance story for that proposal. The Buyer
Agent's own conversation-level workflow is a separate, earlier chain — a
deliberate scope decision (linking them would require carrying a buyer
conversation's `traceId` all the way through into a growth proposal; PART
04's `RECOVERY` path already has that context available since it's
triggered from a real buyer conversation, but an ordinary
relationship-based proposal has no buyer-conversation context to link to
at all, so there is no single convention that would cover every case).

**`MerchantPolicy` evolved, not duplicated, from its PART 01 placeholder
shape.** The original shape (`maxDiscountPercent` as a single ceiling,
`approvalThresholdMinor` as an unrelated absolute amount) never actually
enforced anything — PART 01 explicitly scoped it as "read-only... the
future Policy Engine reads this." Now that PART 05 IS that future engine,
the shape was redesigned to what real enforcement actually needs: bps
throughout (never a bare percent), an explicit `autoApprovalDiscountBps`
distinct from `maxDiscountBps` (PART 05 §10 — collapsing these into one
number was the single most important thing NOT to do), a `policyVersion`
that increments on every edit, and three separate validity-window fields
(`proposalValidityMinutes`, `approvalValidityMinutes`,
`authorizationValidityMinutes`) since a proposal, an approval, and an
authorization are three different things with three different lifetimes.

## Commerce Execution architecture (PART 06)

```
ExecutionAuthorization (ACTIVE, from PART 05)
   ↓
POST /commerce/checkout  { authorizationId, selection: { productId,
                            variantId, quantity }, idempotencyKey }
   ↓ idempotency pre-check (same key+fingerprint → return stored response;
   ↓   same key, different fingerprint → 409 IDEMPOTENCY_CONFLICT)
   ↓ load ExecutionAuthorization (must be ACTIVE, unexpired, fingerprint
   ↓   still matching the CURRENT proposal — reuses PART 05's own check)
resolveAuthorizedSelection() (@razorgrowth/domain, pure, closed mapping
from GrowthActionType → resulting cart lines)
   ↓
rehydrate every line's product/variant/price/inventory from the database
(CommerceGateway.getAuthoritativeProduct — NEVER the proposal's stored
snapshot, NEVER the request body)
   ↓ offer/order-amount staleness check (against priceRangeMinMinor, see
   ↓   below — not the actual charged variant's price)
CartPricingService.calculateCartTotals() (@razorgrowth/domain calculateOffer,
pure, integer minor units)
   ↓
ONE transaction:
  COMMERCE_EXECUTION_REQUESTED → AUTHORIZATION_VALIDATED
  → Cart + CartItems created → CART_CREATED [→ AUTHORIZED_OFFER_APPLIED]
  → consumeExecutionAuthorization() (row-level UPDATE ... WHERE status =
    'ACTIVE', count === 1 or the whole transaction aborts)
  → EXECUTION_AUTHORIZATION_CONSUMED
  → Order + OrderItems created → ORDER_CREATED
  → computeOrderFingerprint() stored on the Order
  → CheckoutSession created (status READY_FOR_PAYMENT) → CHECKOUT_CREATED
  → CHECKOUT_READY_FOR_PAYMENT
  → IdempotencyRecord written (this response snapshot, for future retries)
   ↓
CheckoutResponseDTO { status: READY_FOR_PAYMENT, totals, items,
appliedOffer?, authorization: { consumed: true }, payment: { status:
"NOT_STARTED" }, orderFingerprint, expiresAt }
   ↓
                                          [ STOPS HERE — PART 07 owns
                                            everything past this line ]
```

**`CommerceExecutionService.executeAuthorizedSelection`**
(`apps/api/src/modules/commerce/execution-service.ts`) is the single
orchestrator and the ONLY code path that turns an `ExecutionAuthorization`
into a real `Cart`/`Order`/`CheckoutSession`. It never accepts a raw
`GrowthActionProposal`, a frontend boolean, or a client-submitted price/
discount/total as authority — `commerceExecutionRequestSchema`
(`packages/contracts/src/commerce.ts`) has no such field to even send;
Zod strips unknown keys, so a client that sends one anyway has it
silently discarded, not merely rejected.

**`resolveAuthorizedSelection`** (`packages/domain/src/
commerce-execution.ts`, pure, 9 tests) is the closed mapping from action
type to resulting cart lines: `CROSS_SELL`/`BUNDLE` add the related
product(s) at quantity 1 alongside the buyer's own selection; `UPSELL`
replaces the primary with the related product at the buyer's quantity
(never both at once); `BOUNDED_OFFER`/`RECOVERY` discount the buyer's own
primary product (no substitution). Exactly one resulting line is ever
`offerEligible: true` in any branch.

**The `priceRangeMinMinor` staleness-check design (the key non-obvious
decision in this part).** PART 04/05's product-level price estimate is
computed by `agent-commerce/mapper.ts` as "cheapest variant not
explicitly `UNAVAILABLE`" — which includes variants with `UNKNOWN`
(never-recorded) inventory. That is a *different set* than "cheapest
variant PART 06 may actually charge," which must be genuinely purchasable
(`IN_STOCK`/`LOW_STOCK`). Comparing "the price of the variant about to be
charged" against "PART 04/05's own estimate" produces false-positive
`PRICE_CHANGED`/`COMMERCE_STATE_CHANGED` rejections whenever a product
happens to have a cheaper `UNKNOWN`-inventory variant. The fix:
`AuthoritativeCommerceProduct.priceRangeMinMinor`
(`apps/api/src/modules/commerce/gateway.ts`) is computed with the
IDENTICAL filter PART 04/05 already use, and is what staleness checks
compare against — never the actual charged variant's price, which always
comes from the real, currently-purchasable variant regardless. A genuine
price change on the purchasable variant still moves
`priceRangeMinMinor` (since it's still the current cheapest-eligible
price), so the check is not weakened, only correctly aimed.

**Idempotency and one-time authorization consumption both reuse patterns
PART 05 already established, rather than inventing new ones.**
`IdempotencyRecord` (`@@unique([merchantId, operation, idempotencyKey])`)
uses the identical P2002-catch-and-refetch-the-winner pattern PART 05
uses for `Approval`/`ExecutionAuthorization` creation.
`consumeExecutionAuthorization` (`apps/api/src/modules/policy/
repository.ts`) is a single `updateMany({ where: { id, status: "ACTIVE"
}, data: { status: "CONSUMED" } })`, relying on Postgres serializing
competing `UPDATE`s on the same row: under a concurrent race exactly one
request sees `count === 1`, and the other throws
`AuthorizationConsumedRaceError` (propagated through
`withLedgerConcurrencyRetry` unmodified — it is a domain error, not a
ledger-sequence `P2002`) and rolls back to a `409
AUTHORIZATION_ALREADY_CONSUMED`.

**`CommerceGateway` is deliberately scoped as read/discovery only**
(`searchProducts`, `getProduct`, `getAuthoritativeProduct`) — the
transactional write path lives directly in `CommerceExecutionService`.
There is exactly one write orchestrator for commerce execution in this
codebase; routing it through a second interface would be indirection
with no present benefit.

**Order/checkout financial fingerprint** (`computeOrderFingerprint`,
`apps/api/src/modules/commerce/order-fingerprint.ts`) —
`SHA256(canonical({orderId, merchantId, currency, totalAmountMinor,
authorizationId, lines (sorted by variantId)}))`, built on the SAME
`canonicalStringify` PART 05's proposal fingerprint uses. This is what
PART 07 must trust instead of any client-submitted amount when it
creates the real Razorpay order.

**PART 06 stops at `READY_FOR_PAYMENT`.** No Razorpay SDK call exists
anywhere in this part; `checkout.payment.status` is always the literal
`"NOT_STARTED"`.

## Payments architecture (PART 07)

```
CheckoutSession (READY_FOR_PAYMENT, from PART 06)
   ↓
POST /payments/initiate  { checkoutId }
   ↓ validate READY_FOR_PAYMENT, unexpired
   ↓ recompute + verify order fingerprint against persisted Order/OrderItem
   ↓ create ONE Payment row (checkoutId UNIQUE — one attempt per checkout)
   ↓ [OUTSIDE any DB transaction] PaymentGateway.createPaymentOrder()
   ↓ atomic claim: updateMany WHERE providerOrderId IS NULL
   ↓ CheckoutSession → PAYMENT_IN_PROGRESS, Order → PAYMENT_PENDING
   ↓
PaymentInitiationResponseDTO { paymentId, providerOrderId, keyId,
amountMinor, currency, testMode: true }
   ↓
BROWSER opens Razorpay's own Checkout widget with these server-issued
values — never amounts/currency it computed itself
   ↓
        ┌───────────────────────────┬───────────────────────────┐
        ▼                           ▼                           ▼
razorpay_* callback          Razorpay webhook            Manual reconcile
(LOWEST confidence —         (verified via raw-body       (direct provider
 signature only proves       HMAC signature BEFORE         fetch, e.g. a
 order/payment id pair is    any parsing)                  lost webhook)
 self-consistent)                  │                           │
        │                          │                           │
        ▼                          ▼                           ▼
verify signature exactly    check-then-insert on         PaymentGateway.
matches THIS payment's      eventFingerprint (dedup —     fetchPayment()
providerOrderId, then       Razorpay has no guaranteed
PaymentGateway.             stable top-level event id)
fetchPayment() for the             │
REAL authoritative state           ▼
        │                   resolve Payment by
        │                   providerOrderId (§85: unknown
        │                   order → UNRESOLVED, never
        │                   fabricate an order)
        └──────────────┬────────────┘
                        ▼
        resolvePaymentEvent() — THE ONLY function that turns
        verified provider evidence into a state change:
          1. amount/currency match Payment's own authoritative values?
             no → UNKNOWN + PAYMENT_FINANCIAL_INTEGRITY_ERROR, no capture
          2. providerOrderId matches this Payment's own?
             no → refuse the linkage entirely
          3. canTransitionPaymentState(current, candidate)?
             no → PAYMENT_STATE_TRANSITION_REJECTED, no-op (stale/out-of-
             order events can never regress CAPTURED)
          4. CAPTURED → Order PAID, CheckoutSession COMPLETED, ledger
             PAYMENT_CAPTURED (first point revenue is legitimately OBSERVED)
          5. FAILED → Order FAILED, CheckoutSession FAILED, normalized
             failureCategory, ledger PAYMENT_FAILED, recoveryStatus:
             NOT_EVALUATED (PART 08 owns recovery, not this part)
```

**`PaymentGateway`** (`apps/api/src/modules/payments/gateway.ts`) is the
provider-independent boundary: `createPaymentOrder`, `fetchPayment`,
`verifyClientCompletion`, `verifyWebhookSignature`, `getPublicConfig`.
`RazorpayPaymentGateway` uses the global `fetch` (no SDK dependency) with
Basic Auth, `payment_capture: 1` at order creation (auto-capture — this
build never implements a separate manual capture API call), and
normalizes every failure into a closed `ProviderGatewayError` category.
`MockPaymentGateway` implements the identical interface for the
automated test suite, using the SAME real HMAC signature functions
(`razorpay-signature.ts`) against a fixed test secret — signature tests
exercise the actual algorithm, never a stub. A factory
(`gateway-factory.ts`) always returns the mock under `NODE_ENV=test`,
the real adapter when fully configured, `null` otherwise — every payment
route checks for `null` and returns `503 PAYMENT_NOT_CONFIGURED`, so the
rest of the application stays usable without any Razorpay credentials.

**The payment state machine was extended, not invented new.** PART 01's
`@razorgrowth/domain` `payment-state.ts` is reused verbatim except for
one deliberate addition discovered while building the real integration:
`CREATED → CAPTURED` is now legal directly, because Razorpay Test Mode's
auto-capture can report `captured` without a separate discrete
`authorized` event ever being guaranteed first. This is a real
architectural correction (the prior test asserted the opposite), not a
weakened check — every other illegal transition, and CAPTURED's
terminal status, are unchanged.

**One payment attempt per checkout, by design.** `Payment.checkoutId` is
unique at the database level — this build never creates a second
`Payment` for a checkout that already has one, whether it succeeded,
failed, or is stuck `UNKNOWN`. This matches the master contract's own
worked recovery example: recovering from a failed payment is a brand-new
Merchant Agent `RECOVERY` proposal → policy → a NEW
`ExecutionAuthorization` → a NEW `CheckoutSession` → a NEW `Payment`
(PART 08), never a mutation of the failed one. `attemptNumber` exists on
`Payment` (always `1` in this build) so a future part could relax this
without a schema migration, but nothing in PART 07 needs it to.

**Idempotent webhook processing without depending on the database's
error shape.** Duplicate detection is check-then-insert on a
deterministic `eventFingerprint`
(`SHA256(provider|eventType|paymentId|orderId|payloadHash)` — Razorpay
does not guarantee a stable top-level event ID on every delivery),
verified with a real `findFirst` before ever attempting to persist a new
`PaymentProviderEvent` row. The `@@unique([provider, eventFingerprint])`
database constraint remains as defense-in-depth for a genuine race on
real Postgres; it is not the primary mechanism, because the local PGlite
dev database was observed to surface a real unique-constraint violation
as a garbled "unexpected message from server" rather than a parseable
`P2002` — the same class of wire-protocol quirk previously documented
for an FK-RESTRICT violation in PART 06's seed script.

**PART 07 stops at a verified `CAPTURED`/`FAILED` payment.** No refund
flow, no AI-driven recovery decision, no second payment attempt — a
`FAILED` payment's `recoveryStatus: "NOT_EVALUATED"` and normalized
`failureCategory` are the exact, deliberate handoff to PART 08.

## Failure-First Recovery architecture (PART 08)

```
Payment (FAILED, verified — from PART 07)
   ↓
POST /payments/recovery/evaluate  { paymentId }
   ↓ if payment.state === UNKNOWN: reconcile with the provider FIRST
   ↓   (PaymentService.reconcilePayment, PART 07, unmodified) — never
   ↓   evaluate eligibility against a state that might already be stale
   ↓
evaluateRecoveryEligibility() (@razorgrowth/domain, pure, zero-AI)
   ↓ order already PAID/CANCELLED? prior payment already CAPTURED
   ↓   (integrity concern)? attempt count >= maxRecoveryAttempts (the
   ↓   SAME count the Policy Engine will independently re-check)?
   ↓   failure category not in the small retryable set?
   ↓
 NOT_ELIGIBLE / RECONCILIATION_REQUIRED ──┐         ELIGIBLE
   ↓                                       │           ↓
persist GrowthActionProposal        AIProvider.proposeRecoveryAction()
(status REJECTED_VALIDATION,        (real call, normalized safe facts
rejectionReason = the                only — failure category, attempt
deterministic explanation,           number/limit, order amount/
NO retry button in the UI)           currency, closed allowed-action set)
                                            ↓
                                     validateRecoveryProposal() — grounds
                                     the model's choice against the
                                     eligibility-computed allowed set;
                                     unsupported/hallucinated/AI-
                                     unavailable → deterministic fallback
                                     (RETRY_SAME_CHECKOUT, the only safe
                                     answer when ELIGIBLE)
                                            ↓
                                     persist GrowthActionProposal
                                     (actionType: RECOVERY, recoveryAction,
                                     sourceOrderId/sourcePaymentId/
                                     sourceCheckoutId, traceId = the
                                     ORIGINAL workflowId — continuing the
                                     SAME ledger chain, never a fresh one)
                                            ↓
                              POST /policy/evaluate   (UNCHANGED — PART 05)
                                            ↓
                              ALLOW | REQUIRE_APPROVAL | DENY
                                            ↓ (approve if required)
                              ExecutionAuthorization   (UNCHANGED — PART 05)
                                            ↓
                    POST /payments/recovery/:authorizationId/execute
                                     { idempotencyKey }
                                            ↓
                    PaymentRecoveryExecutionService — re-verifies (defense
                    in depth, immediately before executing):
                      • order's own financial fingerprint still matches
                        its persisted line items (tamper detection)
                      • order is still FAILED, source payment still FAILED
                      • recovery-attempt count still under the limit
                                            ↓
                    ONE transaction: consume authorization (atomic,
                    one-time) → create a NEW CheckoutSession against the
                    SAME Order/Cart → Order FAILED -> PAYMENT_PENDING
                    (a new, narrow, authorization-gated exception)
                                            ↓
                              { checkoutId }
                                            ↓
                    POST /payments/initiate  { checkoutId }   (UNCHANGED —
                    PART 07; attemptNumber/recoveredFromAttemptId computed
                    generically from prior Payment rows sharing this
                    orderId — initiatePayment has no idea this is a retry)
                                            ↓
                              Razorpay Test Mode → verified CAPTURE
                                            ↓
                              Order PAID · Observed recovered order value
                                            ↓
                              Agent Action Ledger (one continuous,
                              hash-verified chain from the ORIGINAL
                              proposal through the failure through the
                              recovered capture)
```

**`RecoveryEligibilityEngine`** (`packages/domain/src/recovery.ts`, pure)
is a genuinely separate concern from the Policy Engine's own
`RECOVERY_LIMIT_EXCEEDED` check (PART 05) — attempt-count enforcement is
SHARED (both read the same count, generalized to group by either
`recommendationId` for PART 04's buyer-budget recovery or
`sourceOrderId` for this part's payment-failure recovery), but only this
engine knows anything about payment/order state at all; the Policy
Engine still knows nothing about payments.

**Recovery reuses `GrowthActionProposal`, never a parallel proposal
system.** Setting the recovery proposal's `opportunity` JSON to
`{currentBasketMinor: orderTotal, potentialBasketMinor: orderTotal,
opportunityDeltaMinor: 0}` (since `RETRY_SAME_CHECKOUT` never changes
the amount) means the EXISTING, completely unmodified Policy Engine
order-amount tiers apply automatically — recovering a large order still
correctly requires approval under the same thresholds as any other
proposal, with zero special-casing added to `evaluatePolicy` itself.

**One order, multiple checkout/payment attempts — a real, deliberate
revision of PART 07's original assumption.** `CheckoutSession.orderId`
is no longer unique: a bounded recovery retry creates a NEW
`CheckoutSession` (and, via PART 07's unmodified `initiatePayment`, a
NEW `Payment`) against the SAME immutable `Order`/`Cart` — never a
second `Order`. This is narrower and more precise than introducing a
separate `PaymentAttempt` entity would have been: `Payment.checkoutId`
is still unique (literally "one payment attempt per checkout," PART 07's
own invariant, unchanged), and `initiatePayment` needed ZERO code
changes — it already only asks "does a Payment exist for this
checkoutId," and a recovery checkout is, from its perspective,
indistinguishable from any other checkout that has never had a payment.
`attemptNumber`/`recoveredFromAttemptId` are computed generically from
prior `Payment` rows sharing an `orderId`, inside `createPayment` itself.

**`PaymentRecoveryExecutionService` is the ONLY place a recovery
`ExecutionAuthorization` becomes a real new attempt** — reusing PART 05's
authorization/proposal validation and PART 06's order-fingerprint
convention, never a second authorization or commerce-execution system.
Idempotent (`{ idempotencyKey }` only — no amount/currency/attempt
number) and concurrency-safe via the SAME atomic
`updateMany WHERE status = 'ACTIVE'` consumption pattern PART 06
established.

**PART 08 stops at a verified recovered `CAPTURED`/permanently `FAILED`
attempt.** No second recovery attempt beyond `maxRecoveryAttempts`, no
refund flow, no recovery action beyond `RETRY_SAME_CHECKOUT` — the
recovery-action taxonomy and the Merchant Agent proposal machinery are
built generically enough that adding more later needs no re-plumbing of
the AI call, grounding, or fallback path, but none of that is built now
because nothing in this demo needs it yet.

## What's deliberately not here yet

No refund flow, no chargeback handling, and no second recovery attempt
beyond `MerchantPolicy.maxRecoveryAttempts` anywhere in this codebase.
No recovery action beyond `RETRY_SAME_CHECKOUT` — the taxonomy and the
Merchant Agent proposal machinery are built generically enough to add
more without re-plumbing the AI call, but nothing in this demo needs a
second one yet. No third AI actor anywhere in the commerce, payment, or
recovery path (`grep -rli "anthropic\|AIProvider"
apps/api/src/modules/commerce/ apps/api/src/modules/payments/` returns
nothing), and no full tax/shipping/warehouse-reservation platform.

Authentication and protocol integration DO now exist, and the sentence
that used to deny both was left behind by the Vaanigam work rather than
being true:

- Merchant users authenticate with opaque server-side sessions and are
  role-scoped (OWNER/APPROVER/VIEWER); buyer agents authenticate to the
  ACP surface with merchant-issued credentials.
- ACP is implemented against the published spec (signed/versioned sessions,
  idempotency, scoped `delegate_payment`). AP2 is a compatibility shim and is
  labelled as such. x402 v2 verifies and settles through a configured
  facilitator, binds evidence to the issued quote, and rejects nonce replay;
  without complete facilitator/asset/payee configuration it fails closed. No
  scheduled job proactively
expires stale approvals/authorizations/checkout sessions; expiry is
checked lazily, exactly when the relevant action is attempted, which is
correct for this demo's scale (see the README's Limitations section). No
mutation endpoint moves real money, changes a price, or mutates
inventory outside a verified payment capture — policy evaluation,
approval decisions, authorization issuance, commerce execution, payment
initiation/verification, and recovery evaluation/execution are all
governance/fulfillment decisions gated on a PROPOSAL or a verified
provider fact, never an unverified side effect. No live Razorpay Test
Mode credentials are configured in this environment, so both the real
`RazorpayPaymentGateway` adapter and the full failure-to-recovery-to-
capture path have been verified by integration test suites against a
deterministic provider double, never by an actual live transaction —
see the README's Limitations section and `PROGRESS.md`
for exactly what that does and doesn't prove. See the README's "Current
implementation status" and `PROGRESS.md` for what's next.
