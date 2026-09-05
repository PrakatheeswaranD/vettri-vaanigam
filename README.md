# Vettri Vaanigam

### The gate an AI buyer has to get through to spend money at a Razorpay merchant

[![CI](https://github.com/PrakatheeswaranD/vettri-vaanigam/actions/workflows/ci.yml/badge.svg)](https://github.com/PrakatheeswaranD/vettri-vaanigam/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-24-brightgreen.svg)](package.json)
[![Razorpay](https://img.shields.io/badge/Razorpay-Test%20Mode-002970.svg)](docs/evidence/razorpay-testmode-proof.json)

**Every agentic commerce protocol — ACP, AP2, UAP, UCP, x402 — states a price on the wire. A merchant who believes that number has handed pricing authority to a stranger's language model.**

Vettri Vaanigam is the gate that doesn't believe it. One endpoint any AI buyer agent can reach in any of those dialects, which **re-prices the basket from the merchant's own catalogue**, verifies a signed spend mandate, scores the agent against its own history, and answers `AUTO_APPROVE` / `STEP_UP` / `DECLINE` — writing a plain-English decision record on every path, including requests it could not parse.

> **The model proposes. Deterministic code prices, authorizes and executes. Razorpay decides whether money actually moved.**

---

## Track 01 — how this maps

**Track:** AI Growth & Agentic Commerce · *"Grow the merchant's revenue, and make them sellable to AI buyers."*

This project takes **direction B — make a merchant transactable by an AI buyer end to end** — and treats it as a merchant-side infrastructure problem rather than a shopping-assistant problem. The growth surface exists, but it is the second act; the gate is the product.

### The bar

> *"Every money action explainable, bounded and gated. Show the audit trail and one failure handled gracefully."*

| Requirement | How it is met | Where |
|---|---|---|
| **Explainable** | Every decision writes a plain-English `conciseReason` plus reason codes — refusals included | [`gateway/service.ts`](apps/api/src/modules/gateway/service.ts) |
| **Bounded** | Policy ceilings, mandate amount limits, discount clamps, floor margin, hard maximum | [`packages/domain/`](packages/domain/src) |
| **Gated** | A policy decision is required before execution; external-agent step-up waits for an authenticated owner or approver | [`policy-engine.ts`](packages/domain/src/policy-engine.ts) |
| **Audit trail** | Per-workflow SHA-256 hash chain, single writer, intent → payment on one `workflowId` | [`audit/ledger.ts`](apps/api/src/modules/audit/ledger.ts) |
| **One failure, gracefully** | A real Razorpay `401` classified into a closed taxonomy; a stale authorization refused with `PRICE_CHANGED` | [evidence ↓](#evidence-you-can-check-yourself) |

### Why now

NPCI's UAP and the protocol race (ACP, AP2, x402) make agent-to-agent commerce an open problem, and Razorpay's in-app pilots are already live. The unanswered question is not *"can an agent talk to a merchant"* — it is **"what stops one spending money it shouldn't."** No individual merchant should implement mandate verification, protocol adapters and agent trust scoring. That belongs where the payment rails already are.

### Evaluation criteria

| Criterion | Short answer |
|---|---|
| **Problem taste** | Pricing authority leaking to an untrusted caller is a real, per-request commerce failure — not a chatbot demo |
| **Build quality** | Automated CI, isolated API regression tests, a pure dependency-free domain layer, documented boundaries |
| **AI judgment** | 7 narrow AI operations, all proposal-shaped and validated. Authorization is deterministic; optional upsell proposals can call a model |
| **Failure recovery** | [A 1,085-line problems log](docs/TRACK01_PROBLEMS_LOG.md) of what broke and what was done — including the unflattering entries |

---

## Architecture

![Vettri Vaanigam architecture: six layers covering buyer and merchant entry points, API validation, agent intelligence, deterministic authorization, verified Razorpay commerce, and PostgreSQL persistence.](docs/images/architecture-detailed.png)

[**Full architecture** — invariants, threat model, state machines](docs/ARCHITECTURE.md) · [Scalable SVG](docs/images/architecture-detailed.svg) · [Agent-facing OpenAPI](docs/openapi/agent-commerce.openapi.json)

### The request path an external agent actually takes

Order of operations *is* the design — each step runs only because the previous one succeeded:

```
detect protocol (explicit markers only, else UNKNOWN)
  → adapter parses into one canonical ParsedIntent
  → resolve SKUs against the catalogue
  → REPRICE THE BASKET FROM CATALOGUE ROWS      ← the load-bearing step
  → verify Ed25519 spend mandate (12 checks)
  → compute adaptive agent trust
  → evaluate merchant policy
  → AUTO_APPROVE | STEP_UP | DECLINE
  → execute: re-fetch variants, guarded stock decrement, Razorpay order
  → append to the hash-chained ledger
```

Repricing happens **before** mandate verification and **before** policy on purpose: both ceilings must be evaluated against *our* number. Verifying a mandate against a price the caller supplied would make the signature meaningless.

---

## Where AI is used — and where it deliberately is not

Razorpay asks for *"the right tool in the right place, and where you chose not to use one."*

| Concern | AI? | Why |
|---|---|---|
| Understanding buyer language | **Yes** | Open vocabulary; grounded against real merchant categories so it cannot invent a taxonomy |
| Ranking a pre-filtered candidate set | **Yes** | Bounded set; falls back to deterministic ordering on any failure |
| Normalising messy catalogue text | **Yes** | The job LLMs are genuinely best at |
| Drafting a policy from a sentence | **Yes** | Draft only — a human approves it |
| Proposing a growth action | **Yes** | From a bounded candidate list, then validated |
| **Pricing** | **Never** | Catalogue rows only |
| **Authorization & policy** | **Never** | Pure domain code, no I/O, exhaustively tested |
| **Mandate verification** | **Never** | Cryptography, not judgment |
| **Agent trust scoring** | **Never** | Deterministic arithmetic over existing decision records |
| **Discounts & negotiation** | **Mixed** | Buyer negotiation is deterministic; the gateway can use bounded AI upsell proposals, with fresh final-basket authorization |
| **Protocol parsing** | **Never** | An LLM reading payment amounts is the nightmare case |

The authorization decision uses deterministic code. After the original basket passes, the optional negotiator may call a model to propose additional SKUs and a discount. Code grounds the SKUs, clamps the discount, and rejects margin breaches. If the offer is accepted, its final amount, categories and current merchant policy are checked again before execution. Rail-specific approvals require a new intent for a changed basket.

Growth-proposal validators reject invalid outputs. The optional gateway negotiator instead records both the raw proposal and its bounded result; these are different validation contracts.

## Money safety

Every money action, traced:

| Money action | AI proposes? | Validation | Policy gate | Audit |
|---|---|---|---|---|
| Buyer purchase proposal | No | Price from catalogue row | Category, daily, max-purchase, autonomous limit | Ledger + DecisionRecord |
| Buyer authorization | No | Re-checks category, currency, ceiling | Cumulative daily reservation inside the transaction | Ledger |
| External agent purchase | No | Variant re-fetch → `PRICE_CHANGED`, `FINANCIAL_INTEGRITY_ERROR` | Gateway policy + Ed25519 mandate | Ledger + order fingerprint |
| Discount / negotiation | Optional gateway AI proposal | Grounded SKUs, bounded discount, floor margin | Fresh final-basket mandate and merchant-policy checks | Raw proposal + bounded result + ledger |
| Growth offer | **Yes** | `validateGrowthProposal` — rejects, never clamps | Allowed action types, discount cap, buyer budget | Ledger |
| Razorpay order | No | Server-computed total only | Payment state machine | Ledger + provider order |
| Payment confirmation | No | HMAC-SHA256, constant-time compare | Transition guard | Ledger |

**Models cannot set policy limits or grant authorization. An optional model-proposed discount can influence the final price only through deterministic bounds and a fresh authorization check.**

### The gate, fired three times

Against the seeded ₹3,489 shoe, all three outcomes are reachable on demand:

| Quantity | Total | Outcome | Why |
|---|---|---|---|
| 1 | ₹3,489 | `AUTO_APPROVE` | under the ₹5,000 autonomous limit |
| 3 | ₹10,467 | `STEP_UP` | over it — the buyer is **asked** |
| 8 | ₹27,912 | `DECLINE` | over the ₹25,000 hard ceiling — the buyer is **refused** |

Two thresholds, not one: *"how much may the agent spend without me"* and *"how much am I willing to spend at all"* are different questions. A purchase over the hard maximum is never offered for approval, because approving it was never on the table.

---

## Audit trail

```
buyer intent → AI interpretation → proposal → validation → policy decision
  → execution → provider result → chained ledger event
```

`eventHash = SHA256(canonical(event) + previousEventHash)`, scoped per `workflowId`, written by exactly one function. The conversation and the purchase share one `workflowId`, so *"you recommended this"* and *"you charged me for it"* are links in one verifiable chain.

Honest limits: this is application-level tamper **evidence**, not a blockchain, and it deliberately excludes prompts and model responses — you can audit what was decided, not what the model was shown.

---

## Evidence you can check yourself

| Claim | How to verify |
|---|---|
| It builds and passes | [CI](https://github.com/PrakatheeswaranD/vettri-vaanigam/actions/workflows/ci.yml) — typecheck, lint, migrate, seed, test, build, evals |
| Regression suites | `pnpm test:isolated`, `pnpm --filter @razorgrowth/web test`, and `pnpm --filter @razorgrowth/domain test` |
| It really talks to Razorpay | [`docs/evidence/razorpay-testmode-proof.json`](docs/evidence/razorpay-testmode-proof.json) — real order, live 401 classified, HMAC schemes verified |
| Agents cannot cheat it | `pnpm redteam` — 6 attacks with real Ed25519 signatures, asserts on server responses, exits non-zero on regression |
| Failures are handled | [Problems log](docs/TRACK01_PROBLEMS_LOG.md) — 1,085 lines |

### Razorpay Test Mode proof

```sh
pnpm --filter @razorgrowth/api razorpay:proof
```

Drives the same `RazorpayPaymentGateway` the application uses against live Test Mode. It creates a real provider order, confirms Razorpay echoes the server-computed amount unchanged, exercises the reconciliation read-back that resolves an `UNKNOWN` payment, and confirms a real Razorpay `401` surfaces as a classified `PROVIDER_AUTHENTICATION_ERROR` rather than a leaked HTTP status. It refuses to run against an `rzp_live_` key.

**What it does not claim:** that a payment was captured. Completing a checkout needs a human at Razorpay's hosted checkout with a test card, so the script creates a real payment link and reports it as an outstanding manual step rather than implying settlement.

### Break the agent

The in-app sandbox runs 9 attack presets through the **production verifier**, not a simulation — a real Ed25519 keypair signs a real mandate, and the same code path that serves live requests refuses the tampered one. If a guarantee regressed, the preset would report success and say so.

---

## Quick start

Requires **Node 24** and the pnpm version in `package.json`. Run from the repository root.

```sh
pnpm install --frozen-lockfile
cp .env.example .env          # PowerShell: Copy-Item .env.example .env
```

Replace the two signing-secret placeholders with distinct random values. Leave payment and AI keys unset for the offline demo.

**Start the database.** With Docker (recommended):

```sh
docker compose up -d db
```

Then point `DATABASE_URL`  at `postgresql://razorgrowth:razorgrowth@127.0.0.1:5433/razorgrowth`.

<details>
<summary>No Docker? Use the bundled PGlite shim — and its caveats</summary>

```sh
pnpm db:up
```

`pnpm db:up` runs Postgres compiled to WebAssembly so this project can run on a machine with no Docker and no install rights. It works, but it is the least reliable component here: it can wedge while still holding port 5432 — so the port reports open while queries hang — and it has corrupted its own data directory more than once. If that happens, stop the process, delete `.dbdata`, and repeat. See [`docker-compose.yml`](docker-compose.yml) for the full rationale.
</details>

**Then, in another terminal:**

```sh
pnpm db:migrate
pnpm db:seed
pnpm db:identities
pnpm dev
```

Frontend at `http://localhost:5173`, API at `http://localhost:4000/api/v1`.

Follow the [**five-minute demo script**](docs/DEMO.md) from here.

### Demo accounts

Deliberately public fixtures, **not real accounts**. Do not expose a seeded instance to the internet.

| Role | Email | Password |
|---|---|---|
| Merchant owner | `owner@meridianathletics.demo` | `MeridianDemo!2026` |
| Buyer | `customer@vettrivaanigam.demo` | `CustomerDemo!2026` |
| Platform admin | `admin@vettrivaanigam.demo` | `AdminDemo!2026` |

### Verify

```sh
pnpm typecheck && pnpm lint && pnpm test:isolated && pnpm --filter @razorgrowth/web test && pnpm --filter @razorgrowth/domain test && pnpm build
```

Tests run in a freshly seeded disposable database with `pnpm test:isolated`. Direct `pnpm test` requires an explicit local `TEST_DATABASE_URL` distinct from the application database. The suite refuses a shared database before touching rows.

### Optional live AI

Defaults to a labelled deterministic provider so everything runs without a key. Set `AI_PROVIDER=anthropic` or `gemini` with the matching key for the live path; the mode is shown in the UI rather than implied. Keys stay server-side — never in a `VITE_*` variable.

---

## What is deliberately not built

Named here so a reviewer does not have to discover it:

- **Delivery adapters for the weekly growth plan.** Snapshots, approvals and job records persist; email, WhatsApp, SMS, push and Buyer Agent hand-off do not exist. A queued message is not a delivered message. The surface is hidden behind `VITE_ENABLE_WEEKLY_PLAN`.
- **Causal revenue attribution.** Holdout comparisons are estimates. Missing cost data is not profit.
- **Deep AP2 / UAP / UCP implementations.** ACP and x402 are implemented; the others are adapters and conformance fixtures — implementation surfaces, not protocol certification.
- **Production key management, background job recovery, distributed tracing.**

The alternative — a designed extension presented as a finished system — is the specific failure this project is built to avoid.

---

## Repository structure

```text
apps/
  api/                 Fastify routes, services, Prisma schema and migrations
  web/                 Buyer, merchant, and administration interfaces
packages/
  domain/              Business rules and deterministic calculations — no I/O, no AI
  contracts/           Shared validation schemas and DTOs
docs/
  ARCHITECTURE.md      Invariants, threat model, state machines
  DEMO.md              Five-minute review script
  TRACK01_PROBLEMS_LOG.md   What broke, and what was done about it
  evidence/            Razorpay Test Mode proof output
  openapi/             Agent-facing API specification
scripts/               Local database and demonstration tooling
evals/                 AI evaluation fixtures
```

`packages/domain/` is the layer to read first. It holds the policy engine, mandate verification, trust scoring, payment state machine and money arithmetic, with a test file beside almost every module, and depends on nothing.

---

## Technology

React 18 · TypeScript · Vite · Tailwind · TanStack Query · Fastify · Zod · Prisma · PostgreSQL · Vitest · GitHub Actions

---

> **Independent demonstration project** built for a Razorpay internship submission. Not an official Razorpay product and not a production-readiness claim. Razorpay **Test Mode** only.

## License

[MIT](LICENSE)
