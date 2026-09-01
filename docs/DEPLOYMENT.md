# Deployment — from local demo to a real deployment

This is the checklist for the six things that must be provisioned before
Vaanigam can run outside a laptop. Items 1, 2, 3 and 6 need your
accounts and payment method; the scaffolding for all of them is already
in the repository.

**Honest status:** the application has never been run against live
Razorpay or a managed Postgres. Everything below is prepared and
type-checked, but "prepared" is not "verified" — the verification steps
in each section are the point.

---

## 1. Real Postgres

The local `pnpm db:up` database is **PGlite**, a dev shim. It degrades
under sustained load (observed repeatedly during development) and is not
something to run a business on. Any managed Postgres 14+ works — no code
changes, only `DATABASE_URL`.

**Validate the migrations against real Postgres locally first** (free,
five minutes, catches problems before you pay for anything):

```bash
docker compose up --build postgres api
```

That starts real Postgres 16 and runs `prisma migrate deploy` against it
on API start. If the API container comes up healthy, your schema is
portable.

Then point at a managed instance:

```
DATABASE_URL=postgresql://USER:PASS@HOST:5432/DB?sslmode=require
```

If your provider uses a transaction pooler (Neon pooled endpoint,
Supabase pgbouncer, RDS Proxy), keep `?pgbouncer=true&connection_limit=N`
— Prisma must skip named prepared statements through a pooler.

### Lessons from the actual Supabase bring-up

These were found by doing it, not by reading docs:

- **Two URLs are required, not one.** `DATABASE_URL` points at the
  transaction pooler (Supabase port `6543`); `DIRECT_URL` points at the
  session endpoint (`5432`). Migrations need session-level advisory locks
  a transaction pooler cannot provide, so `prisma migrate deploy` fails
  against the pooled URL. The schema declares `directUrl` for this.
- **`connection_limit=5` is too low.** The Overview page fans out to ~10
  parallel API calls, each running several queries. At a limit of 5 the
  surplus queued behind the cold TLS + pooler handshake and exceeded
  Prisma's default 10s pool timeout, surfacing as intermittent 500s on
  first load. `connection_limit=15&pool_timeout=30` fixed it; the pooler
  multiplexes these onto far fewer server-side connections.
- **Expect 2–3s per request when the API runs locally against a remote
  database.** That is round-trip latency (laptop → region), not a code
  problem — each endpoint makes several sequential queries. Deploying the
  API into the SAME region as the database removes it. Do not tune the
  application for this; it is an artifact of the local-to-cloud split.
- **Managed platforms that auto-expose `public` over REST need RLS.** See
  migration `20260110000000_enable_rls_deny_direct_access` — without it,
  the publishable key can bypass the entire governed API path.

**Then seed once**, or the app has no merchant to log in as:

```bash
pnpm --filter @razorgrowth/api run db:seed:env
```

> Do not run the seed against a database that already has real data — it
> resets the demo merchant.

---

## 2. Razorpay credentials

Get **Test Mode** keys from the Razorpay dashboard (Settings → API Keys,
with the Test Mode toggle on). Set all three together — the server
rejects a partial configuration at startup rather than half-working:

```
RAZORPAY_KEY_ID=rzp_test_xxxxxxxx
RAZORPAY_KEY_SECRET=xxxxxxxx
RAZORPAY_WEBHOOK_SECRET=xxxxxxxx
```

With none set, the API runs on the deterministic `MockPaymentGateway` and
says so honestly in the UI ("Mock gateway (demo)"). Nothing silently
pretends to be Razorpay.

**Do not skip Test Mode.** Go live only after a complete Test Mode run:
checkout → payment → a deliberate failure → recovery → capture.

---

## 3. A public HTTPS webhook URL

Razorpay must be able to reach:

```
POST https://YOUR_API_HOST/api/v1/payments/webhooks/razorpay
```

Register that URL in the Razorpay dashboard (Settings → Webhooks) with
the same secret you set as `RAZORPAY_WEBHOOK_SECRET`, subscribed to at
minimum `payment.captured` and `payment.failed`.

