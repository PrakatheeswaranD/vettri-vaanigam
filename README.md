# VETTRI VAANIGAM

### Governed agentic commerce for merchants and AI buyers

**Any AI agent can now try to buy from a merchant. This is the gate it has to get through.**

A merchant-side gateway that makes a Razorpay merchant transactable by an AI buyer — with every money action explainable, bounded and gated. The model proposes; deterministic code prices, authorizes and executes; Razorpay is the authority on whether money actually moved.

A buyer describes what they need. VETTRI VAANIGAM helps discover products, evaluates merchant offers, checks purchase permissions, and prepares checkout. The merchant sees opportunities, controls the agent's boundaries, and follows decisions through an auditable transaction trail.

Two documents are worth reading before the code: the [five-minute demo script](docs/DEMO.md), and [the problems log](docs/TRACK01_PROBLEMS_LOG.md) — a running record of what broke during the build and what was done about it, including the entries that are unflattering:

- *P3-2 · Acted on 1 of 80 payments and reported the cycle complete*
- *P0-4 · `GET /buyer/standing` defaulted the seller to the buyer*
- *P3-6 · The first test run passed vacuously*

---

> **Independent demonstration project** prepared for a Razorpay internship submission. Not an official Razorpay product or a production-readiness claim. Use Razorpay **Test Mode** only for evaluation.

## Architecture

![VETTRI VAANIGAM architecture: six layers explain buyer and merchant entry points, API validation, agent intelligence, deterministic authorization, verified Razorpay commerce, and PostgreSQL persistence.](docs/images/architecture-detailed.png)

[Architecture details and trust boundaries](docs/ARCHITECTURE.md) · [Scalable SVG](docs/images/architecture-detailed.svg) · [Simple overview](docs/images/architecture.png) · [Agent-facing API specification](docs/openapi/agent-commerce.openapi.json)

## What the project demonstrates

- **Buyer Agent:** conversational product discovery, comparison, recommendation, and policy-bound checkout. A deterministic demo mode works without a paid AI key.
- **Merchant Agent:** opportunity detection, governed proposals, approvals, growth controls, campaign comparisons, and ledger-backed activity.
- **Merchant experience:** Merchant Today, an attention inbox, opportunities, customers and orders, agent controls, and activity, with technical configuration under advanced navigation.
- **Commerce and Razorpay:** server-calculated checkout, idempotent execution, payment verification, signed webhooks, and reconciliation for uncertain payment states.
- **Agent-facing integration:** gateway policy checks, AI-readable catalogue, ACP routes, AP2 compatibility fixtures, and configuration-dependent x402 settlement paths. These are implementation surfaces, not universal protocol certification.
- **Safety:** tenant scoping, role checks, bounded execution authorizations, consent/contact checks for message drafts, and a hash-chained application audit ledger.

### Implementation boundaries

The buyer/checkout/payment and existing governed-action flows have automated integration coverage. The newer weekly-growth-plan layer is **partially implemented**:

- Weekly snapshots and approvals persist; regeneration preserves the original snapshot.
- Contact-limited message drafts and retryable job records exist.
- Email, WhatsApp, SMS, push, and Buyer Agent delivery adapters are **not yet integrated**. A queued message is not a delivered message.
- Unsupported weekly-plan action types remain blocked. A weekly approval does not bypass per-action governance or spend money.
- End-to-end portfolio budget reservations, background job recovery, and statistically validated incremental-profit reporting remain future work.
- Holdout comparisons are estimates, not proof that the agent caused revenue. Missing cost data is not profit.

See the [demo walkthrough](docs/DEMO.md) for a reproducible review path.

## Technology

- Frontend: React 18, TypeScript, Vite, Tailwind CSS, TanStack Query.
- API: Fastify, TypeScript, Zod, Prisma.
- Data: PostgreSQL; a local PGlite server is supplied for development.
- Shared packages: domain rules and API contracts.
- Verification: Vitest, Testing Library, ESLint, TypeScript checks, GitHub Actions.

## Run locally

Use **Node.js 24** and the pnpm version declared in `package.json`. Run commands from the repository root.

1. Clone this repository and install dependencies:

   ```sh
   pnpm install --frozen-lockfile
   ```

2. Copy `.env.example` to `.env`. On PowerShell:

   ```powershell
   Copy-Item .env.example .env
   ```

   On macOS/Linux, use `cp .env.example .env`. Do not overwrite an existing configured `.env`. Keep `DATABASE_URL` and `DIRECT_URL` pointed at the local database for this walkthrough. Replace the two signing-secret placeholders with distinct random values. Keep payment and AI keys unset for the offline demo.

3. Start the local database in a separate terminal and leave it running:

   ```sh
   pnpm db:up
   ```

   **If you have Docker, prefer real Postgres instead** — it is the more reliable path:

   ```sh
   docker compose up -d db
   ```

   Then point `DATABASE_URL` and `TEST_DATABASE_URL` at `postgresql://razorgrowth:razorgrowth@127.0.0.1:5433/razorgrowth` and skip `pnpm db:up` entirely. `pnpm db:up` runs a PGlite socket shim (Postgres compiled to WebAssembly) that exists so this project can run on a machine with no Docker and no install rights. It works, but it is the least reliable component here: it can wedge while still holding port 5432 — so the port reports open while queries hang — and it has corrupted its own data directory more than once. If that happens, stop the process, delete `.dbdata`, and repeat steps 3 and 4. See [`docker-compose.yml`](docker-compose.yml) for the rationale.