HTTPS is not optional here. Signature verification over plain HTTP
protects nothing, because the payload and signature are both readable and
rewritable in transit.

**For local testing** before you have a public host, tunnel it:

```bash
cloudflared tunnel --url http://localhost:4000
```

Use the generated `https://…trycloudflare.com` URL as the webhook target.

**Verify it works:** send a test webhook from the dashboard, then confirm
a `WEBHOOK_SIGNATURE_VERIFIED` row appears in the Action Ledger. If you
see `WEBHOOK_RECEIVED` but no verification, the secret does not match.

---

## 4. Hosting

Both images build from the **repository root** (they depend on workspace
packages):

```bash
docker build -f apps/api/Dockerfile -t razorgrowth-api .

docker build -f apps/web/Dockerfile \
  --build-arg VITE_API_BASE_URL=https://YOUR_API_HOST/api/v1 \
  -t razorgrowth-web .
```

The API image runs `prisma migrate deploy` at container start and exits
if it fails, rather than serving traffic against a schema it does not
match.

Two things that will bite you if missed:

- **`VITE_API_BASE_URL` is baked in at build time.** Setting it on a
  running web container does nothing. The Dockerfile fails the build if
  it is missing, rather than shipping a bundle pointing at localhost.
- **`WEB_ORIGIN` on the API is the CORS allowlist.** It must be the exact
  public origin of the frontend, scheme included.

Health endpoints for your platform's probes:

| Endpoint | Purpose |
| --- | --- |
| `GET /api/v1/health` | Liveness — no dependency checks, never fails on a slow database |
| `GET /api/v1/system/readiness` | Readiness — checks the database, returns 503 when degraded |

---

## 5. Secrets management

`.dockerignore` excludes `.env`, so secrets cannot be baked into an image
layer. Inject them from your platform's secret store instead:

- **Fly.io** — `fly secrets set RAZORPAY_KEY_SECRET=…`
- **Render** — environment groups
- **AWS / GCP** — Secrets Manager / Secret Manager, surfaced as env vars

The application reads everything through `apps/api/src/config/env.ts`,
which validates at startup and fails fast on anything missing or
malformed. It does not care where the values came from, so any secret
store works without code changes.

**Rotate `RAZORPAY_WEBHOOK_SECRET` and `RAZORPAY_KEY_SECRET` if they have
ever been in a shell history, a chat message, or a commit.**

---

## 6. Anthropic API key (optional)

```
AI_PROVIDER_API_KEY=sk-ant-…
AI_PROVIDER_MODEL=claude-haiku-4-5-20251001
```

Without it the Buyer Agent uses a deterministic rule-based extractor,
labelled `DEMO_RULE_BASED` in every response and shown in the UI as
"Deterministic demo extractor". The demo works fully without a key — you
just are not exercising real model-backed ranking.

Verify with:

```bash
pnpm --filter @razorgrowth/api run eval:recommendation
```

which reports whether the live-model path actually ran.

---

## Before you switch to live Razorpay keys

Production controls that still require deployment infrastructure — see
PROGRESS.md:

- **No refund or chargeback flow.** You will need this.
- **No scheduled reconciliation for `UNKNOWN` payments.** Today a payment
  stuck in `UNKNOWN` waits for someone to notice.
- **Rate limiting is per API process.** Put a shared edge/Redis limiter in
  front of multiple replicas; the in-process login and public-protocol bounds
  are defense in depth, not a cluster-wide quota.
- **API security headers are applied centrally.** The frontend host should add
  its own CSP tailored to the compiled assets and Razorpay Checkout origins.
- **Session tokens are stored in `localStorage`**, so they are readable by
  any XSS. An `httpOnly` cookie is the stronger choice for production.
- **Approval/authorization expiry is lazy** — expired capabilities are rejected
  correctly when used. Privacy retention and expired login-session cleanup do
  run on a scheduled sweep.

These are not reasons to avoid deploying to Test Mode. They are reasons
to fix before real customer money moves.