4. In another terminal, create the schema and **local demo data**:

   ```sh
   pnpm db:generate
   pnpm db:migrate
   pnpm db:seed
   pnpm db:identities
   pnpm dev
   ```

   Seeding writes demo records. Never run it against a production or shared database. The local database uses port 5432; stop a conflicting local service or configure a different database before starting.

5. Open the frontend at `http://localhost:5173`. The API runs at `http://localhost:4000/api/v1`.

### Local demonstration accounts

These credentials are deliberately public fixtures, **not real accounts**. Do not expose a seeded instance to the public internet.

- Merchant owner: `owner@meridianathletics.demo` / `MeridianDemo!2026`
- Buyer: `customer@vettrivaanigam.demo` / `CustomerDemo!2026`
- Platform admin: `admin@vettrivaanigam.demo` / `AdminDemo!2026`

### Optional Razorpay Test Mode

Set all three values in the untracked `.env`: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and `RAZORPAY_WEBHOOK_SECRET`. A partial configuration is rejected. Configure a reachable test webhook endpoint ending in `/api/v1/payments/webhooks/razorpay` with the matching webhook secret.

Without these values, product discovery and checkout preparation remain available, but real provider payment initiation fails closed. Automated tests use a mock payment gateway; they do not prove that live Test Mode credentials or webhook delivery are configured.

To prove the Razorpay side specifically, run:

```sh
pnpm --filter @razorgrowth/api razorpay:proof
```

This exercises the same `RazorpayPaymentGateway` the application uses against live Test Mode and writes [`docs/evidence/razorpay-testmode-proof.json`](docs/evidence/razorpay-testmode-proof.json). It creates a real provider order, confirms Razorpay echoes the server-computed amount unchanged, runs the reconciliation read-back, and checks that a real Razorpay `401` surfaces as a classified `PROVIDER_AUTHENTICATION_ERROR` rather than a leaked HTTP status. It refuses to run against an `rzp_live_` key.

What it deliberately does **not** claim: that a payment was captured. Completing a checkout needs a human at Razorpay's hosted checkout with a test card, so the script creates a real payment link and reports it as an outstanding manual step instead of implying a settlement.

### Optional live AI

The default setup has a labeled rule-based fallback. Provider selection and optional Anthropic/Gemini settings are validated in `apps/api/src/config/env.ts`. Keep API keys server-side; never place them in a `VITE_*` variable.

## Verify

Prepare and seed a **dedicated local database** first. Tests mutate demo records and should not run against a database used for an active demonstration. Set `TEST_DATABASE_URL` and `TEST_DIRECT_URL` to that local database if your application uses another database.

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Focused weekly-plan safeguards:

```sh
pnpm --filter @razorgrowth/api test src/growth-plans.test.ts
```

Recent local verification: the 538-test API suite passed in full (54 files), and the 72-test frontend suite passed. Typecheck and the production build passed. These are local results, not a claim that GitHub CI or a production deployment has passed. CI is defined in [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

**Re-run `pnpm db:identities` after `pnpm test`.** Several integration tests raise the demo shopper's spending limits to the schema maximum to exercise large-basket paths, and do not restore them. Left that way, the step-up gate — the control the whole demo turns on — silently never fires, and a reviewer sees a six-figure purchase auto-approve. `pnpm db:identities` restores the fixture limits (₹5,000 autonomous, ₹25,000 hard ceiling) so all three outcomes are reachable again:

| Quantity of the seeded ₹3,489 shoe | Total | Outcome |
|---|---|---|
| 1 | ₹3,489 | `AUTO_APPROVE` |
| 3 | ₹10,467 | `STEP_UP` |
| 8 | ₹27,912 | `DECLINE` |

## Repository structure

```text
apps/
  api/                 Fastify routes, services, Prisma schema and migrations
  web/                 Buyer, merchant, and administration interfaces
packages/
  domain/              Business rules and deterministic calculations
  contracts/           Shared validation schemas and DTOs
  config/              Shared tooling configuration
docs/
  images/              Architecture image
  openapi/             Agent-facing API specification
  conformance/         Protocol fixtures
scripts/               Local database and demonstration tooling
evals/                 AI evaluation fixtures
.github/workflows/     Continuous integration
```

## Design decisions

**The model proposes; the server authorizes.** Prices, stock checks, discount ceilings, and permission checks are not delegated to free-form model output.

**Authorization is not execution; execution is not payment.** Each transition has its own records and checks. Payment success requires verified provider evidence.

**Unknown stays unknown.** An uncertain payment is reconciled; an unsupported action is blocked; a draft is not reported as sent.

**The ledger provides tamper evidence, not immutability.** Its hash chain helps detect changes but is not a blockchain or a substitute for database access control.

## Submission and security notes

The product is **Vettri Vaanigam**. Machine-readable API extensions use `vettri_vaanigam` and mandates use `vettri_vaanigam_mandate`. Legacy mandate input names and stored browser preferences remain readable for compatibility. Historical migration files are preserved; a new migration updates existing demo login addresses without replacing accounts.

Do not upload `.env`, local databases, session data, API keys, `node_modules`, or build output. `.gitignore` excludes these working files, but it does not remove them from old Git commits. Older local development history contained database files: publish a reviewed source-only snapshot rather than pushing that history unchanged.

Keep any hosted demo private until public fixture accounts are removed, secrets are provisioned securely, and deployment controls have been reviewed. Detailed development notes under `docs/TRACK01_*` are historical records; this README describes the current submission scope.
